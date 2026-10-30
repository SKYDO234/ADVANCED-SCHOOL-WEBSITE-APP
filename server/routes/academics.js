import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso, newId } from '../db/index.js';
import { validateBody } from '../lib/validate.js';
import { requirePermission } from '../lib/auth.js';
import { badRequest, conflict, notFound, asyncHandler } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { currentSession } from '../lib/defaults.js';

const router = Router();

const sessionIdFrom = (req, override) => override || req.query.sessionId || currentSession(req.user.school_id)?.id || null;

/* --------------------------------- classes -------------------------------- */

router.get('/classes', requirePermission('classes.view', 'students.view', 'attendance.view', 'exams.view', 'homework.view'), asyncHandler(async (req, res) => {
  const schoolId = req.user.school_id;
  const sessionId = sessionIdFrom(req);
  const classes = db.prepare('SELECT * FROM classes WHERE school_id = ? ORDER BY order_index, name').all(schoolId);
  const sections = db.prepare('SELECT * FROM sections WHERE school_id = ? ORDER BY name').all(schoolId);
  const counts = db.prepare(
    "SELECT class_id, section_id, COUNT(*) c FROM students WHERE school_id = ? AND status = 'active' AND session_id = ? GROUP BY class_id, section_id",
  ).all(schoolId, sessionId);
  const teachers = db.prepare(
    "SELECT u.id, u.full_name FROM users u WHERE u.school_id = ? AND u.role IN ('teacher','principal') AND u.status = 'active' ORDER BY u.full_name",
  ).all(schoolId);

  res.json({
    items: classes.map((c) => ({
      ...c,
      studentCount: counts.filter((x) => x.class_id === c.id).reduce((s, x) => s + x.c, 0),
      sections: sections.filter((s) => s.class_id === c.id).map((s) => ({
        ...s,
        studentCount: counts.find((x) => x.section_id === s.id)?.c || 0,
        class_teacher_name: teachers.find((t) => t.id === s.class_teacher_id)?.full_name || null,
      })),
    })),
    teachers,
    subjects: db.prepare('SELECT * FROM subjects WHERE school_id = ? ORDER BY name').all(schoolId),
  });
}));

router.post('/classes', requirePermission('classes.create'), validateBody(z.object({
  name: z.string().min(1).max(40),
  code: z.string().max(20).optional().default(''),
  stream: z.string().max(40).optional().default(''),
  order_index: z.coerce.number().int().min(0).max(100).optional(),
  sections: z.array(z.string().min(1).max(10)).max(10).optional().default(['A']),
})), asyncHandler(async (req, res) => {
  const { name, code, stream, sections } = req.data;
  const exists = db.prepare('SELECT id FROM classes WHERE school_id = ? AND lower(name) = lower(?)').get(req.user.school_id, name);
  if (exists) throw conflict('This class already exists');
  const orderIndex = req.data.order_index ?? db.prepare('SELECT COALESCE(MAX(order_index),0)+1 n FROM classes WHERE school_id = ?').get(req.user.school_id).n;

  const classId = newId('cls');
  const at = nowIso();
  const run = db.transaction(() => {
    db.prepare('INSERT INTO classes (id, school_id, name, code, order_index, stream, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(classId, req.user.school_id, name, code || null, orderIndex, stream || null, at, at);
    const stmt = db.prepare('INSERT INTO sections (id, school_id, class_id, name, capacity, created_at, updated_at) VALUES (?,?,?,?,?,?,?)');
    (sections.length ? sections : ['A']).forEach((s) => stmt.run(newId('sec'), req.user.school_id, classId, s, 40, at, at));
  });
  run();
  audit(req, { action: 'create', module: 'classes', entityType: 'class', entityId: classId, summary: `Created class ${name}` });
  res.status(201).json({ id: classId });
}));

router.patch('/classes/:id', requirePermission('classes.edit'), validateBody(z.object({
  name: z.string().min(1).max(40).optional(),
  code: z.string().max(20).optional(),
  stream: z.string().max(40).optional(),
  order_index: z.coerce.number().int().min(0).max(100).optional(),
})), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM classes WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Class not found');
  const d = req.data;
  db.prepare('UPDATE classes SET name = ?, code = ?, stream = ?, order_index = ?, updated_at = ? WHERE id = ?')
    .run(d.name ?? row.name, d.code ?? row.code, d.stream ?? row.stream, d.order_index ?? row.order_index, nowIso(), row.id);
  audit(req, { action: 'update', module: 'classes', entityType: 'class', entityId: row.id, summary: `Updated class ${d.name || row.name}` });
  res.json({ ok: true });
}));

router.delete('/classes/:id', requirePermission('classes.delete'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM classes WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Class not found');
  const students = db.prepare('SELECT COUNT(*) c FROM students WHERE class_id = ?').get(row.id).c;
  if (students) throw conflict(`Cannot delete: ${students} student(s) are assigned to this class`);
  const run = db.transaction(() => {
    db.prepare('DELETE FROM class_subjects WHERE class_id = ?').run(row.id);
    db.prepare('DELETE FROM sections WHERE class_id = ?').run(row.id);
    db.prepare('DELETE FROM classes WHERE id = ?').run(row.id);
  });
  run();
  audit(req, { action: 'delete', module: 'classes', entityType: 'class', entityId: row.id, summary: `Deleted class ${row.name}` });
  res.json({ ok: true });
}));

router.post('/classes/:id/sections', requirePermission('classes.create'), validateBody(z.object({
  name: z.string().min(1).max(10),
  room: z.string().max(30).optional().default(''),
  capacity: z.coerce.number().int().min(1).max(500).optional().default(40),
  class_teacher_id: z.string().max(64).nullish(),
})), asyncHandler(async (req, res) => {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!cls) throw notFound('Class not found');
  const exists = db.prepare('SELECT id FROM sections WHERE class_id = ? AND lower(name) = lower(?)').get(cls.id, req.data.name);
  if (exists) throw conflict('This section already exists for the class');
  const id = newId('sec');
  const at = nowIso();
  db.prepare('INSERT INTO sections (id, school_id, class_id, name, room, capacity, class_teacher_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, req.user.school_id, cls.id, req.data.name, req.data.room || null, req.data.capacity, req.data.class_teacher_id || null, at, at);
  audit(req, { action: 'create', module: 'classes', entityType: 'section', entityId: id, summary: `Added section ${req.data.name} to ${cls.name}` });
  res.status(201).json({ id });
}));

router.patch('/sections/:id', requirePermission('classes.edit'), validateBody(z.object({
  name: z.string().min(1).max(10).optional(),
  room: z.string().max(30).nullish(),
  capacity: z.coerce.number().int().min(1).max(500).optional(),
  class_teacher_id: z.string().max(64).nullish(),
})), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM sections WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Section not found');
  const d = req.data;
  db.prepare('UPDATE sections SET name = ?, room = ?, capacity = ?, class_teacher_id = ?, updated_at = ? WHERE id = ?')
    .run(d.name ?? row.name, d.room === undefined ? row.room : d.room, d.capacity ?? row.capacity,
      d.class_teacher_id === undefined ? row.class_teacher_id : d.class_teacher_id, nowIso(), row.id);
  audit(req, { action: 'update', module: 'classes', entityType: 'section', entityId: row.id, summary: `Updated section ${d.name || row.name}` });
  res.json({ ok: true });
}));

router.delete('/sections/:id', requirePermission('classes.delete'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM sections WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Section not found');
  const students = db.prepare('SELECT COUNT(*) c FROM students WHERE section_id = ?').get(row.id).c;
  if (students) throw conflict(`Cannot delete: ${students} student(s) are in this section`);
  db.prepare('DELETE FROM sections WHERE id = ?').run(row.id);
  audit(req, { action: 'delete', module: 'classes', entityType: 'section', entityId: row.id, summary: `Deleted section ${row.name}` });
  res.json({ ok: true });
}));

/* -------------------------------- subjects -------------------------------- */

router.get('/subjects', requirePermission('classes.view', 'exams.view', 'homework.view', 'students.view', 'timetable.view'), asyncHandler(async (req, res) => {
  const items = db.prepare('SELECT * FROM subjects WHERE school_id = ? ORDER BY name').all(req.user.school_id);
  const usage = db.prepare(
    'SELECT subject_id, COUNT(*) c FROM class_subjects WHERE school_id = ? AND session_id = ? GROUP BY subject_id',
  ).all(req.user.school_id, sessionIdFrom(req));
  res.json({ items: items.map((s) => ({ ...s, classCount: usage.find((u) => u.subject_id === s.id)?.c || 0 })) });
}));

router.post('/subjects', requirePermission('classes.create'), validateBody(z.object({
  name: z.string().min(1).max(60),
  code: z.string().max(20).optional().default(''),
  type: z.enum(['theory', 'practical', 'both']).default('theory'),
})), asyncHandler(async (req, res) => {
  const exists = db.prepare('SELECT id FROM subjects WHERE school_id = ? AND lower(name) = lower(?)').get(req.user.school_id, req.data.name);
  if (exists) throw conflict('This subject already exists');
  const id = newId('sub');
  const at = nowIso();
  db.prepare('INSERT INTO subjects (id, school_id, name, code, type, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, req.user.school_id, req.data.name, req.data.code || null, req.data.type, at, at);
  audit(req, { action: 'create', module: 'subjects', entityType: 'subject', entityId: id, summary: `Created subject ${req.data.name}` });
  res.status(201).json({ id });
}));

router.patch('/subjects/:id', requirePermission('classes.edit'), validateBody(z.object({
  name: z.string().min(1).max(60).optional(),
  code: z.string().max(20).optional(),
  type: z.enum(['theory', 'practical', 'both']).optional(),
})), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM subjects WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Subject not found');
  db.prepare('UPDATE subjects SET name = ?, code = ?, type = ?, updated_at = ? WHERE id = ?')
    .run(req.data.name ?? row.name, req.data.code ?? row.code, req.data.type ?? row.type, nowIso(), row.id);
  audit(req, { action: 'update', module: 'subjects', entityType: 'subject', entityId: row.id, summary: `Updated subject ${req.data.name || row.name}` });
  res.json({ ok: true });
}));

router.delete('/subjects/:id', requirePermission('classes.delete'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM subjects WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Subject not found');
  const used = db.prepare('SELECT COUNT(*) c FROM class_subjects WHERE subject_id = ?').get(row.id).c;
  if (used) throw conflict(`This subject is assigned to ${used} class(es). Remove those assignments first.`);
  db.prepare('DELETE FROM subjects WHERE id = ?').run(row.id);
  audit(req, { action: 'delete', module: 'subjects', entityType: 'subject', entityId: row.id, summary: `Deleted subject ${row.name}` });
  res.json({ ok: true });
}));

/* -------------------------------- sessions -------------------------------- */

router.get('/sessions', asyncHandler(async (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM academic_sessions WHERE school_id = ? ORDER BY start_date DESC').all(req.user.school_id) });
}));

router.post('/sessions', requirePermission('settings.session'), validateBody(z.object({
  name: z.string().min(4).max(40),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  makeCurrent: z.boolean().optional().default(false),
})), asyncHandler(async (req, res) => {
  const d = req.data;
  if (new Date(d.end_date) <= new Date(d.start_date)) throw badRequest('End date must be after start date');
  const exists = db.prepare('SELECT id FROM academic_sessions WHERE school_id = ? AND name = ?').get(req.user.school_id, d.name);
  if (exists) throw conflict('A session with this name already exists');
  const id = newId('ses');
  const at = nowIso();
  const run = db.transaction(() => {
    if (d.makeCurrent) db.prepare('UPDATE academic_sessions SET is_current = 0 WHERE school_id = ?').run(req.user.school_id);
    db.prepare('INSERT INTO academic_sessions (id, school_id, name, start_date, end_date, is_current, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, req.user.school_id, d.name, d.start_date, d.end_date, d.makeCurrent ? 1 : 0, 'active', at, at);
  });
  run();
  audit(req, { action: 'create', module: 'sessions', entityType: 'session', entityId: id, summary: `Created academic session ${d.name}` });
  res.status(201).json({ id });
}));

router.post('/sessions/:id/current', requirePermission('settings.session'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM academic_sessions WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Session not found');
  const run = db.transaction(() => {
    db.prepare('UPDATE academic_sessions SET is_current = 0 WHERE school_id = ?').run(req.user.school_id);
    db.prepare('UPDATE academic_sessions SET is_current = 1, updated_at = ? WHERE id = ?').run(nowIso(), row.id);
  });
  run();
  audit(req, { action: 'update', module: 'sessions', entityType: 'session', entityId: row.id, summary: `Switched current session to ${row.name}` });
  res.json({ ok: true });
}));

router.delete('/sessions/:id', requirePermission('settings.session'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM academic_sessions WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Session not found');
  if (row.is_current) throw badRequest('Cannot delete the current academic session');
  const students = db.prepare('SELECT COUNT(*) c FROM students WHERE session_id = ?').get(row.id).c;
  if (students) throw conflict(`${students} student record(s) belong to this session`);
  db.prepare('DELETE FROM academic_sessions WHERE id = ?').run(row.id);
  audit(req, { action: 'delete', module: 'sessions', entityType: 'session', entityId: row.id, summary: `Deleted session ${row.name}` });
  res.json({ ok: true });
}));

/* -------------------------------- holidays -------------------------------- */

router.get('/holidays', asyncHandler(async (req, res) => {
  const sessionId = sessionIdFrom(req);
  const rows = db.prepare(
    'SELECT * FROM holidays WHERE school_id = ? AND (session_id = ? OR session_id IS NULL) ORDER BY date',
  ).all(req.user.school_id, sessionId);
  res.json({ items: rows });
}));

router.post('/holidays', requirePermission('settings.session'), validateBody(z.object({
  name: z.string().min(2).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  type: z.enum(['holiday', 'exam', 'event', 'vacation', 'meeting']).default('holiday'),
  description: z.string().max(300).optional().default(''),
})), asyncHandler(async (req, res) => {
  const id = newId('hol');
  db.prepare('INSERT INTO holidays (id, school_id, session_id, name, date, end_date, type, description, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, req.user.school_id, sessionIdFrom(req), req.data.name, req.data.date, req.data.end_date || null,
      req.data.type, req.data.description || null, nowIso());
  audit(req, { action: 'create', module: 'calendar', entityType: 'holiday', entityId: id, summary: `Added ${req.data.type}: ${req.data.name}` });
  res.status(201).json({ id });
}));

router.delete('/holidays/:id', requirePermission('settings.session'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM holidays WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Entry not found');
  db.prepare('DELETE FROM holidays WHERE id = ?').run(row.id);
  audit(req, { action: 'delete', module: 'calendar', entityType: 'holiday', entityId: row.id, summary: `Removed calendar entry ${row.name}` });
  res.json({ ok: true });
}));

/* ----------------------------- subject assignment -------------------------- */

router.get('/assignments', requirePermission('classes.view'), asyncHandler(async (req, res) => {
  const sessionId = sessionIdFrom(req);
  const where = ['cs.school_id = ?', 'cs.session_id = ?'];
  const params = [req.user.school_id, sessionId];
  if (req.query.classId) { where.push('cs.class_id = ?'); params.push(req.query.classId); }
  if (req.query.teacherId) { where.push('cs.teacher_id = ?'); params.push(req.query.teacherId); }

  const rows = db.prepare(
    `SELECT cs.*, c.name AS class_name, sec.name AS section_name, s.name AS subject_name, s.type AS subject_type,
            u.full_name AS teacher_name
     FROM class_subjects cs
     LEFT JOIN classes c ON c.id = cs.class_id
     LEFT JOIN sections sec ON sec.id = cs.section_id
     LEFT JOIN subjects s ON s.id = cs.subject_id
     LEFT JOIN users u ON u.id = cs.teacher_id
     WHERE ${where.join(' AND ')} ORDER BY c.order_index, sec.name, s.name`,
  ).all(...params);
  res.json({ items: rows });
}));

router.post('/assignments', requirePermission('classes.assign'), validateBody(z.object({
  sessionId: z.string().optional(),
  items: z.array(z.object({
    class_id: z.string().min(1),
    section_id: z.string().nullish(),
    subject_id: z.string().min(1),
    teacher_id: z.string().nullish(),
    periods_week: z.coerce.number().int().min(0).max(40).optional().default(5),
  })).min(1).max(200),
})), asyncHandler(async (req, res) => {
  const sessionId = sessionIdFrom(req, req.data.sessionId);
  if (!sessionId) throw badRequest('An academic session is required');
  const at = nowIso();
  let created = 0;
  let updated = 0;
  const run = db.transaction(() => {
    for (const item of req.data.items) {
      const existing = db.prepare(
        `SELECT * FROM class_subjects WHERE school_id = ? AND session_id = ? AND class_id = ?
         AND ifnull(section_id,'') = ifnull(?,'') AND subject_id = ?`,
      ).get(req.user.school_id, sessionId, item.class_id, item.section_id || null, item.subject_id);
      if (existing) {
        db.prepare('UPDATE class_subjects SET teacher_id = ?, periods_week = ?, updated_at = ? WHERE id = ?')
          .run(item.teacher_id || null, item.periods_week ?? 5, at, existing.id);
        updated += 1;
      } else {
        db.prepare(
          `INSERT INTO class_subjects (id, school_id, session_id, class_id, section_id, subject_id, teacher_id, periods_week, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        ).run(newId('cs'), req.user.school_id, sessionId, item.class_id, item.section_id || null, item.subject_id,
          item.teacher_id || null, item.periods_week ?? 5, at, at);
        created += 1;
      }
    }
  });
  run();
  audit(req, { action: 'assign', module: 'classes', summary: `Subject teacher assignments: ${created} created, ${updated} updated`, meta: { sessionId } });
  res.json({ ok: true, created, updated });
}));

router.delete('/assignments/:id', requirePermission('classes.assign'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM class_subjects WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Assignment not found');
  db.prepare('DELETE FROM class_subjects WHERE id = ?').run(row.id);
  audit(req, { action: 'delete', module: 'classes', entityType: 'class_subject', entityId: row.id, summary: 'Removed subject assignment' });
  res.json({ ok: true });
}));

/* -------------------------------- timetable ------------------------------- */

router.get('/periods', asyncHandler(async (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM timetable_periods WHERE school_id = ? ORDER BY sort_order').all(req.user.school_id) });
}));

router.post('/periods', requirePermission('timetable.periods'), validateBody(z.object({
  name: z.string().min(1).max(30),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  is_break: z.boolean().optional().default(false),
})), asyncHandler(async (req, res) => {
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 n FROM timetable_periods WHERE school_id = ?').get(req.user.school_id).n;
  const id = newId('per');
  db.prepare('INSERT INTO timetable_periods (id, school_id, name, start_time, end_time, is_break, sort_order) VALUES (?,?,?,?,?,?,?)')
    .run(id, req.user.school_id, req.data.name, req.data.start_time, req.data.end_time, req.data.is_break ? 1 : 0, maxOrder);
  audit(req, { action: 'create', module: 'timetable', entityType: 'period', entityId: id, summary: `Added period ${req.data.name}` });
  res.status(201).json({ id });
}));

router.delete('/periods/:id', requirePermission('timetable.periods'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM timetable_periods WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Period not found');
  const used = db.prepare('SELECT COUNT(*) c FROM timetable_entries WHERE period_id = ?').get(row.id).c;
  if (used) throw conflict('This period is used in the timetable. Clear those cells first.');
  db.prepare('DELETE FROM timetable_periods WHERE id = ?').run(row.id);
  res.json({ ok: true });
}));

router.get('/timetable', requirePermission('timetable.view'), asyncHandler(async (req, res) => {
  const sessionId = sessionIdFrom(req);
  const schoolId = req.user.school_id;
  const periods = db.prepare('SELECT * FROM timetable_periods WHERE school_id = ? ORDER BY sort_order').all(schoolId);
  const classes = db.prepare('SELECT * FROM classes WHERE school_id = ? ORDER BY order_index').all(schoolId);
  const sections = db.prepare('SELECT * FROM sections WHERE school_id = ? ORDER BY name').all(schoolId);
  const where = ['te.school_id = ?', 'te.session_id = ?'];
  const params = [schoolId, sessionId];
  if (req.query.sectionId) { where.push('te.section_id = ?'); params.push(req.query.sectionId); }
  if (req.query.teacherId) { where.push('te.teacher_id = ?'); params.push(req.query.teacherId); }

  const entries = db.prepare(
    `SELECT te.*, s.name AS subject_name, u.full_name AS teacher_name, sec.name AS section_name, c.name AS class_name
     FROM timetable_entries te
     LEFT JOIN subjects s ON s.id = te.subject_id
     LEFT JOIN users u ON u.id = te.teacher_id
     LEFT JOIN sections sec ON sec.id = te.section_id
     LEFT JOIN classes c ON c.id = sec.class_id
     WHERE ${where.join(' AND ')}`,
  ).all(...params);
  res.json({ periods, classes, sections, entries, sessionId });
}));

router.post('/timetable', requirePermission('timetable.manage'), validateBody(z.object({
  sessionId: z.string().optional(),
  section_id: z.string().min(1),
  period_id: z.string().min(1),
  day: z.coerce.number().int().min(1).max(7),
  subject_id: z.string().nullish(),
  teacher_id: z.string().nullish(),
  room: z.string().max(30).nullish(),
})), asyncHandler(async (req, res) => {
  const sessionId = sessionIdFrom(req, req.data.sessionId);
  const d = req.data;
  const schoolId = req.user.school_id;

  // Conflict detection: teacher already booked in this slot, or section slot occupied.
  if (d.teacher_id) {
    const teacherClash = db.prepare(
      `SELECT te.*, sec.name AS section_name, c.name AS class_name FROM timetable_entries te
       LEFT JOIN sections sec ON sec.id = te.section_id LEFT JOIN classes c ON c.id = sec.class_id
       WHERE te.school_id = ? AND te.session_id = ? AND te.day = ? AND te.period_id = ? AND te.teacher_id = ? AND te.section_id != ?`,
    ).get(schoolId, sessionId, d.day, d.period_id, d.teacher_id, d.section_id);
    if (teacherClash) {
      throw conflict(`Teacher is already assigned to ${teacherClash.class_name} ${teacherClash.section_name} in this period`);
    }
  }

  const existing = db.prepare('SELECT * FROM timetable_entries WHERE section_id = ? AND day = ? AND period_id = ?')
    .get(d.section_id, d.day, d.period_id);
  const at = nowIso();
  if (existing) {
    if (!d.subject_id) {
      db.prepare('DELETE FROM timetable_entries WHERE id = ?').run(existing.id);
      return res.json({ ok: true, removed: true });
    }
    db.prepare('UPDATE timetable_entries SET subject_id = ?, teacher_id = ?, room = ?, updated_at = ? WHERE id = ?')
      .run(d.subject_id, d.teacher_id || null, d.room || null, at, existing.id);
    return res.json({ ok: true, id: existing.id, updated: true });
  }
  if (!d.subject_id) return res.json({ ok: true, skipped: true });

  const id = newId('tte');
  db.prepare(
    'INSERT INTO timetable_entries (id, school_id, session_id, section_id, period_id, day, subject_id, teacher_id, room, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(id, schoolId, sessionId, d.section_id, d.period_id, d.day, d.subject_id, d.teacher_id || null, d.room || null, at, at);
  audit(req, { action: 'update', module: 'timetable', entityType: 'timetable_entry', entityId: id, summary: 'Updated timetable slot' });
  res.status(201).json({ id });
}));

router.delete('/timetable/:id', requirePermission('timetable.manage'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM timetable_entries WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Timetable entry not found');
  db.prepare('DELETE FROM timetable_entries WHERE id = ?').run(row.id);
  res.json({ ok: true });
}));

export default router;
