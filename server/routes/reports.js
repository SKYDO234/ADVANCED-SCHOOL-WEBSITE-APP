import { Router } from 'express';
import { db } from '../db/index.js';
import { requirePermission } from '../lib/auth.js';
import { asyncHandler } from '../lib/errors.js';
import { sendTable } from '../lib/export.js';
import { tableReportPdf, streamPdf } from '../lib/pdf.js';
import { currentSession } from '../lib/defaults.js';
import { audit } from '../lib/audit.js';

const router = Router();

async function respond(req, res, { name, title, subtitle, columns, rows, summary = null, meta = [] }) {
  if (String(req.query.format || '') === 'pdf') {
    const doc = tableReportPdf({
      school: req.user.school,
      title, subtitle, meta,
      orientation: columns.length > 8 ? 'landscape' : 'portrait',
      columns: columns.map((c) => ({ ...c, pdfWidth: c.pdfWidth || 110 })),
      rows,
    });
    return streamPdf(res, doc, `${name}.pdf`);
  }
  if (String(req.query.format || '') === 'json' || !req.query.format) {
    return res.json({ title, subtitle, columns, rows, summary, total: rows.length, meta });
  }
  return sendTable(req, res, { filename: name, title, columns, rows, meta });
}

const range = (req, fallbackDays = 30) => {
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const from = req.query.from || new Date(Date.now() - fallbackDays * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
};

/* ------------------------------- academic --------------------------------- */

router.get('/academic/class-performance', requirePermission('reports.view'), asyncHandler(async (req, res) => {
  const examId = req.query.examId;
  const where = ['r.school_id = ?'];
  const params = [req.user.school_id];
  if (examId) { where.push('r.exam_id = ?'); params.push(examId); }
  if (req.query.sessionId) { where.push('r.session_id = ?'); params.push(req.query.sessionId); }

  const rows = db.prepare(
    `SELECT c.name AS class, sec.name AS section, COUNT(*) students,
       ROUND(AVG(r.percentage),1) average_percentage,
       ROUND(MAX(r.percentage),1) highest, ROUND(MIN(r.percentage),1) lowest,
       SUM(CASE WHEN r.result_status = 'pass' THEN 1 ELSE 0 END) passed,
       SUM(CASE WHEN r.result_status != 'pass' THEN 1 ELSE 0 END) failed,
       ROUND(100.0 * SUM(CASE WHEN r.result_status = 'pass' THEN 1 ELSE 0 END) / COUNT(*), 1) pass_percentage
     FROM exam_results r LEFT JOIN classes c ON c.id = r.class_id LEFT JOIN sections sec ON sec.id = r.section_id
     WHERE ${where.join(' AND ')} GROUP BY r.class_id, r.section_id ORDER BY c.order_index, sec.name`,
  ).all(...params);

  await respond(req, res, {
    name: 'class-performance', title: 'Class Performance Report',
    subtitle: examId ? 'Selected examination' : 'All examinations',
    columns: [
      { label: 'Class', key: 'class' }, { label: 'Section', key: 'section' },
      { label: 'Students', key: 'students' }, { label: 'Average %', key: 'average_percentage' },
      { label: 'Highest %', key: 'highest' }, { label: 'Lowest %', key: 'lowest' },
      { label: 'Passed', key: 'passed' }, { label: 'Failed', key: 'failed' },
      { label: 'Pass %', key: 'pass_percentage' },
    ],
    rows,
  });
}));

router.get('/academic/subject-performance', requirePermission('reports.view'), asyncHandler(async (req, res) => {
  const examId = req.query.examId;
  const where = ['es.school_id = ?'];
  const params = [req.user.school_id];
  if (examId) { where.push('es.exam_id = ?'); params.push(examId); }

  const subjects = db.prepare(
    `SELECT es.id, es.exam_id, es.subject_id, es.max_marks, es.pass_marks, s.name AS subject_name,
       c.name AS class_name, sec.name AS section_name, e.name AS exam_name
     FROM exam_subjects es JOIN subjects s ON s.id = es.subject_id
     JOIN exams e ON e.id = es.exam_id
     LEFT JOIN classes c ON c.id = es.class_id LEFT JOIN sections sec ON sec.id = es.section_id
     WHERE ${where.join(' AND ')}`,
  ).all(...params);

  const rows = subjects.map((s) => {
    const marks = db.prepare(
      "SELECT marks_obtained, is_absent, is_exempt FROM exam_marks WHERE exam_subject_id = ?",
    ).all(s.id).filter((m) => !m.is_exempt);
    const valid = marks.filter((m) => !m.is_absent);
    const avg = valid.length ? valid.reduce((sum, m) => sum + Number(m.marks_obtained || 0), 0) / valid.length : 0;
    const passed = valid.filter((m) => Number(m.marks_obtained) >= Number(s.pass_marks)).length;
    return {
      exam: s.exam_name,
      class: s.class_name,
      section: s.section_name,
      subject: s.subject_name,
      appeared: valid.length,
      absent: marks.filter((m) => m.is_absent).length,
      average: Math.round(avg * 10) / 10,
      average_percentage: s.max_marks ? Math.round((avg / s.max_marks) * 1000) / 10 : 0,
      highest: valid.length ? Math.max(...valid.map((m) => Number(m.marks_obtained || 0))) : 0,
      lowest: valid.length ? Math.min(...valid.map((m) => Number(m.marks_obtained || 0))) : 0,
      pass_percentage: valid.length ? Math.round((passed / valid.length) * 1000) / 10 : 0,
    };
  });

  await respond(req, res, {
    name: 'subject-performance', title: 'Subject Performance Report',
    columns: [
      { label: 'Examination', key: 'exam' }, { label: 'Class', key: 'class' },
      { label: 'Section', key: 'section' }, { label: 'Subject', key: 'subject' },
      { label: 'Appeared', key: 'appeared' }, { label: 'Absent', key: 'absent' },
      { label: 'Average', key: 'average' }, { label: 'Avg %', key: 'average_percentage' },
      { label: 'Highest', key: 'highest' }, { label: 'Lowest', key: 'lowest' },
      { label: 'Pass %', key: 'pass_percentage' },
    ],
    rows,
  });
}));

router.get('/academic/top-students', requirePermission('reports.view'), asyncHandler(async (req, res) => {
  const examId = req.query.examId
    || db.prepare("SELECT id FROM exams WHERE school_id = ? AND status IN ('finalized','published') ORDER BY COALESCE(start_date, created_at) DESC LIMIT 1")
      .get(req.user.school_id)?.id;
  if (!examId) return res.json({ rows: [], total: 0, message: 'No finalized examination yet' });

  const rows = db.prepare(
    `SELECT r.rank, s.full_name AS student, s.admission_no, c.name AS class, sec.name AS section,
       r.total_obtained, r.total_max, r.percentage, r.grade
     FROM exam_results r JOIN students s ON s.id = r.student_id
     LEFT JOIN classes c ON c.id = r.class_id LEFT JOIN sections sec ON sec.id = r.section_id
     WHERE r.exam_id = ? AND r.school_id = ? ORDER BY r.rank LIMIT ?`,
  ).all(examId, req.user.school_id, Number(req.query.limit) || 50);

  await respond(req, res, {
    name: 'top-students', title: 'Top Ranked Students',
    columns: [
      { label: 'Rank', key: 'rank', pdfWidth: 50 }, { label: 'Student', key: 'student' },
      { label: 'Admission No', key: 'admission_no' }, { label: 'Class', key: 'class' },
      { label: 'Section', key: 'section' }, { label: 'Total', key: 'total_obtained' },
      { label: 'Max', key: 'total_max' }, { label: 'Percentage', key: 'percentage' }, { label: 'Grade', key: 'grade' },
    ],
    rows,
  });
}));

router.get('/academic/grade-distribution', requirePermission('reports.view'), asyncHandler(async (req, res) => {
  const examId = req.query.examId;
  const where = ['school_id = ?'];
  const params = [req.user.school_id];
  if (examId) { where.push('exam_id = ?'); params.push(examId); }
  const rows = db.prepare(
    `SELECT COALESCE(grade,'—') AS grade, COUNT(*) students,
       ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM exam_results WHERE ${where.join(' AND ')}), 1) percentage
     FROM exam_results WHERE ${where.join(' AND ')} GROUP BY grade ORDER BY grade`,
  ).all(...params, ...params);
  await respond(req, res, {
    name: 'grade-distribution', title: 'Grade Distribution',
    columns: [{ label: 'Grade', key: 'grade' }, { label: 'Students', key: 'students' }, { label: 'Share %', key: 'percentage' }],
    rows,
  });
}));

router.get('/academic/year-comparison', requirePermission('reports.view'), asyncHandler(async (req, res) => {
  const rows = db.prepare(
    `SELECT ses.name AS session, COUNT(*) results, ROUND(AVG(r.percentage),1) average_percentage,
       SUM(CASE WHEN r.result_status='pass' THEN 1 ELSE 0 END) passed,
       ROUND(100.0 * SUM(CASE WHEN r.result_status='pass' THEN 1 ELSE 0 END) / COUNT(*),1) pass_percentage
     FROM exam_results r LEFT JOIN academic_sessions ses ON ses.id = r.session_id
     WHERE r.school_id = ? GROUP BY r.session_id ORDER BY ses.start_date`,
  ).all(req.user.school_id);
  await respond(req, res, {
    name: 'year-comparison', title: 'Year-over-Year Academic Comparison',
    columns: [
      { label: 'Session', key: 'session' }, { label: 'Results', key: 'results' },
      { label: 'Average %', key: 'average_percentage' }, { label: 'Passed', key: 'passed' },
      { label: 'Pass %', key: 'pass_percentage' },
    ],
    rows,
  });
}));

/* -------------------------------- finance --------------------------------- */

router.get('/finance/collection', requirePermission('reports.finance'), asyncHandler(async (req, res) => {
  const { from, to } = range(req);
  const where = ["p.school_id = ?", "p.status IN ('success','partially_refunded')", 'date(COALESCE(p.paid_at, p.created_at)) BETWEEN ? AND ?'];
  const params = [req.user.school_id, from, to];
  if (req.query.classId && req.query.classId !== 'all') { where.push('s.class_id = ?'); params.push(req.query.classId); }

  const rows = db.prepare(
    `SELECT COALESCE(p.paid_at, p.created_at) AS date, p.receipt_no, s.full_name AS student, s.admission_no,
       c.name AS class, p.method, p.amount, p.status, p.txn_ref, i.invoice_no
     FROM payments p LEFT JOIN students s ON s.id = p.student_id
     LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN invoices i ON i.id = p.invoice_id
     WHERE ${where.join(' AND ')} ORDER BY date DESC`,
  ).all(...params);

  const summary = {
    total: rows.reduce((s, r) => s + Number(r.amount), 0),
    count: rows.length,
    byMethod: Object.entries(rows.reduce((acc, r) => {
      acc[r.method] = (acc[r.method] || 0) + Number(r.amount);
      return acc;
    }, {})).map(([method, total]) => ({ method, total })),
  };

  await respond(req, res, {
    name: `fee-collection-${from}-to-${to}`, title: 'Fee Collection Report',
    subtitle: `${from} to ${to}`, meta: [`Total: ${summary.total.toFixed(2)}`, `Receipts: ${summary.count}`],
    columns: [
      { label: 'Date', value: (r) => String(r.date || '').slice(0, 10) }, { label: 'Receipt', key: 'receipt_no' },
      { label: 'Student', key: 'student' }, { label: 'Admission No', key: 'admission_no' },
      { label: 'Class', key: 'class' }, { label: 'Invoice', key: 'invoice_no' },
      { label: 'Method', key: 'method' }, { label: 'Amount', key: 'amount' },
      { label: 'Status', key: 'status' }, { label: 'Txn Ref', key: 'txn_ref' },
    ],
    rows, summary,
  });
}));

router.get('/finance/pending', requirePermission('reports.finance'), asyncHandler(async (req, res) => {
  const sessionId = req.query.sessionId || currentSession(req.user.school_id)?.id;
  const rows = db.prepare(
    `SELECT i.invoice_no, i.issue_date, i.due_date, s.full_name AS student, s.admission_no, c.name AS class,
       s.phone, i.total, i.amount_paid, i.balance, i.status,
       CASE WHEN date(i.due_date) < date('now') THEN CAST(julianday('now') - julianday(i.due_date) AS INTEGER) ELSE 0 END AS days_overdue
     FROM invoices i JOIN students s ON s.id = i.student_id LEFT JOIN classes c ON c.id = s.class_id
     WHERE i.school_id = ? AND (? IS NULL OR i.session_id = ?) AND i.balance > 0 AND i.status != 'cancelled'
     ORDER BY days_overdue DESC, i.balance DESC`,
  ).all(req.user.school_id, sessionId, sessionId);

  await respond(req, res, {
    name: 'pending-fees', title: 'Pending Fee Report',
    columns: [
      { label: 'Invoice', key: 'invoice_no' }, { label: 'Issued', key: 'issue_date' },
      { label: 'Due', key: 'due_date' }, { label: 'Student', key: 'student' },
      { label: 'Admission No', key: 'admission_no' }, { label: 'Class', key: 'class' },
      { label: 'Total', key: 'total' }, { label: 'Paid', key: 'amount_paid' },
      { label: 'Balance', key: 'balance' }, { label: 'Days overdue', key: 'days_overdue' },
      { label: 'Phone', key: 'phone' },
    ],
    rows,
    summary: { pending: rows.reduce((s, r) => s + Number(r.balance), 0), invoices: rows.length },
  });
}));

router.get('/finance/profit-loss', requirePermission('reports.finance'), asyncHandler(async (req, res) => {
  const { from, to } = range(req, 365);
  const income = db.prepare(
    `SELECT COALESCE(SUM(amount),0) v FROM payments WHERE school_id = ? AND status IN ('success','partially_refunded')
     AND date(COALESCE(paid_at, created_at)) BETWEEN ? AND ?`,
  ).get(req.user.school_id, from, to).v;
  const refunds = db.prepare(
    'SELECT COALESCE(SUM(amount),0) v FROM refunds WHERE school_id = ? AND date(created_at) BETWEEN ? AND ?',
  ).get(req.user.school_id, from, to).v;
  const expenses = db.prepare(
    'SELECT category, COALESCE(SUM(amount),0) total FROM expenses WHERE school_id = ? AND expense_date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC',
  ).all(req.user.school_id, from, to);
  const payroll = db.prepare(
    "SELECT COALESCE(SUM(net),0) v FROM payroll WHERE school_id = ? AND status = 'paid'",
  ).get(req.user.school_id).v;
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.total), 0) + Number(payroll);

  const rows = [
    { head: 'Fee collection', category: 'Income', amount: Number(income) },
    { head: 'Refunds issued', category: 'Deduction', amount: -Number(refunds) },
    ...expenses.map((e) => ({ head: e.category, category: 'Expense', amount: -Number(e.total) })),
    { head: 'Payroll (paid)', category: 'Expense', amount: -Number(payroll) },
  ];
  const net = rows.reduce((s, r) => s + r.amount, 0);

  await respond(req, res, {
    name: 'profit-loss', title: 'Income & Expenditure Summary', subtitle: `${from} to ${to}`,
    columns: [
      { label: 'Head', key: 'head' }, { label: 'Type', key: 'category' },
      { label: 'Amount', value: (r) => r.amount.toFixed(2) },
    ],
    rows,
    summary: { income, refunds, expenses: totalExpenses, net },
  });
}));

router.get('/finance/class-collection', requirePermission('reports.finance'), asyncHandler(async (req, res) => {
  const rows = db.prepare(
    `SELECT c.name AS class, COUNT(DISTINCT s.id) students,
       COALESCE(SUM(sf.net_amount),0) billed, COALESCE(SUM(sf.paid_amount),0) collected,
       COALESCE(SUM(sf.due_amount),0) due,
       CASE WHEN COALESCE(SUM(sf.net_amount),0) > 0
         THEN ROUND(100.0 * SUM(sf.paid_amount) / SUM(sf.net_amount), 1) ELSE 0 END AS collection_percentage
     FROM classes c LEFT JOIN students s ON s.class_id = c.id AND s.status = 'active'
     LEFT JOIN student_fees sf ON sf.student_id = s.id
     WHERE c.school_id = ? GROUP BY c.id ORDER BY c.order_index`,
  ).all(req.user.school_id);
  await respond(req, res, {
    name: 'class-collection', title: 'Class-wise Fee Collection',
    columns: [
      { label: 'Class', key: 'class' }, { label: 'Students', key: 'students' },
      { label: 'Billed', key: 'billed' }, { label: 'Collected', key: 'collected' },
      { label: 'Due', key: 'due' }, { label: 'Collection %', key: 'collection_percentage' },
    ],
    rows,
  });
}));

/* ------------------------------- attendance -------------------------------- */

router.get('/attendance/summary', requirePermission('reports.attendance'), asyncHandler(async (req, res) => {
  const { from, to } = range(req, 30);
  const type = req.query.entity === 'employee' ? 'employee' : 'student';
  const where = ['a.school_id = ?', 'a.entity_type = ?', 'a.date BETWEEN ? AND ?'];
  const params = [req.user.school_id, type, from, to];
  if (req.query.classId && req.query.classId !== 'all') { where.push('s.class_id = ?'); params.push(req.query.classId); }

  const rows = type === 'student'
    ? db.prepare(
      `SELECT s.full_name AS name, s.admission_no AS code, c.name AS class, sec.name AS section,
         COUNT(a.id) marked,
         SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) present,
         SUM(CASE WHEN a.status='absent' THEN 1 ELSE 0 END) absent,
         SUM(CASE WHEN a.status='late' THEN 1 ELSE 0 END) late,
         SUM(CASE WHEN a.status='leave' THEN 1 ELSE 0 END) leave_count,
         CASE WHEN COUNT(a.id) > 0 THEN ROUND(100.0 * SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) / COUNT(a.id),1) ELSE NULL END AS percentage
       FROM attendance a JOIN students s ON s.id = a.entity_id
       LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id
       WHERE ${where.join(' AND ')} GROUP BY s.id ORDER BY c.order_index, s.full_name`,
    ).all(...params)
    : db.prepare(
      `SELECT u.full_name AS name, e.employee_code AS code, e.department AS class, '' AS section,
         COUNT(a.id) marked,
         SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) present,
         SUM(CASE WHEN a.status='absent' THEN 1 ELSE 0 END) absent,
         SUM(CASE WHEN a.status='late' THEN 1 ELSE 0 END) late,
         SUM(CASE WHEN a.status='leave' THEN 1 ELSE 0 END) leave_count,
         CASE WHEN COUNT(a.id) > 0 THEN ROUND(100.0 * SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) / COUNT(a.id),1) ELSE NULL END AS percentage
       FROM attendance a JOIN employees e ON e.id = a.entity_id JOIN users u ON u.id = e.user_id
       WHERE ${where.join(' AND ')} GROUP BY e.id ORDER BY u.full_name`,
    ).all(...params);

  await respond(req, res, {
    name: `attendance-${type}-summary`, title: `${type === 'student' ? 'Student' : 'Employee'} Attendance Summary`,
    subtitle: `${from} to ${to}`,
    columns: [
      { label: 'Name', key: 'name' }, { label: 'Code', key: 'code' },
      { label: type === 'student' ? 'Class' : 'Department', key: 'class' },
      ...(type === 'student' ? [{ label: 'Section', key: 'section' }] : []),
      { label: 'Marked', key: 'marked' }, { label: 'Present', key: 'present' },
      { label: 'Absent', key: 'absent' }, { label: 'Late', key: 'late' },
      { label: 'Leave', key: 'leave_count' }, { label: 'Percentage', key: 'percentage' },
    ],
    rows,
  });
}));

router.get('/attendance/absentees', requirePermission('reports.attendance'), asyncHandler(async (req, res) => {
  const { from, to } = range(req, 7);
  const rows = db.prepare(
    `SELECT a.date, s.full_name AS student, s.admission_no, c.name AS class, sec.name AS section,
       s.phone, a.status, a.remark
     FROM attendance a JOIN students s ON s.id = a.entity_id
     LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id
     WHERE a.school_id = ? AND a.entity_type = 'student' AND a.status IN ('absent','leave') AND a.date BETWEEN ? AND ?
     ORDER BY a.date DESC, c.order_index, s.full_name`,
  ).all(req.user.school_id, from, to);
  await respond(req, res, {
    name: 'absentee-report', title: 'Absentee Report', subtitle: `${from} to ${to}`,
    columns: [
      { label: 'Date', key: 'date' }, { label: 'Student', key: 'student' },
      { label: 'Admission No', key: 'admission_no' }, { label: 'Class', key: 'class' },
      { label: 'Section', key: 'section' }, { label: 'Status', key: 'status' },
      { label: 'Remark', key: 'remark' }, { label: 'Phone', key: 'phone' },
    ],
    rows,
  });
}));

/* ------------------------------ administrative ---------------------------- */

router.get('/admin/overview', requirePermission('reports.admin'), asyncHandler(async (req, res) => {
  const schoolId = req.user.school_id;
  const rows = [
    { metric: 'Active students', value: db.prepare("SELECT COUNT(*) c FROM students WHERE school_id = ? AND status='active'").get(schoolId).c },
    { metric: 'New admissions (session)', value: db.prepare("SELECT COUNT(*) c FROM students WHERE school_id = ? AND status='active'").get(schoolId).c },
    { metric: 'Withdrawn students', value: db.prepare("SELECT COUNT(*) c FROM students WHERE school_id = ? AND status='withdrawn'").get(schoolId).c },
    { metric: 'Teachers', value: db.prepare("SELECT COUNT(*) c FROM users WHERE school_id = ? AND role='teacher' AND status='active'").get(schoolId).c },
    { metric: 'Staff', value: db.prepare("SELECT COUNT(*) c FROM users WHERE school_id = ? AND role='staff' AND status='active'").get(schoolId).c },
    { metric: 'Parent accounts', value: db.prepare("SELECT COUNT(*) c FROM users WHERE school_id = ? AND role='parent'").get(schoolId).c },
    { metric: 'Classes', value: db.prepare('SELECT COUNT(*) c FROM classes WHERE school_id = ?').get(schoolId).c },
    { metric: 'Sections', value: db.prepare('SELECT COUNT(*) c FROM sections WHERE school_id = ?').get(schoolId).c },
    { metric: 'Subjects', value: db.prepare('SELECT COUNT(*) c FROM subjects WHERE school_id = ?').get(schoolId).c },
    { metric: 'Library books', value: db.prepare('SELECT COUNT(*) c FROM books WHERE school_id = ?').get(schoolId).c },
    { metric: 'Books on loan', value: db.prepare("SELECT COUNT(*) c FROM book_issues WHERE school_id = ? AND status IN ('issued','overdue')").get(schoolId).c },
    { metric: 'Transport routes', value: db.prepare('SELECT COUNT(*) c FROM transport_routes WHERE school_id = ?').get(schoolId).c },
    { metric: 'Students using transport', value: db.prepare('SELECT COUNT(*) c FROM students WHERE school_id = ? AND transport_route_id IS NOT NULL').get(schoolId).c },
    { metric: 'Open admission inquiries', value: db.prepare("SELECT COUNT(*) c FROM admission_inquiries WHERE school_id = ? AND status='new'").get(schoolId).c },
    { metric: 'Unpaid fee invoices', value: db.prepare("SELECT COUNT(*) c FROM invoices WHERE school_id = ? AND balance > 0 AND status != 'cancelled'").get(schoolId).c },
  ];
  await respond(req, res, {
    name: 'administrative-overview', title: 'Administrative Overview',
    columns: [{ label: 'Metric', key: 'metric', pdfWidth: 260 }, { label: 'Value', key: 'value', align: 'right' }],
    rows,
  });
}));

router.get('/admin/class-strength', requirePermission('reports.admin'), asyncHandler(async (req, res) => {
  const rows = db.prepare(
    `SELECT c.name AS class, sec.name AS section, sec.room, sec.capacity,
       COUNT(s.id) students,
       CASE WHEN sec.capacity > 0 THEN ROUND(100.0 * COUNT(s.id) / sec.capacity, 1) ELSE 0 END AS utilisation,
       u.full_name AS class_teacher
     FROM sections sec JOIN classes c ON c.id = sec.class_id
     LEFT JOIN students s ON s.section_id = sec.id AND s.status = 'active'
     LEFT JOIN users u ON u.id = sec.class_teacher_id
     WHERE c.school_id = ? GROUP BY sec.id ORDER BY c.order_index, sec.name`,
  ).all(req.user.school_id);
  await respond(req, res, {
    name: 'class-strength', title: 'Class Strength & Utilisation',
    columns: [
      { label: 'Class', key: 'class' }, { label: 'Section', key: 'section' },
      { label: 'Room', key: 'room' }, { label: 'Capacity', key: 'capacity' },
      { label: 'Students', key: 'students' }, { label: 'Utilisation %', key: 'utilisation' },
      { label: 'Class Teacher', key: 'class_teacher' },
    ],
    rows,
  });
}));

router.get('/admin/employees', requirePermission('reports.admin'), asyncHandler(async (req, res) => {
  const rows = db.prepare(
    `SELECT e.employee_code, u.full_name AS name, u.role, e.department, e.designation, e.employment_type,
       e.joining_date, u.phone, u.email, e.status
     FROM employees e JOIN users u ON u.id = e.user_id WHERE e.school_id = ? ORDER BY e.department, u.full_name`,
  ).all(req.user.school_id);
  await respond(req, res, {
    name: 'employee-records', title: 'Employee Records',
    columns: [
      { label: 'Code', key: 'employee_code' }, { label: 'Name', key: 'name' },
      { label: 'Role', key: 'role' }, { label: 'Department', key: 'department' },
      { label: 'Designation', key: 'designation' }, { label: 'Type', key: 'employment_type' },
      { label: 'Joined', key: 'joining_date' }, { label: 'Phone', key: 'phone' },
      { label: 'Email', key: 'email' }, { label: 'Status', key: 'status' },
    ],
    rows,
  });
}));

router.get('/admin/transport', requirePermission('reports.admin'), asyncHandler(async (req, res) => {
  const rows = db.prepare(
    `SELECT r.name AS route, v.registration_no AS vehicle, v.capacity, v.driver_name,
       COUNT(s.id) students, r.fee_amount
     FROM transport_routes r LEFT JOIN vehicles v ON v.id = r.vehicle_id
     LEFT JOIN students s ON s.transport_route_id = r.id AND s.status = 'active'
     WHERE r.school_id = ? GROUP BY r.id ORDER BY r.name`,
  ).all(req.user.school_id);
  await respond(req, res, {
    name: 'transport-report', title: 'Transport Allocation Report',
    columns: [
      { label: 'Route', key: 'route' }, { label: 'Vehicle', key: 'vehicle' },
      { label: 'Capacity', key: 'capacity' }, { label: 'Driver', key: 'driver_name' },
      { label: 'Students', key: 'students' }, { label: 'Monthly Fee', key: 'fee_amount' },
    ],
    rows,
  });
}));

router.get('/admin/library', requirePermission('reports.admin'), asyncHandler(async (req, res) => {
  const rows = db.prepare(
    `SELECT b.title, b.author, b.isbn, cat.name AS category, b.total_copies, b.available_copies,
       (SELECT COUNT(*) FROM book_issues bi WHERE bi.book_id = b.id) times_issued,
       COALESCE((SELECT SUM(fine) FROM book_issues bi WHERE bi.book_id = b.id),0) fines
     FROM books b LEFT JOIN book_categories cat ON cat.id = b.category_id
     WHERE b.school_id = ? ORDER BY b.title`,
  ).all(req.user.school_id);
  await respond(req, res, {
    name: 'library-report', title: 'Library Circulation Report',
    columns: [
      { label: 'Title', key: 'title' }, { label: 'Author', key: 'author' }, { label: 'ISBN', key: 'isbn' },
      { label: 'Category', key: 'category' }, { label: 'Copies', key: 'total_copies' },
      { label: 'Available', key: 'available_copies' }, { label: 'Times issued', key: 'times_issued' },
      { label: 'Fines', key: 'fines' },
    ],
    rows,
  });
}));

router.get('/admin/audit', requirePermission('settings.audit'), asyncHandler(async (req, res) => {
  const where = ['school_id = ?'];
  const params = [req.user.school_id];
  if (req.query.module) { where.push('module = ?'); params.push(req.query.module); }
  if (req.query.from) { where.push('date(created_at) >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('date(created_at) <= ?'); params.push(req.query.to); }
  const rows = db.prepare(
    `SELECT created_at, actor_name, actor_role, action, module, summary, ip FROM audit_logs
     WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 5000`,
  ).all(...params);
  audit(req, { action: 'export', module: 'settings', summary: `Exported audit log (${rows.length} rows)` });
  await respond(req, res, {
    name: 'audit-log', title: 'System Activity Log',
    columns: [
      { label: 'When', value: (r) => String(r.created_at).replace('T', ' ').slice(0, 19) },
      { label: 'User', key: 'actor_name' }, { label: 'Role', key: 'actor_role' },
      { label: 'Action', key: 'action' }, { label: 'Module', key: 'module' },
      { label: 'Summary', key: 'summary' }, { label: 'IP', key: 'ip' },
    ],
    rows,
  });
}));

export default router;
