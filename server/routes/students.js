import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { db, nowIso, newId, UPLOAD_DIR } from '../db/index.js';
import { validateBody, pagination, searchTerm, sorting, toBool } from '../lib/validate.js';
import { requirePermission } from '../lib/auth.js';
import { badRequest, conflict, notFound, asyncHandler } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { currentSession } from '../lib/defaults.js';
import {
  createAccount, nextAdmissionNo, nextRollNo, roleIdFor, parentUserIdsForStudent, emailTaken,
} from '../lib/people.js';
import { uploader, publicUrl, parseCsv } from '../lib/upload.js';
import { sendTable } from '../lib/export.js';

const router = Router();

const STUDENT_SELECT = `s.*, c.name AS class_name, sec.name AS section_name,
  (SELECT GROUP_CONCAT(u.full_name, ', ') FROM parent_students ps JOIN users u ON u.id = ps.parent_user_id WHERE ps.student_id = s.id) AS parent_names,
  (SELECT GROUP_CONCAT(u.email, ', ') FROM parent_students ps JOIN users u ON u.id = ps.parent_user_id WHERE ps.student_id = s.id) AS parent_emails`;

function buildFilters(req) {
  const where = ['s.school_id = ?'];
  const params = [req.user.school_id];
  const q = searchTerm(req);
  if (q) {
    where.push('(s.full_name LIKE ? OR s.admission_no LIKE ? OR s.phone LIKE ? OR s.father_name LIKE ? OR s.mother_name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (req.query.classId && req.query.classId !== 'all') { where.push('s.class_id = ?'); params.push(req.query.classId); }
  if (req.query.sectionId && req.query.sectionId !== 'all') { where.push('s.section_id = ?'); params.push(req.query.sectionId); }
  if (req.query.status && req.query.status !== 'all') { where.push('s.status = ?'); params.push(req.query.status); }
  if (req.query.sessionId) { where.push('s.session_id = ?'); params.push(req.query.sessionId); }
  if (req.query.gender && req.query.gender !== 'all') { where.push('s.gender = ?'); params.push(req.query.gender); }
  if (req.query.transport === '1') where.push('s.transport_route_id IS NOT NULL');
  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

router.get('/', requirePermission('students.view'), asyncHandler(async (req, res) => {
  const { limit, offset, page } = pagination(req);
  const { whereSql, params } = buildFilters(req);
  const { clause } = sorting(req, ['full_name', 'admission_no', 'roll_no', 'created_at', 'class_name'], 's.full_name');
  const total = db.prepare(`SELECT COUNT(*) c FROM students s ${whereSql}`).get(...params).c;
  const items = db.prepare(
    `SELECT ${STUDENT_SELECT} FROM students s
     LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id
     ${whereSql} ORDER BY ${clause} LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);

  const feeSummary = db.prepare(
    `SELECT student_id, SUM(net_amount) net, SUM(paid_amount) paid, SUM(due_amount) due
     FROM student_fees WHERE school_id = ? GROUP BY student_id`,
  ).all(req.user.school_id);

  res.json({
    items: items.map((s) => ({
      ...s,
      fees: feeSummary.find((f) => f.student_id === s.id) || { net: 0, paid: 0, due: 0 },
      has_login: Boolean(s.user_id),
    })),
    total, page, limit, pages: Math.ceil(total / limit) || 1,
  });
}));

router.get('/export', requirePermission('students.export'), asyncHandler(async (req, res) => {
  const { whereSql, params } = buildFilters(req);
  const rows = db.prepare(
    `SELECT ${STUDENT_SELECT} FROM students s
     LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id
     ${whereSql} ORDER BY s.admission_no`,
  ).all(...params);
  const columns = [
    { label: 'Admission No', key: 'admission_no' },
    { label: 'Roll No', key: 'roll_no' },
    { label: 'Full Name', key: 'full_name' },
    { label: 'Class', key: 'class_name' },
    { label: 'Section', key: 'section_name' },
    { label: 'Gender', key: 'gender' },
    { label: 'Date of Birth', key: 'dob' },
    { label: 'Father Name', key: 'father_name' },
    { label: 'Mother Name', key: 'mother_name' },
    { label: 'Phone', key: 'phone' },
    { label: 'Email', key: 'email' },
    { label: 'Address', key: 'address' },
    { label: 'City', key: 'city' },
    { label: 'Admission Date', key: 'admission_date' },
    { label: 'Status', key: 'status' },
    { label: 'Guardian', key: 'guardian_name' },
    { label: 'Emergency Contact', key: 'emergency_contact' },
    { label: 'Category', key: 'category' },
  ];
  audit(req, { action: 'export', module: 'students', summary: `Exported ${rows.length} student records` });
  await sendTable(req, res, { filename: 'students', title: 'Student Register', columns, rows });
}));

router.get('/import/template', requirePermission('students.import'), (_req, res) => {
  const headers = 'full_name,admission_no,class,section,gender,dob,father_name,mother_name,guardian_name,phone,email,address,city,admission_date,roll_no,category,emergency_contact,parent_email';
  const sample = 'Aarav Sharma,,Class 8,A,male,2012-05-14,Rajesh Sharma,Meena Sharma,Rajesh Sharma,9876543210,aarav@example.com,12 MG Road,Kolkata,2024-04-01,,General,9876500000,';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="student-import-template.csv"');
  res.send(`\uFEFF${headers}\r\n${sample}\r\n`);
});

router.post('/import', requirePermission('students.import'), uploader('imports', { maxMb: 5 }), asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('Upload a CSV file');
  const dryRun = String(req.query.dryRun ?? req.body.dryRun ?? '') === '1'
    || String(req.body.dryRun ?? '').toLowerCase() === 'true';
  const { records } = parseCsv(fs.readFileSync(req.file.path, 'utf8'));
  if (!records.length) throw badRequest('The file contains no data rows');
  if (records.length > 2000) throw badRequest('Import is limited to 2000 rows per file');

  const schoolId = req.user.school_id;
  const session = currentSession(schoolId);
  const classes = db.prepare('SELECT * FROM classes WHERE school_id = ?').all(schoolId);
  const sections = db.prepare('SELECT * FROM sections WHERE school_id = ?').all(schoolId);

  const errors = [];
  const prepared = [];

  records.forEach((row, idx) => {
    const line = idx + 2;
    const name = (row.full_name || row.name || '').trim();
    if (!name) { errors.push({ line, message: 'full_name is required' }); return; }
    const className = (row.class || row.class_name || '').trim();
    const sectionName = (row.section || row.section_name || 'A').trim();
    const cls = classes.find((c) => c.name.toLowerCase() === className.toLowerCase());
    if (className && !cls) { errors.push({ line, message: `Unknown class "${className}"` }); return; }
    const sec = cls ? sections.find((s) => s.class_id === cls.id && s.name.toLowerCase() === sectionName.toLowerCase()) : null;
    if (cls && !sec) { errors.push({ line, message: `Unknown section "${sectionName}" for ${className}` }); return; }
    const admissionNo = (row.admission_no || '').trim();
    if (admissionNo && db.prepare('SELECT id FROM students WHERE school_id = ? AND admission_no = ?').get(schoolId, admissionNo)) {
      errors.push({ line, message: `Admission number ${admissionNo} already exists` });
      return;
    }
    prepared.push({
      full_name: name,
      admission_no: admissionNo || null,
      class_id: cls?.id || null,
      section_id: sec?.id || null,
      gender: (row.gender || '').trim().toLowerCase() || null,
      dob: (row.dob || '').trim() || null,
      father_name: (row.father_name || '').trim() || null,
      mother_name: (row.mother_name || '').trim() || null,
      guardian_name: (row.guardian_name || '').trim() || null,
      phone: (row.phone || '').trim() || null,
      email: (row.email || '').trim() || null,
      address: (row.address || '').trim() || null,
      city: (row.city || '').trim() || null,
      admission_date: (row.admission_date || '').trim() || nowIso().slice(0, 10),
      roll_no: (row.roll_no || '').trim() || null,
      category: (row.category || '').trim() || null,
      emergency_contact: (row.emergency_contact || '').trim() || null,
      parent_email: (row.parent_email || '').trim() || null,
      line,
    });
  });

  if (dryRun) {
    return res.json({
      dryRun: true, totalRows: records.length, valid: prepared.length, errors,
      preview: prepared.slice(0, 10),
    });
  }
  if (!prepared.length) throw badRequest('No valid rows found', errors);

  let created = 0;
  const credentials = [];
  const run = db.transaction(() => {
    for (const s of prepared) {
      const id = newId('stu');
      const at = nowIso();
      const admissionNo = s.admission_no || nextAdmissionNo(schoolId);
      const rollNo = s.roll_no || (s.class_id ? nextRollNo(schoolId, s.class_id, s.section_id, session?.id) : null);
      db.prepare(
        `INSERT INTO students (id, school_id, admission_no, roll_no, full_name, dob, gender, class_id, section_id, session_id,
          admission_date, status, father_name, mother_name, guardian_name, phone, email, address, city, emergency_contact,
          category, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(id, schoolId, admissionNo, rollNo, s.full_name, s.dob, normaliseGender(s.gender), s.class_id, s.section_id,
        session?.id || null, s.admission_date, 'active', s.father_name, s.mother_name, s.guardian_name, s.phone,
        s.email, s.address, s.city, s.emergency_contact, s.category, at, at);
      created += 1;

      if (s.parent_email && !emailTaken(schoolId, s.parent_email)) {
        try {
          const acc = createAccount({
            schoolId, email: s.parent_email, fullName: s.guardian_name || `Parent of ${s.full_name}`,
            phone: s.phone, role: 'parent', roleId: roleIdFor(schoolId, 'parent'),
          });
          db.prepare('INSERT INTO parent_students (id, school_id, parent_user_id, student_id, relation, is_primary, created_at) VALUES (?,?,?,?,?,?,?)')
            .run(newId('ps'), schoolId, acc.id, id, 'parent', 1, nowIso());
          credentials.push({ student: s.full_name, email: s.parent_email, password: acc.password });
        } catch { /* duplicate email handled silently */ }
      }
    }
  });
  run();

  fs.unlink(req.file.path, () => {});
  audit(req, {
    action: 'import', module: 'students',
    summary: `Imported ${created} students from CSV`, meta: { file: req.file.originalname, errors: errors.length },
  });
  res.json({ created, errors, credentials, totalRows: records.length });
}));

router.get('/:id', requirePermission('students.view'), asyncHandler(async (req, res) => {
  const student = db.prepare(
    `SELECT ${STUDENT_SELECT} FROM students s
     LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id
     WHERE s.id = ? AND s.school_id = ?`,
  ).get(req.params.id, req.user.school_id);
  if (!student) throw notFound('Student not found');

  const parents = db.prepare(
    `SELECT u.id, u.full_name, u.email, u.phone, u.status, ps.relation, ps.is_primary
     FROM parent_students ps JOIN users u ON u.id = ps.parent_user_id WHERE ps.student_id = ?`,
  ).all(student.id);

  const attendance = db.prepare(
    `SELECT status, COUNT(*) c FROM attendance WHERE entity_type = 'student' AND entity_id = ? GROUP BY status`,
  ).all(student.id);
  const attendanceTotal = attendance.reduce((sum, a) => sum + a.c, 0);
  const attendancePresent = attendance.filter((a) => a.status === 'present' || a.status === 'late').reduce((s, a) => s + a.c, 0);

  const results = db.prepare(
    `SELECT r.*, e.name AS exam_name, e.status AS exam_status, ses.name AS session_name
     FROM exam_results r LEFT JOIN exams e ON e.id = r.exam_id LEFT JOIN academic_sessions ses ON ses.id = r.session_id
     WHERE r.student_id = ? AND r.is_published = 1 ORDER BY e.start_date DESC`,
  ).all(student.id).map((r) => ({ ...r, subjects_data: safeJson(r.subjects_data, []) }));

  const fees = db.prepare('SELECT * FROM student_fees WHERE student_id = ? ORDER BY created_at DESC').all(student.id);
  const invoices = db.prepare('SELECT * FROM invoices WHERE student_id = ? ORDER BY issue_date DESC LIMIT 30').all(student.id);
  const payments = db.prepare("SELECT * FROM payments WHERE student_id = ? AND status IN ('success','partially_refunded') ORDER BY COALESCE(paid_at, created_at) DESC LIMIT 30").all(student.id);
  const documents = db.prepare("SELECT * FROM documents WHERE owner_type = 'student' AND owner_id = ? ORDER BY created_at DESC").all(student.id);
  const history = db.prepare('SELECT * FROM student_history WHERE student_id = ? ORDER BY created_at DESC').all(student.id);
  const discounts = db.prepare('SELECT * FROM student_discounts WHERE student_id = ? ORDER BY created_at DESC').all(student.id);
  const transport = student.transport_route_id
    ? db.prepare(
      `SELECT r.name AS route_name, st.name AS stop_name, r.fee_amount, v.registration_no
       FROM transport_routes r LEFT JOIN transport_stops st ON st.id = ? LEFT JOIN vehicles v ON v.id = r.vehicle_id WHERE r.id = ?`,
    ).get(student.transport_stop_id, student.transport_route_id)
    : null;

  res.json({
    ...student,
    parents,
    attendance: {
      total: attendanceTotal,
      present: attendancePresent,
      percentage: attendanceTotal ? Math.round((attendancePresent / attendanceTotal) * 100) : 0,
      breakdown: attendance,
    },
    results,
    fees,
    invoices,
    payments,
    documents,
    history,
    discounts,
    transport,
  });
}));

const studentSchema = z.object({
  full_name: z.string().min(2).max(120),
  admission_no: z.string().max(40).optional().default(''),
  roll_no: z.string().max(20).optional().default(''),
  dob: z.string().max(20).optional().default(''),
  gender: z.string().max(20).optional().default(''),
  blood_group: z.string().max(6).optional().default(''),
  class_id: z.string().max(64).nullish(),
  section_id: z.string().max(64).nullish(),
  admission_date: z.string().max(20).optional().default(''),
  father_name: z.string().max(120).optional().default(''),
  mother_name: z.string().max(120).optional().default(''),
  guardian_name: z.string().max(120).optional().default(''),
  guardian_relation: z.string().max(30).optional().default(''),
  phone: z.string().max(30).optional().default(''),
  email: z.string().max(120).optional().default(''),
  address: z.string().max(300).optional().default(''),
  city: z.string().max(60).optional().default(''),
  pincode: z.string().max(10).optional().default(''),
  emergency_contact: z.string().max(30).optional().default(''),
  previous_school: z.string().max(160).optional().default(''),
  category: z.string().max(40).optional().default(''),
  religion: z.string().max(40).optional().default(''),
  nationality: z.string().max(40).optional().default('Indian'),
  notes: z.string().max(1000).optional().default(''),
  photo_url: z.string().max(300).nullish(),
  status: z.enum(['active', 'withdrawn', 'alumni', 'suspended']).optional(),
  transport_route_id: z.string().max(64).nullish(),
  transport_stop_id: z.string().max(64).nullish(),
  createLogin: z.boolean().optional().default(false),
  parentEmail: z.string().max(120).optional().default(''),
  parentName: z.string().max(120).optional().default(''),
});

function normaliseGender(value) {
  const v = String(value || '').toLowerCase();
  if (['m', 'male', 'boy'].includes(v)) return 'male';
  if (['f', 'female', 'girl'].includes(v)) return 'female';
  if (v === 'other') return 'other';
  return v || null;
}

router.post('/', requirePermission('students.create'), validateBody(studentSchema), asyncHandler(async (req, res) => {
  const d = req.data;
  const schoolId = req.user.school_id;
  const session = currentSession(schoolId);
  if (d.admission_no && db.prepare('SELECT id FROM students WHERE school_id = ? AND admission_no = ?').get(schoolId, d.admission_no)) {
    throw conflict(`Admission number ${d.admission_no} is already in use`);
  }
  const id = newId('stu');
  const at = nowIso();
  const admissionNo = d.admission_no || nextAdmissionNo(schoolId);
  const rollNo = d.roll_no || (d.class_id ? nextRollNo(schoolId, d.class_id, d.section_id, session?.id) : null);

  let credentials = null;
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO students (id, school_id, admission_no, roll_no, full_name, dob, gender, blood_group, class_id, section_id,
        session_id, admission_date, status, father_name, mother_name, guardian_name, guardian_relation, phone, email, address,
        city, pincode, emergency_contact, previous_school, category, religion, nationality, notes, photo_url,
        transport_route_id, transport_stop_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, schoolId, admissionNo, rollNo, d.full_name, d.dob || null, normaliseGender(d.gender), d.blood_group || null,
      d.class_id || null, d.section_id || null, session?.id || null, d.admission_date || at.slice(0, 10), d.status || 'active',
      d.father_name || null, d.mother_name || null, d.guardian_name || null, d.guardian_relation || null,
      d.phone || null, d.email || null, d.address || null, d.city || null, d.pincode || null, d.emergency_contact || null,
      d.previous_school || null, d.category || null, d.religion || null, d.nationality || 'Indian', d.notes || null,
      d.photo_url || null, d.transport_route_id || null, d.transport_stop_id || null, at, at);

    const parentEmail = d.parentEmail || (d.createLogin ? d.email : '');
    if (parentEmail && !emailTaken(schoolId, parentEmail)) {
      const acc = createAccount({
        schoolId, email: parentEmail, fullName: d.parentName || d.guardian_name || `Parent of ${d.full_name}`,
        phone: d.phone, role: 'parent', roleId: roleIdFor(schoolId, 'parent'),
      });
      db.prepare('INSERT INTO parent_students (id, school_id, parent_user_id, student_id, relation, is_primary, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(newId('ps'), schoolId, acc.id, id, d.guardian_relation || 'parent', 1, at);
      credentials = { type: 'parent', email: parentEmail, password: acc.password };
    }
  });
  run();

  audit(req, {
    action: 'create', module: 'students', entityType: 'student', entityId: id,
    summary: `Admitted student ${d.full_name} (${admissionNo})`,
  });
  res.status(201).json({ id, admission_no: admissionNo, roll_no: rollNo, credentials });
}));

router.patch('/:id', requirePermission('students.edit'), validateBody(studentSchema.partial()), asyncHandler(async (req, res) => {
  const existing = db.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!existing) throw notFound('Student not found');
  const allowed = ['full_name', 'admission_no', 'roll_no', 'dob', 'gender', 'blood_group', 'class_id', 'section_id',
    'admission_date', 'father_name', 'mother_name', 'guardian_name', 'guardian_relation', 'phone', 'email', 'address',
    'city', 'pincode', 'emergency_contact', 'previous_school', 'category', 'religion', 'nationality', 'notes',
    'photo_url', 'status', 'transport_route_id', 'transport_stop_id'];
  const fields = [];
  const values = [];
  for (const key of allowed) {
    if (req.data[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(key === 'gender' ? normaliseGender(req.data[key]) : req.data[key]);
    }
  }
  if (!fields.length) throw badRequest('Nothing to update');
  values.push(nowIso(), existing.id, req.user.school_id);
  db.prepare(`UPDATE students SET ${fields.join(', ')}, updated_at = ? WHERE id = ? AND school_id = ?`).run(...values);

  const changed = fields.map((f) => f.split(' = ')[0]).filter((k) => String(existing[k] ?? '') !== String(req.data[k] ?? ''));
  audit(req, {
    action: 'update', module: 'students', entityType: 'student', entityId: existing.id,
    summary: `Updated student ${existing.full_name}`, meta: { fields: changed },
  });
  res.json({ ok: true });
}));

router.post('/:id/status', requirePermission('students.edit'), validateBody(z.object({
  status: z.enum(['active', 'withdrawn', 'alumni', 'suspended']),
  reason: z.string().max(300).optional(),
})), asyncHandler(async (req, res) => {
  const existing = db.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!existing) throw notFound('Student not found');
  db.prepare('UPDATE students SET status = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?')
    .run(req.data.status, req.data.reason || null, nowIso(), existing.id);
  audit(req, {
    action: 'status_change', module: 'students', entityType: 'student', entityId: existing.id,
    summary: `${existing.full_name} marked ${req.data.status}`, meta: { reason: req.data.reason },
  });
  res.json({ ok: true });
}));

router.delete('/:id', requirePermission('students.delete'), asyncHandler(async (req, res) => {
  const existing = db.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!existing) throw notFound('Student not found');
  const ledger = db.prepare('SELECT COUNT(*) c FROM payments WHERE student_id = ?').get(existing.id).c;
  if (ledger) throw conflict('This student has payment history. Mark the record withdrawn instead of deleting.');
  const run = db.transaction(() => {
    db.prepare('DELETE FROM parent_students WHERE student_id = ?').run(existing.id);
    db.prepare("DELETE FROM documents WHERE owner_type = 'student' AND owner_id = ?").run(existing.id);
    db.prepare('DELETE FROM students WHERE id = ?').run(existing.id);
  });
  run();
  audit(req, { action: 'delete', module: 'students', entityType: 'student', entityId: existing.id, summary: `Deleted student ${existing.full_name}` });
  res.json({ ok: true });
}));

/* ------------------------------- credentials ------------------------------ */

router.post('/:id/credentials', requirePermission('students.edit'), validateBody(z.object({
  role: z.enum(['student', 'parent']).default('parent'),
  email: z.string().email().optional(),
  full_name: z.string().max(120).optional(),
})), asyncHandler(async (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!student) throw notFound('Student not found');
  const email = req.data.email || student.email;
  if (!email) throw badRequest('Provide an email address for this login');

  let userId;
  if (req.data.role === 'student' && student.user_id) throw conflict('This student already has a portal login');
  const acc = db.transaction(() => {
    const created = createAccount({
      schoolId: req.user.school_id, email, fullName: req.data.full_name || student.full_name,
      phone: student.phone, role: req.data.role, roleId: roleIdFor(req.user.school_id, req.data.role),
    });
    if (req.data.role === 'student') {
      db.prepare('UPDATE students SET user_id = ?, updated_at = ? WHERE id = ?').run(created.id, nowIso(), student.id);
    } else {
      db.prepare('INSERT INTO parent_students (id, school_id, parent_user_id, student_id, relation, is_primary, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(newId('ps'), req.user.school_id, created.id, student.id, student.guardian_relation || 'parent', 1, nowIso());
    }
    return created;
  })();
  userId = acc.id;
  audit(req, {
    action: 'credentials_created', module: 'students', entityType: 'student', entityId: student.id,
    summary: `Created ${req.data.role} login for ${student.full_name}`,
  });
  res.status(201).json({ userId, email, temporaryPassword: acc.password });
}));

router.post('/:id/link-parent', requirePermission('students.edit'), validateBody(z.object({
  email: z.string().email(),
  relation: z.string().max(30).optional().default('parent'),
  full_name: z.string().max(120).optional(),
})), asyncHandler(async (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!student) throw notFound('Student not found');
  let user = db.prepare('SELECT * FROM users WHERE school_id = ? AND lower(email) = lower(?)').get(req.user.school_id, req.data.email);
  let tempPassword = null;
  if (!user) {
    const acc = createAccount({
      schoolId: req.user.school_id, email: req.data.email,
      fullName: req.data.full_name || `Parent of ${student.full_name}`, phone: student.phone,
      role: 'parent', roleId: roleIdFor(req.user.school_id, 'parent'),
    });
    tempPassword = acc.password;
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(acc.id);
  }
  if (user.role !== 'parent' && user.role !== 'principal') throw badRequest('That account is not a parent account');
  const link = db.prepare('SELECT id FROM parent_students WHERE parent_user_id = ? AND student_id = ?').get(user.id, student.id);
  if (link) throw conflict('This parent is already linked to the student');
  db.prepare('INSERT INTO parent_students (id, school_id, parent_user_id, student_id, relation, is_primary, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(newId('ps'), req.user.school_id, user.id, student.id, req.data.relation, 1, nowIso());
  audit(req, {
    action: 'link_parent', module: 'students', entityType: 'student', entityId: student.id,
    summary: `Linked parent ${user.email} to ${student.full_name}`,
  });
  res.status(201).json({ userId: user.id, temporaryPassword: tempPassword });
}));

router.delete('/:id/parents/:userId', requirePermission('students.edit'), asyncHandler(async (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!student) throw notFound('Student not found');
  db.prepare('DELETE FROM parent_students WHERE parent_user_id = ? AND student_id = ?').run(req.params.userId, student.id);
  audit(req, { action: 'unlink_parent', module: 'students', entityType: 'student', entityId: student.id, summary: 'Unlinked a parent account' });
  res.json({ ok: true });
}));

/* -------------------------------- documents ------------------------------- */

router.post('/:id/documents', requirePermission('students.documents', 'students.edit'), uploader('documents', { maxMb: 10 }), asyncHandler(async (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!student) throw notFound('Student not found');
  if (!req.file) throw badRequest('No file uploaded');
  const url = publicUrl(req.file);
  const id = newId('doc');
  db.prepare('INSERT INTO documents (id, school_id, owner_type, owner_id, name, category, file_url, mime, size, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.user.school_id, 'student', student.id, req.body.name || req.file.originalname, req.body.category || 'general',
      url, req.file.mimetype, req.file.size, req.user.id, nowIso());
  audit(req, { action: 'upload', module: 'students', entityType: 'student', entityId: student.id, summary: `Uploaded document ${req.file.originalname}` });
  res.status(201).json({ id, url });
}));

router.delete('/documents/:docId', requirePermission('students.documents', 'students.edit'), asyncHandler(async (req, res) => {
  const doc = db.prepare("SELECT * FROM documents WHERE id = ? AND school_id = ? AND owner_type = 'student'").get(req.params.docId, req.user.school_id);
  if (!doc) throw notFound('Document not found');
  db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
  if (doc.file_url?.startsWith('/uploads/')) {
    const abs = path.join(UPLOAD_DIR, doc.file_url.replace('/uploads/', ''));
    fs.unlink(abs, () => {});
  }
  audit(req, { action: 'delete', module: 'students', entityType: 'document', entityId: doc.id, summary: `Deleted document ${doc.name}` });
  res.json({ ok: true });
}));

/* ----------------------------- academic history ---------------------------- */

router.get('/:id/history', requirePermission('students.view'), asyncHandler(async (req, res) => {
  const items = db.prepare('SELECT * FROM student_history WHERE student_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json({ items });
}));

router.post('/:id/history', requirePermission('students.history'), validateBody(z.object({
  session_name: z.string().max(40),
  class_name: z.string().max(40),
  result: z.string().max(40).optional().default(''),
  percentage: z.coerce.number().min(0).max(100).optional().default(0),
  remarks: z.string().max(500).optional().default(''),
})), asyncHandler(async (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!student) throw notFound('Student not found');
  const id = newId('sh');
  db.prepare('INSERT INTO student_history (id, school_id, student_id, session_name, class_name, result, percentage, remarks, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, req.user.school_id, student.id, req.data.session_name, req.data.class_name, req.data.result,
      req.data.percentage, req.data.remarks, nowIso());
  audit(req, { action: 'create', module: 'students', entityType: 'student_history', entityId: id, summary: `Added academic history for ${student.full_name}` });
  res.status(201).json({ id });
}));

function safeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export default router;
