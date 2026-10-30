import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso, newId } from '../db/index.js';
import { validateBody, pagination } from '../lib/validate.js';
import { requirePermission } from '../lib/auth.js';
import { badRequest, conflict, forbidden, notFound, asyncHandler } from '../lib/errors.js';
import { audit, notifyUsers } from '../lib/audit.js';
import { currentSession } from '../lib/defaults.js';
import { publicUrl, uploader } from '../lib/upload.js';
import { notifyClass } from '../lib/notify.js';

const router = Router();

function teacherSectionIds(user) {
  const sessions = currentSession(user.school_id);
  return db.prepare(
    'SELECT DISTINCT section_id, class_id FROM class_subjects WHERE school_id = ? AND session_id = ? AND teacher_id = ?',
  ).all(user.school_id, sessions?.id, user.id);
}

function scopeClause(req) {
  if (req.user.role !== 'teacher') return { sql: '1 = 1', params: [] };
  const scopes = teacherSectionIds(req.user);
  if (!scopes.length) return { sql: '0', params: [] };
  return {
    sql: `(${scopes.map(() => '(a.class_id = ? AND (a.section_id = ? OR a.section_id IS NULL))').join(' OR ')})`,
    params: scopes.flatMap((s) => [s.class_id, s.section_id]),
  };
}

/* -------------------------------- assignments ------------------------------ */

router.get('/assignments', requirePermission('homework.view'), asyncHandler(async (req, res) => {
  const { limit, offset, page } = pagination(req);
  const where = ['a.school_id = ?'];
  const params = [req.user.school_id];

  if (['student', 'parent'].includes(req.user.role)) {
    const ids = req.user.role === 'student'
      ? [db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.user.id)?.id].filter(Boolean)
      : db.prepare('SELECT student_id id FROM parent_students WHERE parent_user_id = ?').all(req.user.id).map((r) => r.id);
    if (!ids.length) return res.json({ items: [], total: 0, page, limit, pages: 1 });
    const students = db.prepare(`SELECT class_id, section_id FROM students WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    where.push(`(${students.map(() => '(a.class_id = ? AND (a.section_id IS NULL OR a.section_id = ?))').join(' OR ')})`);
    students.forEach((s) => params.push(s.class_id, s.section_id));
    where.push("a.status = 'published'");
  } else {
    const scope = scopeClause(req);
    where.push(scope.sql);
    params.push(...scope.params);
    if (req.query.classId) { where.push('a.class_id = ?'); params.push(req.query.classId); }
    if (req.query.sectionId) { where.push('a.section_id = ?'); params.push(req.query.sectionId); }
    if (req.query.subjectId) { where.push('a.subject_id = ?'); params.push(req.query.subjectId); }
    if (req.query.status && req.query.status !== 'all') { where.push('a.status = ?'); params.push(req.query.status); }
  }
  if (req.query.q) { where.push('a.title LIKE ?'); params.push(`%${req.query.q}%`); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const total = db.prepare(`SELECT COUNT(*) c FROM assignments a ${whereSql}`).get(...params).c;
  const items = db.prepare(
    `SELECT a.*, c.name AS class_name, sec.name AS section_name, s.name AS subject_name, u.full_name AS teacher_name,
       (SELECT COUNT(*) FROM assignment_submissions x WHERE x.assignment_id = a.id) submissions,
       (SELECT COUNT(*) FROM students st WHERE st.class_id = a.class_id
          AND (a.section_id IS NULL OR st.section_id = a.section_id) AND st.status = 'active') class_strength
     FROM assignments a
     LEFT JOIN classes c ON c.id = a.class_id LEFT JOIN sections sec ON sec.id = a.section_id
     LEFT JOIN subjects s ON s.id = a.subject_id LEFT JOIN users u ON u.id = a.teacher_id
     ${whereSql} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

const assignmentSchema = z.object({
  title: z.string().min(3).max(160),
  description: z.string().max(4000).optional().default(''),
  instructions: z.string().max(2000).optional().default(''),
  class_id: z.string().min(1),
  section_id: z.string().nullish(),
  subject_id: z.string().nullish(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  max_marks: z.coerce.number().min(0).max(1000).optional().default(20),
  attachment_url: z.string().max(300).nullish(),
  status: z.enum(['draft', 'published', 'closed']).optional().default('published'),
});

router.post('/assignments', requirePermission('homework.create'), validateBody(assignmentSchema), asyncHandler(async (req, res) => {
  const d = req.data;
  if (req.user.role === 'teacher') {
    const owns = teacherSectionIds(req.user).some((s) => s.class_id === d.class_id && (!d.section_id || s.section_id === d.section_id || !s.section_id));
    if (!owns) throw forbidden('You can only assign homework to your own classes');
  }
  const id = newId('asg');
  db.prepare(
    `INSERT INTO assignments (id, school_id, session_id, class_id, section_id, subject_id, teacher_id, title, description,
      instructions, due_date, max_marks, attachment_url, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, req.user.school_id, currentSession(req.user.school_id)?.id, d.class_id, d.section_id || null,
    d.subject_id || null, req.user.id, d.title, d.description, d.instructions, d.due_date, d.max_marks,
    d.attachment_url || null, d.status, nowIso(), nowIso());

  if (d.status === 'published') {
    const subject = d.subject_id ? db.prepare('SELECT name FROM subjects WHERE id = ?').get(d.subject_id)?.name : 'Homework';
    notifyClass({
      schoolId: req.user.school_id, classId: d.class_id, sectionId: d.section_id,
      title: `New ${subject} assignment`,
      body: `${d.title} — due ${d.due_date}`,
      link: '/portal/homework', type: 'info',
    });
  }
  audit(req, { action: 'create', module: 'homework', entityType: 'assignment', entityId: id, summary: `Created assignment "${d.title}"` });
  res.status(201).json({ id });
}));

router.patch('/assignments/:id', requirePermission('homework.edit'), validateBody(assignmentSchema.partial()), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM assignments WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Assignment not found');
  if (req.user.role === 'teacher' && row.teacher_id !== req.user.id) throw forbidden('You can only edit your own assignments');
  const d = req.data;
  db.prepare(
    `UPDATE assignments SET title = ?, description = ?, instructions = ?, due_date = ?, max_marks = ?, attachment_url = ?,
      status = ?, section_id = ?, subject_id = ?, updated_at = ? WHERE id = ?`,
  ).run(d.title ?? row.title, d.description ?? row.description, d.instructions ?? row.instructions,
    d.due_date ?? row.due_date, d.max_marks ?? row.max_marks, d.attachment_url === undefined ? row.attachment_url : d.attachment_url,
    d.status ?? row.status, d.section_id === undefined ? row.section_id : d.section_id,
    d.subject_id === undefined ? row.subject_id : d.subject_id, nowIso(), row.id);
  audit(req, { action: 'update', module: 'homework', entityType: 'assignment', entityId: row.id, summary: `Updated assignment "${d.title || row.title}"` });
  res.json({ ok: true });
}));

router.delete('/assignments/:id', requirePermission('homework.edit'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM assignments WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Assignment not found');
  if (req.user.role === 'teacher' && row.teacher_id !== req.user.id) throw forbidden();
  db.prepare('DELETE FROM assignment_submissions WHERE assignment_id = ?').run(row.id);
  db.prepare('DELETE FROM assignments WHERE id = ?').run(row.id);
  audit(req, { action: 'delete', module: 'homework', entityType: 'assignment', entityId: row.id, summary: `Deleted assignment "${row.title}"` });
  res.json({ ok: true });
}));

router.get('/assignments/:id', requirePermission('homework.view'), asyncHandler(async (req, res) => {
  const row = db.prepare(
    `SELECT a.*, c.name AS class_name, sec.name AS section_name, s.name AS subject_name, u.full_name AS teacher_name
     FROM assignments a LEFT JOIN classes c ON c.id = a.class_id LEFT JOIN sections sec ON sec.id = a.section_id
     LEFT JOIN subjects s ON s.id = a.subject_id LEFT JOIN users u ON u.id = a.teacher_id
     WHERE a.id = ? AND a.school_id = ?`,
  ).get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Assignment not found');

  const submissions = ['student', 'parent'].includes(req.user.role)
    ? []
    : db.prepare(
      `SELECT sub.*, st.full_name, st.admission_no, st.roll_no FROM assignment_submissions sub
       JOIN students st ON st.id = sub.student_id WHERE sub.assignment_id = ? ORDER BY sub.submitted_at DESC`,
    ).all(row.id);

  const mine = db.prepare(
    `SELECT sub.* FROM assignment_submissions sub JOIN students st ON st.id = sub.student_id
     WHERE sub.assignment_id = ? AND st.user_id = ?`,
  ).get(row.id, req.user.id) || null;

  res.json({ ...row, submissions, mine });
}));

router.post('/assignments/:id/submit', requirePermission('homework.submit'), uploader('submissions', { maxMb: 10 }), asyncHandler(async (req, res) => {
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!assignment) throw notFound('Assignment not found');
  const student = db.prepare('SELECT * FROM students WHERE user_id = ?').get(req.user.id);
  if (!student) throw badRequest('This account is not linked to a student profile');
  const existing = db.prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?').get(assignment.id, student.id);
  if (existing && existing.status === 'graded') throw conflict('This submission has already been graded');

  const content = req.body?.content || '';
  const fileUrl = req.file ? publicUrl(req.file) : (req.body?.attachment_url || existing?.attachment_url || null);
  if (!content && !fileUrl) throw badRequest('Add a note or attach a file');
  const late = new Date().toISOString().slice(0, 10) > assignment.due_date;
  const at = nowIso();

  if (existing) {
    db.prepare('UPDATE assignment_submissions SET content = ?, attachment_url = ?, submitted_at = ?, status = ? WHERE id = ?')
      .run(content, fileUrl, at, late ? 'late' : 'submitted', existing.id);
    return res.json({ id: existing.id, late });
  }
  const id = newId('sub');
  db.prepare(
    'INSERT INTO assignment_submissions (id, school_id, assignment_id, student_id, content, attachment_url, submitted_at, status) VALUES (?,?,?,?,?,?,?,?)',
  ).run(id, req.user.school_id, assignment.id, student.id, content, fileUrl, at, late ? 'late' : 'submitted');
  if (assignment.teacher_id) {
    notifyUsers(req.user.school_id, [assignment.teacher_id], {
      title: 'New homework submission',
      body: `${student.full_name} submitted "${assignment.title}"`,
      type: 'info', link: `/app/homework/${assignment.id}`,
    });
  }
  audit(req, { action: 'submit', module: 'homework', entityType: 'submission', entityId: id, summary: `Submission for ${assignment.title}` });
  res.status(201).json({ id, late });
}));

router.post('/submissions/:id/grade', requirePermission('homework.grade'), validateBody(z.object({
  marks: z.coerce.number().min(0).max(1000).nullish(),
  feedback: z.string().max(1000).optional().default(''),
  status: z.enum(['graded', 'returned']).optional().default('graded'),
})), asyncHandler(async (req, res) => {
  const sub = db.prepare('SELECT * FROM assignment_submissions WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!sub) throw notFound('Submission not found');
  const assignment = db.prepare('SELECT * FROM assignments WHERE id = ?').get(sub.assignment_id);
  if (req.user.role === 'teacher' && assignment.teacher_id !== req.user.id) throw forbidden('You can only grade your own assignments');
  if (req.data.marks != null && assignment.max_marks && req.data.marks > assignment.max_marks) {
    throw badRequest(`Marks cannot exceed ${assignment.max_marks}`);
  }
  db.prepare('UPDATE assignment_submissions SET marks = ?, feedback = ?, status = ?, graded_by = ?, graded_at = ? WHERE id = ?')
    .run(req.data.marks ?? null, req.data.feedback, req.data.status, req.user.id, nowIso(), sub.id);

  const studentUser = db.prepare('SELECT user_id FROM students WHERE id = ?').get(sub.student_id)?.user_id;
  const parents = db.prepare('SELECT parent_user_id FROM parent_students WHERE student_id = ?').all(sub.student_id);
  notifyUsers(req.user.school_id, [studentUser, ...parents.map((p) => p.parent_user_id)], {
    title: 'Homework graded',
    body: `${assignment.title}: ${req.data.marks ?? '—'}/${assignment.max_marks ?? '—'}`,
    type: 'success', link: '/portal/homework',
  });
  audit(req, { action: 'grade', module: 'homework', entityType: 'submission', entityId: sub.id, summary: `Graded submission (${req.data.marks})` });
  res.json({ ok: true });
}));

/* ------------------------------ study materials ---------------------------- */

router.get('/materials', requirePermission('homework.view'), asyncHandler(async (req, res) => {
  const where = ['m.school_id = ?'];
  const params = [req.user.school_id];
  if (['student', 'parent'].includes(req.user.role)) {
    const ids = req.user.role === 'student'
      ? [db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.user.id)?.id].filter(Boolean)
      : db.prepare('SELECT student_id id FROM parent_students WHERE parent_user_id = ?').all(req.user.id).map((r) => r.id);
    const students = ids.length
      ? db.prepare(`SELECT class_id, section_id FROM students WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
      : [];
    if (!students.length) return res.json({ items: [] });
    where.push(`(m.class_id IS NULL OR ${students.map(() => '(m.class_id = ? AND (m.section_id IS NULL OR m.section_id = ?))').join(' OR ')})`);
    students.forEach((s) => params.push(s.class_id, s.section_id));
  } else {
    if (req.query.classId) { where.push('m.class_id = ?'); params.push(req.query.classId); }
    if (req.query.subjectId) { where.push('m.subject_id = ?'); params.push(req.query.subjectId); }
    if (req.query.mine === '1') { where.push('m.teacher_id = ?'); params.push(req.user.id); }
  }
  const items = db.prepare(
    `SELECT m.*, c.name AS class_name, sec.name AS section_name, s.name AS subject_name, u.full_name AS teacher_name
     FROM study_materials m LEFT JOIN classes c ON c.id = m.class_id LEFT JOIN sections sec ON sec.id = m.section_id
     LEFT JOIN subjects s ON s.id = m.subject_id LEFT JOIN users u ON u.id = m.teacher_id
     WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC LIMIT 200`,
  ).all(...params);
  res.json({ items });
}));

router.post('/materials', requirePermission('homework.materials'), validateBody(z.object({
  title: z.string().min(2).max(160),
  description: z.string().max(1000).optional().default(''),
  class_id: z.string().nullish(),
  section_id: z.string().nullish(),
  subject_id: z.string().nullish(),
  type: z.enum(['document', 'link', 'video', 'notes', 'worksheet']).optional().default('document'),
  file_url: z.string().max(300).nullish(),
  external_url: z.string().max(400).nullish(),
  visible_to: z.enum(['students', 'teachers', 'all']).optional().default('students'),
})), asyncHandler(async (req, res) => {
  if (!req.data.file_url && !req.data.external_url) throw badRequest('Attach a file or provide a link');
  const id = newId('mat');
  db.prepare(
    `INSERT INTO study_materials (id, school_id, class_id, section_id, subject_id, teacher_id, title, description, type,
      file_url, external_url, visible_to, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, req.user.school_id, req.data.class_id || null, req.data.section_id || null, req.data.subject_id || null,
    req.user.id, req.data.title, req.data.description, req.data.type, req.data.file_url || null,
    req.data.external_url || null, req.data.visible_to, nowIso());
  audit(req, { action: 'create', module: 'homework', entityType: 'material', entityId: id, summary: `Uploaded material "${req.data.title}"` });
  res.status(201).json({ id });
}));

router.delete('/materials/:id', requirePermission('homework.materials'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM study_materials WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Material not found');
  if (req.user.role === 'teacher' && row.teacher_id !== req.user.id) throw forbidden();
  db.prepare('DELETE FROM study_materials WHERE id = ?').run(row.id);
  audit(req, { action: 'delete', module: 'homework', entityType: 'material', entityId: row.id, summary: `Deleted material "${row.title}"` });
  res.json({ ok: true });
}));

/* ---------------------------------- portal -------------------------------- */

router.get('/my', requirePermission('homework.view'), asyncHandler(async (req, res) => {
  if (!['student', 'parent'].includes(req.user.role)) throw forbidden('Portal endpoint');
  const studentIds = req.user.role === 'student'
    ? [db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.user.id)?.id].filter(Boolean)
    : db.prepare('SELECT student_id id FROM parent_students WHERE parent_user_id = ?').all(req.user.id).map((r) => r.id);
  if (!studentIds.length) return res.json({ assignments: [], materials: [] });

  const students = db.prepare(`SELECT id, full_name, class_id, section_id FROM students WHERE id IN (${studentIds.map(() => '?').join(',')})`).all(...studentIds);
  const assignments = db.prepare(
    `SELECT a.*, c.name AS class_name, s.name AS subject_name,
       (SELECT status FROM assignment_submissions x WHERE x.assignment_id = a.id AND x.student_id = ?) my_status,
       (SELECT marks FROM assignment_submissions x WHERE x.assignment_id = a.id AND x.student_id = ?) my_marks,
       (SELECT feedback FROM assignment_submissions x WHERE x.assignment_id = a.id AND x.student_id = ?) my_feedback,
       (SELECT id FROM assignment_submissions x WHERE x.assignment_id = a.id AND x.student_id = ?) my_submission_id
     FROM assignments a LEFT JOIN classes c ON c.id = a.class_id LEFT JOIN subjects s ON s.id = a.subject_id
     WHERE a.school_id = ? AND a.status = 'published' AND a.section_id = ?
     ORDER BY a.due_date DESC LIMIT 100`,
  ).all(studentIds[0], studentIds[0], studentIds[0], studentIds[0], req.user.school_id, students[0]?.section_id || '');

  const materials = db.prepare(
    `SELECT m.*, s.name AS subject_name FROM study_materials m LEFT JOIN subjects s ON s.id = m.subject_id
     WHERE m.school_id = ? AND (m.class_id IS NULL OR m.class_id = ?) AND m.visible_to IN ('students','all')
     ORDER BY m.created_at DESC LIMIT 100`,
  ).all(req.user.school_id, students[0]?.class_id || '');

  res.json({ students, assignments, materials });
}));

export default router;
