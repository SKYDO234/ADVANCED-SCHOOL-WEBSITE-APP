/**
 * End-to-end API smoke test.
 * Requires a running server with seeded demo data:
 *   npm run seed:demo -- --force
 *   PORT=3001 npm start
 *   npm run test:api
 */
const BASE = process.env.API_BASE || 'http://127.0.0.1:3001/api';

let cookie = '';
let passed = 0;
let failed = 0;
const failures = [];

function log(symbol, label, extra = '') {
  console.log(`${symbol} ${label}${extra ? ` — ${extra}` : ''}`);
}

async function call(method, path, body, { expect = [200, 201], raw = false, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  let data = null;
  if (!raw) {
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
  }
  if (!expect.includes(res.status)) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data).slice(0, 400)}`);
  }
  return { status: res.status, data, res };
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    log('✓', name);
  } catch (err) {
    failed += 1;
    failures.push({ name, error: err.message });
    log('✗', name, err.message);
  }
}

const asUser = async (email, password) => {
  cookie = '';
  const res = await call('POST', '/auth/login', { email, password }, { auth: false });
  return res.data;
};

async function main() {
  console.log(`\nAPI smoke test → ${BASE}\n${'─'.repeat(60)}`);

  await test('public site payload', async () => {
    const { data } = await call('GET', '/public/site', null, { auth: false });
    if (!data.school?.name) throw new Error('school missing');
  });

  let principal;
  await test('principal login', async () => {
    principal = (await asUser('principal@sunrise.edu.in', 'Principal@123')).user;
    if (!principal.permissions.includes('results.finalize')) throw new Error('missing permissions');
  });

  await test('bootstrap payload', async () => {
    const { data } = await call('GET', '/meta/bootstrap');
    if (!data.academic.classes.length) throw new Error('no classes');
    if (!data.stats.students) throw new Error('no students');
  });

  await test('dashboard metrics', async () => {
    const { data } = await call('GET', '/dashboard');
    if (typeof data.kpis.students !== 'number') throw new Error('kpis missing');
    if (!data.charts.monthly.length) throw new Error('charts missing');
  });

  await test('student list + search', async () => {
    const { data } = await call('GET', '/students?limit=5&q=a');
    if (!data.items.length) throw new Error('no students returned');
    if (data.total < 100) throw new Error('expected demo students');
  });

  let studentId;
  await test('student detail with 360° data', async () => {
    const { data: list } = await call('GET', '/students?limit=1');
    studentId = list.items[0].id;
    const { data } = await call('GET', `/students/${studentId}`);
    if (!data.full_name) throw new Error('student missing');
    if (!data.attendance) throw new Error('attendance summary missing');
    if (!Array.isArray(data.invoices)) throw new Error('invoices missing');
  });

  await test('create class + section + subject', async () => {
    const name = `Test Class ${Date.now() % 10000}`;
    const { data } = await call('POST', '/academics/classes', { name, sections: ['A', 'B'] });
    const { data: classes } = await call('GET', '/academics/classes');
    const created = classes.items.find((c) => c.id === data.id);
    if (!created || created.sections.length !== 2) throw new Error('sections not created');
    await call('DELETE', `/academics/classes/${data.id}`);
  });

  await test('attendance grid + marking', async () => {
    const { data: classes } = await call('GET', '/academics/classes');
    const cls = classes.items.find((c) => c.students?.length ? true : c.sections.length);
    const section = cls.sections[0];
    const { data: grid } = await call('GET', `/attendance/students/grid?classId=${cls.id}&sectionId=${section.id}&date=2026-10-29`);
    if (!grid.students.length) throw new Error('no students in grid');
    const records = grid.students.slice(0, 3).map((s) => ({ student_id: s.id, status: 'absent', remark: 'API test' }));
    const { data: saved } = await call('POST', '/attendance/students', {
      date: '2026-10-29', classId: cls.id, sectionId: section.id, records,
    });
    if (typeof saved.inserted !== 'number') throw new Error('attendance not saved');
    const { data: after } = await call('GET', `/attendance/students/grid?classId=${cls.id}&sectionId=${section.id}&date=2026-10-29`);
    const marked = after.students.filter((s) => s.status === 'absent' && s.remark === 'API test').length;
    if (marked !== 3) throw new Error(`expected 3 absent, found ${marked}`);
  });

  let examId;
  await test('examination list + detail', async () => {
    const { data } = await call('GET', '/exams');
    const published = data.items.find((e) => e.status === 'published');
    if (!published) throw new Error('no published exam');
    examId = published.id;
    const { data: detail } = await call('GET', `/exams/${examId}`);
    if (!detail.subjects.length) throw new Error('exam subjects missing');
    if (!detail.progress.totalRequired) throw new Error('progress missing');
  });

  await test('results + ranking integrity', async () => {
    const { data } = await call('GET', `/exams/${examId}/results`);
    if (!data.items.length) throw new Error('no results');
    const ranks = data.items.filter((r) => r.section_id === data.items[0].section_id).map((r) => r.rank);
    if (Math.min(...ranks) !== 1) throw new Error('ranks do not start at 1');
    if (data.stats.passed + data.stats.failed !== data.items.length) throw new Error('pass/fail mismatch');
  });

  await test('report card PDF generation', async () => {
    const { data } = await call('GET', `/exams/${examId}/results`);
    const { res } = await call('GET', `/exams/results/${data.items[0].id}/report-card`, null, { raw: true });
    if (res.headers.get('content-type') !== 'application/pdf') throw new Error('not a PDF');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 5000) throw new Error(`PDF too small (${buf.length} bytes)`);
    if (buf.slice(0, 4).toString() !== '%PDF') throw new Error('invalid PDF header');
  });

  await test('marks entry workspace', async () => {
    const { data: exams } = await call('GET', '/exams');
    const live = exams.items.find((e) => e.status === 'marks_entry');
    if (!live) throw new Error('no marks-entry exam in demo data');
    const { data: detail } = await call('GET', `/exams/${live.id}`);
    const subject = detail.subjects[0];
    const { data: workspace } = await call('GET', `/exams/${live.id}/marks?examClassId=${subject.exam_class_id}&subjectId=${subject.id}`);
    if (!workspace.students.length) throw new Error('no students');
    if (!workspace.canEnter) throw new Error('principal should be able to enter marks');
    const records = workspace.students.slice(0, 2).map((s) => ({
      student_id: s.id, theory_marks: 60, practical_marks: 15, is_absent: false, is_exempt: false,
    }));
    const { data: saved } = await call('POST', `/exams/${live.id}/marks`, { examSubjectId: subject.id, records });
    if (!saved.saved) throw new Error('marks not saved');
  });

  await test('fees dashboard + invoice + payment + receipt', async () => {
    const { data: summary } = await call('GET', '/fees/summary');
    if (typeof summary.kpis.collected !== 'number') throw new Error('fee KPIs missing');
    const { data: students } = await call('GET', '/fees/students?status=due&limit=1');
    const student = students.items[0];
    const { data: invoice } = await call('POST', '/fees/invoices', {
      student_id: student.id, due_date: '2026-12-10', period: '2026-12',
      items: [{ description: 'Tuition Fee — 2026-12', amount: 2500, quantity: 1 }],
    });
    const { data: payment } = await call('POST', '/fees/payments', {
      invoice_id: invoice.id, amount: 1000, method: 'upi', txn_ref: 'UPI-TEST-1',
    });
    if (!payment.receipt_no) throw new Error('receipt number missing');
    const { res } = await call('GET', `/fees/payments/${payment.id}/receipt`, null, { raw: true });
    if (res.headers.get('content-type') !== 'application/pdf') throw new Error('receipt not a PDF');
    const { data: after } = await call('GET', `/fees/invoices/${invoice.id}`);
    if (after.invoice.status !== 'partial') throw new Error(`expected partial, got ${after.invoice.status}`);
    if (Number(after.invoice.balance) !== 1500) throw new Error(`balance wrong: ${after.invoice.balance}`);
  });

  await test('invoice generation run', async () => {
    const { data } = await call('POST', '/fees/invoices/generate', { period: '2026-11', due_date: '2026-11-10' });
    if (typeof data.created !== 'number') throw new Error('no result');
  });

  await test('gateway blocks when unconfigured', async () => {
    const { data: students } = await call('GET', '/fees/students?status=due&limit=1');
    const { data: invoice } = await call('POST', '/fees/invoices', {
      student_id: students.items[0].id, due_date: '2026-12-10',
      items: [{ description: 'Test fee', amount: 500 }],
    });
    const res = await fetch(`${BASE}/fees/gateway/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ invoice_id: invoice.id }),
    });
    if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
  });

  await test('reports: class performance + export', async () => {
    const { data } = await call('GET', '/reports/academic/class-performance');
    if (!data.rows.length) throw new Error('no rows');
    const { res } = await call('GET', '/reports/finance/collection?format=csv', null, { raw: true });
    const text = await res.text();
    if (!text.includes('Receipt')) throw new Error('csv missing headers');
    const { res: pdf } = await call('GET', '/reports/academic/class-performance?format=pdf', null, { raw: true });
    if (pdf.headers.get('content-type') !== 'application/pdf') throw new Error('report PDF failed');
  });

  await test('library issue + return', async () => {
    const { data: books } = await call('GET', '/library/books?limit=1&availability=available');
    const book = books.items[0];
    const { data: students } = await call('GET', '/students?limit=1');
    const { data: issue } = await call('POST', '/library/issues', {
      book_id: book.id, borrower_type: 'student', borrower_id: students.items[0].id,
      due_date: '2026-12-01', remarks: 'Test issue',
    });
    const { data: returned } = await call('POST', `/library/issues/${issue.id}/return`, { fine_paid: true });
    if (returned.fine < 0) throw new Error('fine negative');
  });

  await test('homework create + submit + grade', async () => {
    const { data: classes } = await call('GET', '/academics/classes');
    const cls = classes.items[0];
    const { data: created } = await call('POST', '/homework/assignments', {
      title: 'API test assignment', class_id: cls.id, section_id: cls.sections[0].id,
      due_date: '2026-12-01', max_marks: 10, description: 'Test',
    });
    const { data: detail } = await call('GET', `/homework/assignments/${created.id}`);
    if (detail.title !== 'API test assignment') throw new Error('assignment not found');
    await call('DELETE', `/homework/assignments/${created.id}`);
  });

  await test('announcement broadcast', async () => {
    const { data } = await call('POST', '/communication/announcements', {
      title: 'API smoke test notice', body: 'Automated verification of the announcement pipeline.',
      audience: 'all', priority: 'normal',
    });
    if (!data.id) throw new Error('announcement not created');
    await call('DELETE', `/communication/announcements/${data.id}`);
  });

  await test('settings + theme update', async () => {
    const { data } = await call('GET', '/settings');
    if (!data.school?.name) throw new Error('settings payload broken');
    await call('PUT', '/settings/theme', { accent: '#1f3b73', mode: 'light' });
    await call('PUT', '/settings/report-card-template', { showRank: true, showPhoto: true });
  });

  await test('audit log records sensitive actions', async () => {
    const { data } = await call('GET', '/settings/audit?limit=20');
    if (!data.items.length) throw new Error('no audit entries');
    if (!data.items.some((i) => i.module === 'fees')) throw new Error('fee actions not audited');
  });

  await test('backup + system info', async () => {
    const { data: backup } = await call('POST', '/settings/backups', { kind: 'manual' });
    if (!backup.filename) throw new Error('backup not created');
    const { data: system } = await call('GET', '/settings/system');
    if (!system.counts.students) throw new Error('system counts missing');
    await call('DELETE', `/settings/backups/${backup.id}`);
  });

  // ---- teacher scope ----
  let teacherCookie;
  await test('teacher login + scoped dashboard', async () => {
    const data = await asUser('teacher1@sunrise.edu.in', 'Teacher@123');
    if (data.user.role !== 'teacher') throw new Error('wrong role');
    teacherCookie = cookie;
    const { data: dash } = await call('GET', '/dashboard');
    if (dash.scope !== 'teacher') throw new Error('teacher dashboard scope wrong');
    if (!dash.assignments.length) throw new Error('teacher has no assignments');
  });

  await test('teacher cannot access finance', async () => {
    const res = await fetch(`${BASE}/fees/summary`, { headers: { Cookie: teacherCookie } });
    if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
  });

  // ---- staff scope ----
  await test('accounts staff sees finance but not settings', async () => {
    await asUser('accounts@sunrise.edu.in', 'Staff@123');
    await call('GET', '/fees/summary');
    const res = await fetch(`${BASE}/settings`, { headers: { Cookie: cookie } });
    if (res.status !== 403) throw new Error(`expected 403 for settings, got ${res.status}`);
  });

  // ---- parent portal ----
  await test('parent portal payload', async () => {
    await asUser('parent1@example.com', 'Parent@123');
    const { data } = await call('GET', '/portal/overview');
    if (!data.student) throw new Error('child not linked');
    if (!data.fees) throw new Error('fee data missing');
    if (!data.results) throw new Error('results missing');
  });

  await test('parent cannot read other students', async () => {
    const { data } = await call('GET', '/portal/children');
    const other = (await (await fetch(`${BASE}/students?limit=1`, { headers: { Cookie: cookie } })).json());
    if (other.items?.length) throw new Error('parent should not list all students');
  });

  await test('parent sees published report card', async () => {
    const { data } = await call('GET', '/exams/my/results');
    if (!data.items.length) throw new Error('no published results for demo parent');
    const { res } = await call('GET', `/portal/report-card/${data.items[0].id}/pdf`, null, { raw: true });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.slice(0, 4).toString() !== '%PDF') throw new Error('report card not a PDF');
  });

  await test('logout revokes session', async () => {
    await call('POST', '/auth/logout');
    const res = await fetch(`${BASE}/dashboard`, { headers: { Cookie: cookie } });
    if (res.status !== 401) throw new Error(`expected 401 after logout, got ${res.status}`);
  });

  console.log(`${'─'.repeat(60)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(` • ${f.name}: ${f.error}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test harness crashed:', err);
  process.exit(1);
});
