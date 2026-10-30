import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso, newId, getSetting } from '../db/index.js';
import { validateBody, pagination } from '../lib/validate.js';
import { requirePermission, can } from '../lib/auth.js';
import { badRequest, forbidden, notFound, asyncHandler } from '../lib/errors.js';
import { audit, notifyUsers } from '../lib/audit.js';
import { currentSession } from '../lib/defaults.js';
import { sendTable } from '../lib/export.js';
import { tableReportPdf, createDoc, finishDoc, drawLetterhead, drawTable, COLORS } from '../lib/pdf.js';
import { streamPdf } from '../lib/pdf.js';

const router = Router();

const STATUSES = ['present', 'absent', 'late', 'leave', 'half_day'];
const today = () => new Date().toISOString().slice(0, 10);

function assertCanMark(req, classId, sectionId) {
  if (req.user.role !== 'teacher') return;
  const session = currentSession(req.user.school_id);
  const allowed = db.prepare(
    `SELECT 1 FROM class_subjects WHERE school_id = ? AND session_id = ? AND class_id = ?
     AND (section_id = ? OR section_id IS NULL OR ? IS NULL) AND teacher_id = ? LIMIT 1`,
  ).get(req.user.school_id, session?.id, classId, sectionId, sectionId, req.user.id);
  if (!allowed) throw forbidden('You can only mark attendance for classes assigned to you');
}

function lockWindow(req) {
  const days = Number(getSetting(req.user.school_id, 'academic', 'attendanceLockDays', 7));
  if (!days) return null;
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/* -------------------------------- students -------------------------------- */

router.get('/students/grid', requirePermission('attendance.view', 'attendance.mark'), asyncHandler(async (req, res) => {
  const date = req.query.date || today();
  const { classId, sectionId } = req.query;
  if (!classId) throw badRequest('classId is required');
  assertCanMark(req, classId, sectionId);

  const students = db.prepare(
    `SELECT s.id, s.full_name, s.roll_no, s.admission_no, s.photo_url, s.section_id,
            a.status, a.remark, a.id AS attendance_id, a.updated_at
     FROM students s
     LEFT JOIN attendance a ON a.entity_id = s.id AND a.entity_type = 'student' AND a.date = ?
     WHERE s.school_id = ? AND s.class_id = ? AND (? IS NULL OR s.section_id = ?) AND s.status = 'active'
     ORDER BY CAST(s.roll_no AS INTEGER), s.full_name`,
  ).all(date, req.user.school_id, classId, sectionId || null, sectionId || null);

  const markable = req.user.role !== 'teacher' || can(req.user, 'attendance.mark');
  res.json({
    date,
    students,
    marked: students.filter((s) => s.status).length,
    canEdit: markable && (!lockWindow(req) || String(date) >= lockWindow(req)),
    summary: STATUSES.reduce((acc, s) => ({ ...acc, [s]: students.filter((x) => x.status === s).length }), {}),
  });
}));

router.post('/students', requirePermission('attendance.mark'), validateBody(z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  classId: z.string().min(1),
  sectionId: z.string().nullish(),
  records: z.array(z.object({
    student_id: z.string().min(1),
    status: z.enum(STATUSES),
    remark: z.string().max(200).optional().default(''),
  })).min(1).max(500),
})), asyncHandler(async (req, res) => {
  const { date, classId, sectionId, records } = req.data;
  assertCanMark(req, classId, sectionId);
  if (new Date(date) > new Date()) throw badRequest('Cannot mark attendance for a future date');
  const lock = lockWindow(req);
  if (lock && date < lock && !can(req.user, 'attendance.correct')) {
    throw forbidden(`Attendance older than ${getSetting(req.user.school_id, 'academic', 'attendanceLockDays', 7)} days requires correction permission`);
  }

  const session = currentSession(req.user.school_id);
  const at = nowIso();
  let inserted = 0;
  let updated = 0;
  const absentees = [];

  const run = db.transaction(() => {
    for (const rec of records) {
      const student = db.prepare('SELECT id, full_name, class_id, section_id FROM students WHERE id = ? AND school_id = ?')
        .get(rec.student_id, req.user.school_id);
      if (!student) continue;
      const existing = db.prepare(
        "SELECT * FROM attendance WHERE school_id = ? AND date = ? AND entity_type = 'student' AND entity_id = ?",
      ).get(req.user.school_id, date, student.id);
      if (existing) {
        if (existing.status !== rec.status || (existing.remark || '') !== (rec.remark || '')) updated += 1;
        db.prepare('UPDATE attendance SET status = ?, remark = ?, marked_by = ?, updated_at = ? WHERE id = ?')
          .run(rec.status, rec.remark || null, req.user.id, at, existing.id);
      } else {
        db.prepare(
          `INSERT INTO attendance (id, school_id, session_id, date, entity_type, entity_id, status, class_id, section_id, remark, marked_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(newId('att'), req.user.school_id, session?.id || null, date, 'student', student.id, rec.status,
          student.class_id, student.section_id, rec.remark || null, req.user.id, at, at);
        inserted += 1;
      }
      if (rec.status === 'absent') absentees.push(student);
    }
  });
  run();

  // Parent notifications for absences (respects school setting).
  const notify = getSetting(req.user.school_id, 'attendance', 'notifyParentsOnAbsence', true);
  if (notify && absentees.length) {
    for (const student of absentees.slice(0, 200)) {
      const parents = db.prepare('SELECT parent_user_id FROM parent_students WHERE student_id = ?').all(student.id);
      notifyUsers(req.user.school_id, parents.map((p) => p.parent_user_id), {
        title: 'Absence recorded',
        body: `${student.full_name} was marked absent on ${date}.`,
        type: 'warning',
        link: '/portal/attendance',
      });
    }
  }

  audit(req, {
    action: 'mark', module: 'attendance', entityType: 'class', entityId: classId,
    summary: `Attendance for ${date}: ${inserted} new, ${updated} updated, ${absentees.length} absent`,
    meta: { date, classId, sectionId },
  });
  res.json({ inserted, updated, absentees: absentees.length });
}));

router.patch('/:id', requirePermission('attendance.correct'), validateBody(z.object({
  status: z.enum(STATUSES),
  remark: z.string().max(200).optional().default(''),
  reason: z.string().min(3).max(300),
})), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM attendance WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Attendance record not found');
  db.prepare('UPDATE attendance SET status = ?, remark = ?, marked_by = ?, updated_at = ? WHERE id = ?')
    .run(req.data.status, req.data.remark || null, req.user.id, nowIso(), row.id);
  audit(req, {
    action: 'correct', module: 'attendance', entityType: 'attendance', entityId: row.id,
    summary: `Corrected attendance ${row.date} from ${row.status} to ${req.data.status}`,
    meta: { before: { status: row.status, remark: row.remark }, after: { status: req.data.status }, reason: req.data.reason },
  });
  res.json({ ok: true });
}));

router.get('/students/summary', requirePermission('attendance.report', 'attendance.view'), asyncHandler(async (req, res) => {
  const from = req.query.from || `${new Date().toISOString().slice(0, 7)}-01`;
  const to = req.query.to || today();
  const where = ["s.school_id = ?", "s.status = 'active'"];
  const params = [req.user.school_id];
  if (req.query.classId && req.query.classId !== 'all') { where.push('s.class_id = ?'); params.push(req.query.classId); }
  if (req.query.sectionId && req.query.sectionId !== 'all') { where.push('s.section_id = ?'); params.push(req.query.sectionId); }

  const rows = db.prepare(
    `SELECT s.id, s.full_name, s.roll_no, s.admission_no, c.name AS class_name, sec.name AS section_name,
       COUNT(a.id) AS marked,
       SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
       SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent,
       SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS late,
       SUM(CASE WHEN a.status = 'leave' THEN 1 ELSE 0 END) AS leave_count,
       SUM(CASE WHEN a.status = 'half_day' THEN 1 ELSE 0 END) AS half_day
     FROM students s
     LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id
     LEFT JOIN attendance a ON a.entity_id = s.id AND a.entity_type = 'student' AND a.date BETWEEN ? AND ?
     WHERE ${where.join(' AND ')}
     GROUP BY s.id ORDER BY c.order_index, sec.name, CAST(s.roll_no AS INTEGER)`,
  ).all(...params, from, to).map((r) => ({
    ...r,
    percentage: r.marked ? Math.round(((r.present || 0) + (r.late || 0) + (r.half_day || 0) * 0.5) / r.marked * 100) : null,
  }));

  res.json({ from, to, items: rows });
}));

router.get('/students/report', requirePermission('attendance.report'), asyncHandler(async (req, res) => {
  const from = req.query.from || `${new Date().toISOString().slice(0, 7)}-01`;
  const to = req.query.to || today();
  const where = ['a.school_id = ?', 'a.entity_type = ?', 'a.date BETWEEN ? AND ?'];
  const params = [req.user.school_id, 'student', from, to];
  if (req.query.classId && req.query.classId !== 'all') { where.push('a.class_id = ?'); params.push(req.query.classId); }
  if (req.query.sectionId && req.query.sectionId !== 'all') { where.push('a.section_id = ?'); params.push(req.query.sectionId); }
  if (req.query.status && req.query.status !== 'all') { where.push('a.status = ?'); params.push(req.query.status); }

  const rows = db.prepare(
    `SELECT a.date, a.status, a.remark, s.full_name, s.admission_no, s.roll_no, c.name AS class_name, sec.name AS section_name
     FROM attendance a JOIN students s ON s.id = a.entity_id
     LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id
     WHERE ${where.join(' AND ')} ORDER BY a.date DESC, s.full_name LIMIT 5000`,
  ).all(...params);

  if (String(req.query.format || '') === 'pdf') {
    const doc = tableReportPdf({
      school: req.user.school, title: 'Attendance Register', subtitle: `${from} to ${to}`,
      columns: [
        { label: 'Date', key: 'date', pdfWidth: 70 },
        { label: 'Student', key: 'full_name', pdfWidth: 150 },
        { label: 'Class', value: (r) => `${r.class_name || ''} ${r.section_name || ''}`, pdfWidth: 70 },
        { label: 'Roll', key: 'roll_no', pdfWidth: 40 },
        { label: 'Status', key: 'status', pdfWidth: 60 },
        { label: 'Remark', key: 'remark', pdfWidth: 110 },
      ],
      rows,
    });
    return streamPdf(res, doc, `attendance-${from}-to-${to}.pdf`);
  }

  await sendTable(req, res, {
    filename: `attendance-${from}-to-${to}`,
    title: 'Attendance Register',
    meta: [`${from} to ${to}`],
    columns: [
      { label: 'Date', key: 'date' },
      { label: 'Student', key: 'full_name' },
      { label: 'Admission No', key: 'admission_no' },
      { label: 'Class', key: 'class_name' },
      { label: 'Section', key: 'section_name' },
      { label: 'Roll', key: 'roll_no' },
      { label: 'Status', key: 'status' },
      { label: 'Remark', key: 'remark' },
    ],
    rows,
  });
}));

/* -------------------------------- employees ------------------------------- */

router.get('/employees/grid', requirePermission('attendance.staff', 'attendance.view'), asyncHandler(async (req, res) => {
  const date = req.query.date || today();
  const rows = db.prepare(
    `SELECT e.id, u.full_name, e.employee_code, e.department, e.designation, u.role, e.photo_url,
            a.status, a.remark, a.id AS attendance_id
     FROM employees e JOIN users u ON u.id = e.user_id
     LEFT JOIN attendance a ON a.entity_id = e.id AND a.entity_type = 'employee' AND a.date = ?
     WHERE e.school_id = ? AND e.status IN ('active','on_leave') ORDER BY e.department, u.full_name`,
  ).all(date, req.user.school_id);
  res.json({
    date, employees: rows,
    marked: rows.filter((r) => r.status).length,
    summary: STATUSES.reduce((acc, s) => ({ ...acc, [s]: rows.filter((x) => x.status === s).length }), {}),
  });
}));

router.post('/employees', requirePermission('attendance.staff'), validateBody(z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  records: z.array(z.object({
    employee_id: z.string().min(1),
    status: z.enum(STATUSES),
    remark: z.string().max(200).optional().default(''),
  })).min(1).max(500),
})), asyncHandler(async (req, res) => {
  const { date, records } = req.data;
  if (new Date(date) > new Date()) throw badRequest('Cannot mark attendance for a future date');
  const at = nowIso();
  let saved = 0;
  const run = db.transaction(() => {
    for (const rec of records) {
      const exists = db.prepare(
        "SELECT id FROM attendance WHERE school_id = ? AND date = ? AND entity_type = 'employee' AND entity_id = ?",
      ).get(req.user.school_id, date, rec.employee_id);
      if (exists) {
        db.prepare('UPDATE attendance SET status = ?, remark = ?, marked_by = ?, updated_at = ? WHERE id = ?')
          .run(rec.status, rec.remark || null, req.user.id, at, exists.id);
      } else {
        db.prepare(
          `INSERT INTO attendance (id, school_id, session_id, date, entity_type, entity_id, status, remark, marked_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(newId('att'), req.user.school_id, currentSession(req.user.school_id)?.id || null, date, 'employee',
          rec.employee_id, rec.status, rec.remark || null, req.user.id, at, at);
      }
      saved += 1;
    }
  });
  run();
  audit(req, { action: 'mark', module: 'attendance', summary: `Employee attendance ${date}: ${saved} records saved` });
  res.json({ saved });
}));

router.get('/employees/summary', requirePermission('attendance.report'), asyncHandler(async (req, res) => {
  const from = req.query.from || `${new Date().toISOString().slice(0, 7)}-01`;
  const to = req.query.to || today();
  const rows = db.prepare(
    `SELECT e.id, u.full_name, e.employee_code, e.department, e.designation,
       COUNT(a.id) marked,
       SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) present,
       SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) absent,
       SUM(CASE WHEN a.status = 'leave' THEN 1 ELSE 0 END) leave_count,
       SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) late
     FROM employees e JOIN users u ON u.id = e.user_id
     LEFT JOIN attendance a ON a.entity_id = e.id AND a.entity_type = 'employee' AND a.date BETWEEN ? AND ?
     WHERE e.school_id = ? GROUP BY e.id ORDER BY u.full_name`,
  ).all(from, to, req.user.school_id).map((r) => ({
    ...r,
    percentage: r.marked ? Math.round(((r.present || 0) + (r.late || 0)) / r.marked * 100) : null,
  }));
  res.json({ from, to, items: rows });
}));

/* ----------------------------------- self --------------------------------- */

router.get('/me', asyncHandler(async (req, res) => {
  const limit = pagination(req).limit;
  if (req.user.role === 'student') {
    const student = db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.user.id);
    if (!student) return res.json({ items: [] });
    return res.json({ items: db.prepare('SELECT * FROM attendance WHERE entity_id = ? ORDER BY date DESC LIMIT ?').all(student.id, limit) });
  }
  if (req.user.role === 'parent') {
    const ids = db.prepare('SELECT student_id FROM parent_students WHERE parent_user_id = ?').all(req.user.id).map((r) => r.student_id);
    if (!ids.length) return res.json({ items: [] });
    return res.json({
      items: db.prepare(
        `SELECT a.*, s.full_name FROM attendance a JOIN students s ON s.id = a.entity_id
         WHERE a.entity_id IN (${ids.map(() => '?').join(',')}) ORDER BY a.date DESC LIMIT ?`,
      ).all(...ids, limit),
    });
  }
  const emp = db.prepare('SELECT id FROM employees WHERE user_id = ?').get(req.user.id);
  if (!emp) return res.json({ items: [] });
  res.json({ items: db.prepare('SELECT * FROM attendance WHERE entity_id = ? AND entity_type = ? ORDER BY date DESC LIMIT ?').all(emp.id, 'employee', limit) });
}));

router.get('/overview', requirePermission('attendance.view'), asyncHandler(async (req, res) => {
  const date = req.query.date || today();
  const rows = db.prepare(
    `SELECT c.id AS class_id, c.name AS class_name, sec.id AS section_id, sec.name AS section_name,
       COUNT(DISTINCT s.id) AS total_students,
       SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) present,
       SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) absent,
       SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) late,
       COUNT(a.id) marked
     FROM classes c
     JOIN sections sec ON sec.class_id = c.id
     LEFT JOIN students s ON s.section_id = sec.id AND s.status = 'active'
     LEFT JOIN attendance a ON a.entity_id = s.id AND a.entity_type = 'student' AND a.date = ?
     WHERE c.school_id = ? GROUP BY sec.id ORDER BY c.order_index, sec.name`,
  ).all(date, req.user.school_id);
  res.json({ date, items: rows });
}));

export default router;
