import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { db, nowIso, newId, UPLOAD_DIR } from '../db/index.js';
import { validateBody, pagination, searchTerm, sorting } from '../lib/validate.js';
import { requirePermission, requireAuth } from '../lib/auth.js';
import { badRequest, conflict, notFound, asyncHandler } from '../lib/errors.js';
import { audit, notifyUsers } from '../lib/audit.js';
import { createAccount, nextEmployeeCode, roleIdFor } from '../lib/people.js';
import { uploader, publicUrl } from '../lib/upload.js';
import { sendTable } from '../lib/export.js';

const router = Router();

export const DEPARTMENTS = [
  'accounts', 'reception', 'examination', 'library', 'transport', 'office', 'hr', 'academics', 'sports',
];

router.get('/', requirePermission('employees.view', 'payroll.view', 'settings.users'), asyncHandler(async (req, res) => {
  const { limit, offset, page } = pagination(req);
  const q = searchTerm(req);
  const { clause } = sorting(req, ['full_name', 'employee_code', 'department', 'joining_date'], 'full_name');
  const where = ['e.school_id = ?'];
  const params = [req.user.school_id];
  if (q) {
    where.push('(u.full_name LIKE ? OR u.email LIKE ? OR e.employee_code LIKE ? OR e.designation LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (req.query.department && req.query.department !== 'all') { where.push('e.department = ?'); params.push(req.query.department); }
  if (req.query.role && req.query.role !== 'all') { where.push('u.role = ?'); params.push(req.query.role); }
  if (req.query.status && req.query.status !== 'all') { where.push('e.status = ?'); params.push(req.query.status); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const total = db.prepare(`SELECT COUNT(*) c FROM employees e JOIN users u ON u.id = e.user_id ${whereSql}`).get(...params).c;
  const items = db.prepare(
    `SELECT e.*, u.full_name, u.email, u.phone, u.role, u.status AS user_status, u.avatar_url,
       (SELECT COUNT(*) FROM class_subjects cs WHERE cs.teacher_id = e.user_id) AS subject_count
     FROM employees e JOIN users u ON u.id = e.user_id
     ${whereSql} ORDER BY ${clause} LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1, departments: DEPARTMENTS });
}));

router.get('/export', requirePermission('employees.export'), asyncHandler(async (req, res) => {
  const rows = db.prepare(
    `SELECT e.*, u.full_name, u.email, u.phone, u.role FROM employees e JOIN users u ON u.id = e.user_id
     WHERE e.school_id = ? ORDER BY e.employee_code`,
  ).all(req.user.school_id);
  const columns = [
    { label: 'Employee Code', key: 'employee_code' },
    { label: 'Name', key: 'full_name' },
    { label: 'Role', key: 'role' },
    { label: 'Department', key: 'department' },
    { label: 'Designation', key: 'designation' },
    { label: 'Employment Type', key: 'employment_type' },
    { label: 'Joining Date', key: 'joining_date' },
    { label: 'Qualification', key: 'qualification' },
    { label: 'Specialisation', key: 'specialization' },
    { label: 'Email', key: 'email' },
    { label: 'Phone', key: 'phone' },
    { label: 'Status', key: 'status' },
    { label: 'Monthly Salary', key: 'salary_amount' },
  ];
  audit(req, { action: 'export', module: 'employees', summary: `Exported ${rows.length} employee records` });
  await sendTable(req, res, { filename: 'employees', title: 'Employee Register', columns, rows });
}));

router.get('/departments', (_req, res) => res.json({ items: DEPARTMENTS }));

router.get('/:id', requirePermission('employees.view', 'payroll.view'), asyncHandler(async (req, res) => {
  const emp = db.prepare(
    `SELECT e.*, u.full_name, u.email, u.phone, u.role, u.status AS user_status, u.avatar_url, u.two_factor_enabled
     FROM employees e JOIN users u ON u.id = e.user_id WHERE e.id = ? AND e.school_id = ?`,
  ).get(req.params.id, req.user.school_id);
  if (!emp) throw notFound('Employee not found');

  const assignments = db.prepare(
    `SELECT cs.*, c.name AS class_name, sec.name AS section_name, s.name AS subject_name, ses.name AS session_name
     FROM class_subjects cs LEFT JOIN classes c ON c.id = cs.class_id
     LEFT JOIN sections sec ON sec.id = cs.section_id LEFT JOIN subjects s ON s.id = cs.subject_id
     LEFT JOIN academic_sessions ses ON ses.id = cs.session_id
     WHERE cs.teacher_id = ? ORDER BY c.order_index`,
  ).all(emp.user_id);

  const attendance = db.prepare(
    `SELECT status, COUNT(*) c FROM attendance WHERE entity_type = 'employee' AND entity_id = ? GROUP BY status`,
  ).all(emp.id);
  const attendanceTotal = attendance.reduce((s, a) => s + a.c, 0);
  const presentTotal = attendance.filter((a) => a.status === 'present' || a.status === 'late').reduce((s, a) => s + a.c, 0);

  const payroll = db.prepare('SELECT * FROM payroll WHERE employee_id = ? ORDER BY month DESC LIMIT 24').all(emp.id);
  const leave = db.prepare('SELECT * FROM leave_applications WHERE employee_id = ? ORDER BY created_at DESC LIMIT 30').all(emp.id);
  const performance = db.prepare('SELECT * FROM staff_performance WHERE employee_id = ? ORDER BY created_at DESC').all(emp.id);
  const documents = db.prepare("SELECT * FROM documents WHERE owner_type = 'employee' AND owner_id = ? ORDER BY created_at DESC").all(emp.id);

  res.json({
    ...emp,
    assignments,
    attendance: { total: attendanceTotal, present: presentTotal, percentage: attendanceTotal ? Math.round((presentTotal / attendanceTotal) * 100) : 0, breakdown: attendance },
    payroll,
    leave,
    performance,
    documents,
  });
}));

const employeeSchema = z.object({
  full_name: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().max(30).optional().default(''),
  role: z.enum(['teacher', 'staff', 'principal']).default('teacher'),
  department: z.string().max(40).optional().default('academics'),
  designation: z.string().max(80).optional().default(''),
  employee_code: z.string().max(30).optional().default(''),
  employment_type: z.enum(['full_time', 'part_time', 'contract', 'visiting']).default('full_time'),
  joining_date: z.string().max(20).optional().default(''),
  qualification: z.string().max(120).optional().default(''),
  specialization: z.string().max(120).optional().default(''),
  salary_amount: z.coerce.number().min(0).max(10_000_000).optional().default(0),
  bank_account: z.string().max(40).optional().default(''),
  address: z.string().max(300).optional().default(''),
  emergency_contact: z.string().max(30).optional().default(''),
  dob: z.string().max(20).optional().default(''),
  gender: z.string().max(20).optional().default(''),
  photo_url: z.string().max(300).nullish(),
  status: z.enum(['active', 'on_leave', 'resigned', 'terminated']).optional(),
  password: z.string().min(6).max(200).optional(),
});

router.post('/', requirePermission('employees.create'), validateBody(employeeSchema), asyncHandler(async (req, res) => {
  const d = req.data;
  if (d.role === 'principal' && req.user.role !== 'principal') throw badRequest('Only the principal can create another principal account');
  const id = newId('emp');
  const at = nowIso();
  let credentials;

  const run = db.transaction(() => {
    const account = createAccount({
      schoolId: req.user.school_id, email: d.email, fullName: d.full_name, phone: d.phone,
      role: d.role, password: d.password, department: d.department, designation: d.designation,
      roleId: roleIdFor(req.user.school_id, d.role),
    });
    credentials = { email: d.email, password: account.password };
    const code = d.employee_code || nextEmployeeCode(req.user.school_id);
    db.prepare(
      `INSERT INTO employees (id, school_id, user_id, employee_code, department, designation, employment_type, joining_date,
        qualification, specialization, salary_amount, bank_account, address, emergency_contact, dob, gender, photo_url,
        status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, req.user.school_id, account.id, code, d.department, d.designation, d.employment_type,
      d.joining_date || at.slice(0, 10), d.qualification || null, d.specialization || null, d.salary_amount || 0,
      d.bank_account || null, d.address || null, d.emergency_contact || null, d.dob || null, d.gender || null,
      d.photo_url || null, 'active', at, at);
  });
  run();

  audit(req, {
    action: 'create', module: 'employees', entityType: 'employee', entityId: id,
    summary: `Added ${d.role} ${d.full_name} (${d.department})`,
  });
  res.status(201).json({ id, credentials });
}));

router.patch('/:id', requirePermission('employees.edit'), validateBody(employeeSchema.partial()), asyncHandler(async (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!emp) throw notFound('Employee not found');
  const d = req.data;
  const empFields = ['department', 'designation', 'employment_type', 'joining_date', 'qualification', 'specialization',
    'salary_amount', 'bank_account', 'address', 'emergency_contact', 'dob', 'gender', 'photo_url', 'status', 'employee_code'];
  const fields = [];
  const values = [];
  for (const key of empFields) {
    if (d[key] !== undefined) { fields.push(`${key} = ?`); values.push(d[key]); }
  }
  const userFields = [];
  const userValues = [];
  for (const key of ['full_name', 'phone', 'email']) {
    if (d[key] !== undefined) { userFields.push(`${key} = ?`); userValues.push(d[key]); }
  }

  const run = db.transaction(() => {
    if (fields.length) {
      values.push(nowIso(), emp.id);
      db.prepare(`UPDATE employees SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`).run(...values);
    }
    if (userFields.length) {
      userValues.push(nowIso(), emp.user_id);
      db.prepare(`UPDATE users SET ${userFields.join(', ')}, updated_at = ? WHERE id = ?`).run(...userValues);
    }
    if (d.role) db.prepare('UPDATE users SET role = ?, role_id = ? WHERE id = ?').run(d.role, roleIdFor(req.user.school_id, d.role), emp.user_id);
  });
  run();
  audit(req, { action: 'update', module: 'employees', entityType: 'employee', entityId: emp.id, summary: 'Updated employee record', meta: { fields: Object.keys(d) } });
  res.json({ ok: true });
}));

router.delete('/:id', requirePermission('employees.delete'), asyncHandler(async (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!emp) throw notFound('Employee not found');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(emp.user_id);
  if (user.role === 'principal') throw badRequest('Principal accounts cannot be removed');
  const payrollCount = db.prepare('SELECT COUNT(*) c FROM payroll WHERE employee_id = ?').get(emp.id).c;
  if (payrollCount) throw conflict('This employee has payroll records. Set status to resigned instead of deleting.');

  const run = db.transaction(() => {
    db.prepare('DELETE FROM class_subjects WHERE teacher_id = ?').run(emp.user_id);
    db.prepare("DELETE FROM documents WHERE owner_type = 'employee' AND owner_id = ?").run(emp.id);
    db.prepare('DELETE FROM employees WHERE id = ?').run(emp.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(emp.user_id);
  });
  run();
  audit(req, { action: 'delete', module: 'employees', entityType: 'employee', entityId: emp.id, summary: `Removed employee ${user.full_name}` });
  res.json({ ok: true });
}));

router.post('/:id/documents', requirePermission('employees.documents'), uploader('documents'), asyncHandler(async (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!emp) throw notFound('Employee not found');
  if (!req.file) throw badRequest('No file uploaded');
  const id = newId('doc');
  db.prepare('INSERT INTO documents (id, school_id, owner_type, owner_id, name, category, file_url, mime, size, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.user.school_id, 'employee', emp.id, req.body.name || req.file.originalname, req.body.category || 'general',
      publicUrl(req.file), req.file.mimetype, req.file.size, req.user.id, nowIso());
  res.status(201).json({ id, url: publicUrl(req.file) });
}));

router.delete('/:id/documents/:docId', requirePermission('employees.documents'), asyncHandler(async (req, res) => {
  const doc = db.prepare("SELECT * FROM documents WHERE id = ? AND school_id = ? AND owner_type = 'employee'").get(req.params.docId, req.user.school_id);
  if (!doc) throw notFound('Document not found');
  db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
  if (doc.file_url?.startsWith('/uploads/')) fs.unlink(path.join(UPLOAD_DIR, doc.file_url.replace('/uploads/', '')), () => {});
  res.json({ ok: true });
}));

/* ---------------------------------- leave --------------------------------- */

router.get('/leave/requests', requirePermission('payroll.approve_leave', 'employees.view', 'dashboard.view'), asyncHandler(async (req, res) => {
  const canApprove = req.user.role === 'principal' || req.user.permissions.includes('payroll.approve_leave');
  const rows = db.prepare(
    `SELECT l.*, u.full_name, u.role, e.employee_code, e.department
     FROM leave_applications l JOIN users u ON u.id = l.user_id
     LEFT JOIN employees e ON e.user_id = u.id
     WHERE l.school_id = ? ${canApprove ? '' : 'AND l.user_id = ?'} ORDER BY l.created_at DESC LIMIT 200`,
  ).all(...(canApprove ? [req.user.school_id] : [req.user.school_id, req.user.id]));
  res.json({ items: rows, canApprove });
}));

router.post('/leave/requests', requireAuth, validateBody(z.object({
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(['casual', 'sick', 'earned', 'maternity', 'unpaid', 'other']).default('casual'),
  reason: z.string().min(3).max(500),
  employee_id: z.string().max(64).nullish(),
})), asyncHandler(async (req, res) => {
  if (new Date(req.data.to_date) < new Date(req.data.from_date)) throw badRequest('End date must be on or after the start date');
  const emp = db.prepare('SELECT * FROM employees WHERE user_id = ? AND school_id = ?').get(req.user.id, req.user.school_id);
  const id = newId('lv');
  db.prepare(
    `INSERT INTO leave_applications (id, school_id, user_id, employee_id, from_date, to_date, type, reason, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, req.user.school_id, req.user.id, emp?.id || req.data.employee_id || null, req.data.from_date,
    req.data.to_date, req.data.type, req.data.reason, 'pending', nowIso(), nowIso());

  const principals = db.prepare("SELECT id FROM users WHERE school_id = ? AND role = 'principal'").all(req.user.school_id);
  notifyUsers(req.user.school_id, principals.map((p) => p.id), {
    title: 'Leave request pending',
    body: `${req.user.full_name} requested ${req.data.type} leave from ${req.data.from_date} to ${req.data.to_date}`,
    type: 'warning', link: '/app/hr/leave',
  });
  audit(req, { action: 'create', module: 'leave', entityType: 'leave', entityId: id, summary: 'Submitted leave request' });
  res.status(201).json({ id });
}));

router.post('/leave/requests/:id/decision', requirePermission('payroll.approve_leave'), validateBody(z.object({
  status: z.enum(['approved', 'rejected']),
  decision_note: z.string().max(300).optional().default(''),
})), asyncHandler(async (req, res) => {
  const leave = db.prepare('SELECT * FROM leave_applications WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!leave) throw notFound('Leave request not found');
  if (leave.status !== 'pending') throw badRequest('This request has already been decided');
  db.prepare('UPDATE leave_applications SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?, updated_at = ? WHERE id = ?')
    .run(req.data.status, req.user.id, nowIso(), req.data.decision_note, nowIso(), leave.id);
  notifyUsers(req.user.school_id, [leave.user_id], {
    title: `Leave ${req.data.status}`,
    body: `Your ${leave.type} leave from ${leave.from_date} to ${leave.to_date} was ${req.data.status}.`,
    type: req.data.status === 'approved' ? 'success' : 'warning',
    link: '/app/hr/leave',
  });
  audit(req, {
    action: 'decision', module: 'leave', entityType: 'leave', entityId: leave.id,
    summary: `Leave ${req.data.status} for request ${leave.id}`, meta: { note: req.data.decision_note },
  });
  res.json({ ok: true });
}));

/* ------------------------------- performance ------------------------------ */

router.post('/:id/performance', requirePermission('payroll.performance'), validateBody(z.object({
  period: z.string().max(30),
  rating: z.coerce.number().min(1).max(5),
  strengths: z.string().max(500).optional().default(''),
  improvements: z.string().max(500).optional().default(''),
})), asyncHandler(async (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!emp) throw notFound('Employee not found');
  const id = newId('perf');
  db.prepare('INSERT INTO staff_performance (id, school_id, employee_id, period, rating, strengths, improvements, reviewer_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, req.user.school_id, emp.id, req.data.period, req.data.rating, req.data.strengths, req.data.improvements, req.user.id, nowIso());
  audit(req, { action: 'create', module: 'employees', entityType: 'performance', entityId: id, summary: `Added performance review for employee ${emp.employee_code}` });
  res.status(201).json({ id });
}));

export default router;
