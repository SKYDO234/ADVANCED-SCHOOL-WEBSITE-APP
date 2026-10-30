import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso, newId, getSetting, setSetting } from '../db/index.js';
import { validateBody } from '../lib/validate.js';
import { requirePermission, can } from '../lib/auth.js';
import { badRequest, conflict, forbidden, notFound, asyncHandler } from '../lib/errors.js';
import { audit, notifyUsers } from '../lib/audit.js';
import { currentSession } from '../lib/defaults.js';
import { reportCardPdf, streamPdf, createDoc, finishDoc, drawLetterhead } from '../lib/pdf.js';
import { sendTable } from '../lib/export.js';

const router = Router();

const safeJson = (v, f = []) => {
  if (v == null) return f;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return f; }
};

/* ------------------------------ grading scales ----------------------------- */

router.get('/grading-scales', requirePermission('exams.view', 'results.template'), asyncHandler(async (req, res) => {
  const items = db.prepare('SELECT * FROM grading_scales WHERE school_id = ? ORDER BY is_default DESC, name')
    .all(req.user.school_id).map((g) => ({ ...g, ranges: safeJson(g.ranges) }));
  res.json({ items });
}));

router.post('/grading-scales', requirePermission('exams.create'), validateBody(z.object({
  name: z.string().min(2).max(60),
  ranges: z.array(z.object({
    min: z.coerce.number().min(0).max(100),
    max: z.coerce.number().min(0).max(100),
    grade: z.string().min(1).max(6),
    points: z.coerce.number().min(0).max(20).optional().default(0),
    remark: z.string().max(60).optional().default(''),
  })).min(1).max(20),
  is_default: z.boolean().optional().default(false),
})), asyncHandler(async (req, res) => {
  const id = newId('grd');
  const at = nowIso();
  if (req.data.is_default) db.prepare('UPDATE grading_scales SET is_default = 0 WHERE school_id = ?').run(req.user.school_id);
  db.prepare('INSERT INTO grading_scales (id, school_id, name, is_default, ranges, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, req.user.school_id, req.data.name, req.data.is_default ? 1 : 0, JSON.stringify(req.data.ranges), at, at);
  audit(req, { action: 'create', module: 'exams', entityType: 'grading_scale', entityId: id, summary: `Created grading scale ${req.data.name}` });
  res.status(201).json({ id });
}));

router.patch('/grading-scales/:id', requirePermission('exams.edit'), validateBody(z.object({
  name: z.string().min(2).max(60).optional(),
  ranges: z.array(z.object({
    min: z.coerce.number(), max: z.coerce.number(), grade: z.string().max(6),
    points: z.coerce.number().optional().default(0), remark: z.string().max(60).optional().default(''),
  })).optional(),
  is_default: z.boolean().optional(),
})), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM grading_scales WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Grading scale not found');
  if (req.data.is_default) db.prepare('UPDATE grading_scales SET is_default = 0 WHERE school_id = ?').run(req.user.school_id);
  db.prepare('UPDATE grading_scales SET name = ?, ranges = ?, is_default = ?, updated_at = ? WHERE id = ?')
    .run(req.data.name ?? row.name, req.data.ranges ? JSON.stringify(req.data.ranges) : row.ranges,
      req.data.is_default === undefined ? row.is_default : (req.data.is_default ? 1 : 0), nowIso(), row.id);
  audit(req, { action: 'update', module: 'exams', entityType: 'grading_scale', entityId: row.id, summary: `Updated grading scale ${req.data.name || row.name}` });
  res.json({ ok: true });
}));

router.delete('/grading-scales/:id', requirePermission('exams.delete'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM grading_scales WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Grading scale not found');
  const used = db.prepare('SELECT COUNT(*) c FROM exams WHERE grading_scale_id = ?').get(row.id).c;
  if (used) throw conflict('This scale is used by an examination');
  db.prepare('DELETE FROM grading_scales WHERE id = ?').run(row.id);
  res.json({ ok: true });
}));

/* ---------------------------------- exams --------------------------------- */

function examSummary(schoolId, exam) {
  const classes = db.prepare(
    `SELECT ec.*, c.name AS class_name, sec.name AS section_name,
       (SELECT COUNT(*) FROM exam_subjects es WHERE es.exam_class_id = ec.id) subjects,
       (SELECT COUNT(*) FROM students s WHERE s.class_id = ec.class_id
          AND (ec.section_id IS NULL OR s.section_id = ec.section_id) AND s.status = 'active') students
     FROM exam_classes ec
     LEFT JOIN classes c ON c.id = ec.class_id LEFT JOIN sections sec ON sec.id = ec.section_id
     WHERE ec.exam_id = ? ORDER BY c.order_index, sec.name`,
  ).all(exam.id);

  const progress = db.prepare(
    `SELECT es.id, es.class_id, es.section_id, es.subject_id, es.teacher_id, es.max_marks,
       s.name AS subject_name, u.full_name AS teacher_name, sec.name AS section_name, c.name AS class_name,
       (SELECT COUNT(*) FROM exam_marks em WHERE em.exam_subject_id = es.id) entered,
       (SELECT COUNT(*) FROM students st WHERE st.class_id = es.class_id
          AND (es.section_id IS NULL OR st.section_id = es.section_id) AND st.status = 'active') required
     FROM exam_subjects es
     LEFT JOIN subjects s ON s.id = es.subject_id
     LEFT JOIN users u ON u.id = es.teacher_id
     LEFT JOIN classes c ON c.id = es.class_id
     LEFT JOIN sections sec ON sec.id = es.section_id
     WHERE es.exam_id = ? ORDER BY c.order_index, sec.name, es.sort_order`,
  ).all(exam.id);

  const totalRequired = progress.reduce((s, p) => s + p.required, 0);
  const totalEntered = progress.reduce((s, p) => s + Math.min(p.entered, p.required), 0);
  return {
    ...exam,
    classes,
    subjects: progress,
    progress: {
      totalRequired,
      totalEntered,
      percentage: totalRequired ? Math.round((totalEntered / totalRequired) * 100) : 0,
      pendingSubjects: progress.filter((p) => p.entered < p.required).length,
      subjects: progress.length,
      students: new Set(classes.map((c) => `${c.class_id}:${c.section_id}`)).size,
    },
  };
}

router.get('/', requirePermission('exams.view', 'results.view', 'fees.view', 'dashboard.view'), asyncHandler(async (req, res) => {
  const where = ['e.school_id = ?'];
  const params = [req.user.school_id];
  if (req.query.sessionId) { where.push('e.session_id = ?'); params.push(req.query.sessionId); }
  if (req.query.status && req.query.status !== 'all') { where.push('e.status = ?'); params.push(req.query.status); }
  if (req.query.q) { where.push('e.name LIKE ?'); params.push(`%${req.query.q}%`); }

  const exams = db.prepare(
    `SELECT e.*, ses.name AS session_name, g.name AS grading_scale_name,
       (SELECT COUNT(*) FROM exam_results r WHERE r.exam_id = e.id) result_count,
       (SELECT COUNT(*) FROM exam_results r WHERE r.exam_id = e.id AND r.is_published = 1) published_count
     FROM exams e LEFT JOIN academic_sessions ses ON ses.id = e.session_id
     LEFT JOIN grading_scales g ON g.id = e.grading_scale_id
     WHERE ${where.join(' AND ')} ORDER BY COALESCE(e.start_date, e.created_at) DESC`,
  ).all(...params);

  const progress = db.prepare(
    `SELECT es.exam_id,
       SUM((SELECT COUNT(*) FROM students st WHERE st.class_id = es.class_id
            AND (es.section_id IS NULL OR st.section_id = es.section_id) AND st.status='active')) required,
       SUM((SELECT COUNT(*) FROM exam_marks em WHERE em.exam_subject_id = es.id)) entered
     FROM exam_subjects es WHERE es.school_id = ? GROUP BY es.exam_id`,
  ).all(req.user.school_id);

  res.json({
    items: exams.map((e) => {
      const p = progress.find((x) => x.exam_id === e.id);
      return {
        ...e,
        marksProgress: p && p.required ? Math.min(100, Math.round((p.entered / p.required) * 100)) : 0,
      };
    }),
  });
}));

router.get('/:id', requirePermission('exams.view', 'results.view'), asyncHandler(async (req, res) => {
  const exam = db.prepare(
    `SELECT e.*, ses.name AS session_name, g.name AS grading_scale_name, g.ranges AS grading_ranges
     FROM exams e LEFT JOIN academic_sessions ses ON ses.id = e.session_id
     LEFT JOIN grading_scales g ON g.id = e.grading_scale_id
     WHERE e.id = ? AND e.school_id = ?`,
  ).get(req.params.id, req.user.school_id);
  if (!exam) throw notFound('Examination not found');
  const data = examSummary(req.user.school_id, exam);
  data.grading_ranges = safeJson(exam.grading_ranges, []);
  if (req.user.role === 'teacher') {
    data.subjects = data.subjects.filter((s) => s.teacher_id === req.user.id);
  }
  res.json(data);
}));

const createExamSchema = z.object({
  name: z.string().min(3).max(90),
  sessionId: z.string().optional(),
  type: z.enum(['unit_test', 'term', 'half_yearly', 'annual', 'practical', 'project', 'custom']).default('term'),
  start_date: z.string().max(20).optional().default(''),
  end_date: z.string().max(20).optional().default(''),
  grading_scale_id: z.string().nullish(),
  pass_percentage: z.coerce.number().min(0).max(100).optional().default(33),
  tie_break: z.enum(['total_desc', 'subject_priority', 'name_asc', 'dob_oldest']).optional().default('total_desc'),
  weightage: z.coerce.number().min(1).max(100).optional().default(100),
  show_rank: z.boolean().optional().default(true),
  instructions: z.string().max(1000).optional().default(''),
  classes: z.array(z.object({
    class_id: z.string().min(1),
    section_id: z.string().nullish(),
    subject_ids: z.array(z.string()).min(1),
    max_marks: z.coerce.number().min(1).max(1000).optional().default(100),
    pass_marks: z.coerce.number().min(0).max(1000).optional().default(33),
    theory_max: z.coerce.number().min(0).nullish(),
    practical_max: z.coerce.number().min(0).nullish(),
    exam_date: z.string().max(20).nullish(),
  })).min(1).max(60),
});

router.post('/', requirePermission('exams.create'), validateBody(createExamSchema), asyncHandler(async (req, res) => {
  const d = req.data;
  const schoolId = req.user.school_id;
  const sessionId = d.sessionId || currentSession(schoolId)?.id;
  if (!sessionId) throw badRequest('Create an academic session first');

  const scale = d.grading_scale_id
    ? db.prepare('SELECT * FROM grading_scales WHERE id = ? AND school_id = ?').get(d.grading_scale_id, schoolId)
    : db.prepare('SELECT * FROM grading_scales WHERE school_id = ? ORDER BY is_default DESC LIMIT 1').get(schoolId);
  if (!scale) throw badRequest('No grading scale configured');

  const id = newId('exm');
  const at = nowIso();
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO exams (id, school_id, session_id, name, type, start_date, end_date, status, grading_scale_id,
        pass_percentage, tie_break, weightage, show_rank, instructions, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, schoolId, sessionId, d.name, d.type, d.start_date || null, d.end_date || null, 'draft', scale.id,
      d.pass_percentage, d.tie_break, d.weightage, d.show_rank ? 1 : 0, d.instructions || null, req.user.id, at, at);

    d.classes.forEach((entry) => {
      const examClassId = newId('exc');
      db.prepare('INSERT INTO exam_classes (id, school_id, exam_id, class_id, section_id, status) VALUES (?,?,?,?,?,?)')
        .run(examClassId, schoolId, id, entry.class_id, entry.section_id || null, 'pending');
      entry.subject_ids.forEach((subjectId, idx) => {
        const assignment = db.prepare(
          `SELECT teacher_id FROM class_subjects WHERE school_id = ? AND session_id = ? AND class_id = ?
           AND (section_id = ? OR section_id IS NULL) AND subject_id = ? LIMIT 1`,
        ).get(schoolId, sessionId, entry.class_id, entry.section_id || null, subjectId);
        db.prepare(
          `INSERT INTO exam_subjects (id, school_id, exam_id, exam_class_id, class_id, section_id, subject_id, teacher_id,
            max_marks, pass_marks, theory_max, practical_max, weightage, exam_date, sort_order)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(newId('exs'), schoolId, id, examClassId, entry.class_id, entry.section_id || null, subjectId,
          assignment?.teacher_id || null, entry.max_marks, entry.pass_marks, entry.theory_max ?? null,
          entry.practical_max ?? null, d.weightage, entry.exam_date || null, idx);
      });
    });
  });
  run();

  audit(req, {
    action: 'create', module: 'exams', entityType: 'exam', entityId: id,
    summary: `Created examination ${d.name}`, meta: { classes: d.classes.length },
  });
  res.status(201).json({ id });
}));

router.patch('/:id', requirePermission('exams.edit'), validateBody(z.object({
  name: z.string().min(3).max(90).optional(),
  start_date: z.string().max(20).optional(),
  end_date: z.string().max(20).optional(),
  pass_percentage: z.coerce.number().min(0).max(100).optional(),
  tie_break: z.enum(['total_desc', 'subject_priority', 'name_asc', 'dob_oldest']).optional(),
  weightage: z.coerce.number().min(1).max(100).optional(),
  show_rank: z.boolean().optional(),
  grading_scale_id: z.string().optional(),
  instructions: z.string().max(1000).optional(),
  status: z.enum(['draft', 'marks_entry', 'marks_complete']).optional(),
})), asyncHandler(async (req, res) => {
  const exam = db.prepare('SELECT * FROM exams WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!exam) throw notFound('Examination not found');
  if (['finalized', 'published'].includes(exam.status) && (req.data.grading_scale_id || req.data.pass_percentage !== undefined)) {
    throw conflict('This examination is finalized. Re-open it or use result correction to change grading rules.');
  }
  const d = req.data;
  db.prepare(
    `UPDATE exams SET name = ?, start_date = ?, end_date = ?, pass_percentage = ?, tie_break = ?, weightage = ?,
      show_rank = ?, grading_scale_id = ?, instructions = ?, status = ?, updated_at = ? WHERE id = ?`,
  ).run(
    d.name ?? exam.name, d.start_date ?? exam.start_date, d.end_date ?? exam.end_date,
    d.pass_percentage ?? exam.pass_percentage, d.tie_break ?? exam.tie_break, d.weightage ?? exam.weightage,
    d.show_rank === undefined ? exam.show_rank : (d.show_rank ? 1 : 0), d.grading_scale_id ?? exam.grading_scale_id,
    d.instructions ?? exam.instructions, d.status ?? exam.status, nowIso(), exam.id,
  );

  if (d.status === 'marks_entry' && exam.status === 'draft') {
    db.prepare("UPDATE exam_classes SET status = 'marks_entry' WHERE exam_id = ?").run(exam.id);
    // Notify subject teachers that marks entry is open.
    const teachers = db.prepare('SELECT DISTINCT teacher_id FROM exam_subjects WHERE exam_id = ? AND teacher_id IS NOT NULL').all(exam.id);
    notifyUsers(req.user.school_id, teachers.map((t) => t.teacher_id), {
      title: 'Marks entry open',
      body: `Marks entry is now open for ${exam.name}.`,
      type: 'info', link: `/app/exams/${exam.id}/marks`,
    });
  }
  audit(req, { action: 'update', module: 'exams', entityType: 'exam', entityId: exam.id, summary: `Updated examination ${d.name || exam.name}`, meta: d });
  res.json({ ok: true });
}));

router.delete('/:id', requirePermission('exams.delete'), asyncHandler(async (req, res) => {
  const exam = db.prepare('SELECT * FROM exams WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!exam) throw notFound('Examination not found');
  if (['finalized', 'published'].includes(exam.status)) throw conflict('Finalized results are locked. Archive the examination instead.');
  const run = db.transaction(() => {
    db.prepare('DELETE FROM exam_marks WHERE exam_subject_id IN (SELECT id FROM exam_subjects WHERE exam_id = ?)').run(exam.id);
    db.prepare('DELETE FROM exam_subjects WHERE exam_id = ?').run(exam.id);
    db.prepare('DELETE FROM exam_classes WHERE exam_id = ?').run(exam.id);
    db.prepare('DELETE FROM exam_results WHERE exam_id = ?').run(exam.id);
    db.prepare('DELETE FROM exams WHERE id = ?').run(exam.id);
  });
  run();
  audit(req, { action: 'delete', module: 'exams', entityType: 'exam', entityId: exam.id, summary: `Deleted examination ${exam.name}` });
  res.json({ ok: true });
}));

/* ------------------------------- marks entry ------------------------------- */

router.get('/:id/marks', requirePermission('exams.marks_view', 'exams.marks_entry', 'results.view'), asyncHandler(async (req, res) => {
  const exam = db.prepare('SELECT * FROM exams WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!exam) throw notFound('Examination not found');
  const examClassId = req.query.examClassId;
  const subjectId = req.query.subjectId;
  if (!examClassId || !subjectId) throw badRequest('examClassId and subjectId are required');

  const subject = db.prepare(
    `SELECT es.*, s.name AS subject_name, sec.name AS section_name, c.name AS class_name, u.full_name AS teacher_name
     FROM exam_subjects es LEFT JOIN subjects s ON s.id = es.subject_id
     LEFT JOIN classes c ON c.id = es.class_id LEFT JOIN sections sec ON sec.id = es.section_id
     LEFT JOIN users u ON u.id = es.teacher_id
     WHERE es.id = ? AND es.exam_id = ?`,
  ).get(subjectId, exam.id);
  if (!subject) throw notFound('Subject not found for this examination');

  const locked = ['finalized', 'published'].includes(exam.status);
  const canEnter = !locked && (
    req.user.role === 'principal'
    || can(req.user, 'exams.marks_correct')
    || (can(req.user, 'exams.marks_entry') && (subject.teacher_id === req.user.id || !subject.teacher_id))
  );

  const students = db.prepare(
    `SELECT s.id, s.full_name, s.roll_no, s.admission_no, s.photo_url,
       em.id AS mark_id, em.theory_marks, em.practical_marks, em.marks_obtained, em.is_absent, em.is_exempt,
       em.updated_at, em.entered_by
     FROM students s
     LEFT JOIN exam_marks em ON em.student_id = s.id AND em.exam_subject_id = ?
     WHERE s.school_id = ? AND s.class_id = ? AND (? IS NULL OR s.section_id = ?) AND s.status = 'active'
     ORDER BY CAST(s.roll_no AS INTEGER), s.full_name`,
  ).all(subject.id, req.user.school_id, subject.class_id, subject.section_id, subject.section_id);

  const subjects = db.prepare(
    `SELECT es.id, es.subject_id, s.name AS subject_name, es.max_marks, es.teacher_id, u.full_name AS teacher_name,
       (SELECT COUNT(*) FROM exam_marks em WHERE em.exam_subject_id = es.id) entered
     FROM exam_subjects es LEFT JOIN subjects s ON s.id = es.subject_id LEFT JOIN users u ON u.id = es.teacher_id
     WHERE es.exam_id = ? AND es.exam_class_id = ? ORDER BY es.sort_order`,
  ).all(exam.id, examClassId);

  res.json({
    exam: { ...exam, locked },
    subject,
    subjects,
    students,
    canEnter,
    canCorrect: can(req.user, 'exams.marks_correct') || req.user.role === 'principal',
    completed: students.filter((s) => s.mark_id).length,
  });
}));

router.post('/:id/marks', requirePermission('exams.marks_entry'), validateBody(z.object({
  examSubjectId: z.string().min(1),
  records: z.array(z.object({
    student_id: z.string().min(1),
    theory_marks: z.coerce.number().min(0).nullish(),
    practical_marks: z.coerce.number().min(0).nullish(),
    marks_obtained: z.coerce.number().min(0).nullish(),
    is_absent: z.boolean().optional().default(false),
    is_exempt: z.boolean().optional().default(false),
  })).min(1).max(500),
})), asyncHandler(async (req, res) => {
  const exam = db.prepare('SELECT * FROM exams WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!exam) throw notFound('Examination not found');
  if (['finalized', 'published'].includes(exam.status) && !can(req.user, 'results.correct')) {
    throw conflict('Results are finalized and locked. Correction requires result-correction permission.');
  }
  const subject = db.prepare('SELECT * FROM exam_subjects WHERE id = ? AND exam_id = ?').get(req.data.examSubjectId, exam.id);
  if (!subject) throw notFound('Subject not found');

  const isOwner = subject.teacher_id === req.user.id;
  if (req.user.role !== 'principal' && !isOwner && !can(req.user, 'exams.marks_correct')) {
    throw forbidden('You can only enter marks for subjects assigned to you');
  }

  const errors = [];
  const at = nowIso();
  let saved = 0;
  let changedAfterFinal = 0;

  const run = db.transaction(() => {
    for (const rec of req.data.records) {
      const theoryMax = subject.theory_max ?? null;
      const practicalMax = subject.practical_max ?? null;
      let obtained = rec.marks_obtained;

      if (rec.is_exempt) {
        obtained = null;
      } else if (rec.is_absent) {
        obtained = 0;
      } else {
        if (rec.theory_marks != null && theoryMax != null && rec.theory_marks > theoryMax) {
          errors.push({ student_id: rec.student_id, message: `Theory marks exceed maximum (${theoryMax})` });
          continue;
        }
        if (rec.practical_marks != null && practicalMax != null && rec.practical_marks > practicalMax) {
          errors.push({ student_id: rec.student_id, message: `Practical marks exceed maximum (${practicalMax})` });
          continue;
        }
        if (rec.theory_marks != null && rec.practical_marks != null) {
          obtained = Number(rec.theory_marks) + Number(rec.practical_marks);
        }
        if (obtained == null) {
          errors.push({ student_id: rec.student_id, message: 'Enter marks, or mark the student absent/exempt' });
          continue;
        }
        if (obtained > Number(subject.max_marks)) {
          errors.push({ student_id: rec.student_id, message: `Marks exceed maximum (${subject.max_marks})` });
          continue;
        }
      }

      const existing = db.prepare('SELECT * FROM exam_marks WHERE exam_subject_id = ? AND student_id = ?')
        .get(subject.id, rec.student_id);
      if (existing) {
        if (['finalized', 'published'].includes(exam.status) && Number(existing.marks_obtained) !== Number(obtained)) changedAfterFinal += 1;
        db.prepare(
          `UPDATE exam_marks SET theory_marks = ?, practical_marks = ?, marks_obtained = ?, is_absent = ?, is_exempt = ?,
            entered_by = ?, updated_at = ? WHERE id = ?`,
        ).run(rec.theory_marks ?? null, rec.practical_marks ?? null, obtained, rec.is_absent ? 1 : 0,
          rec.is_exempt ? 1 : 0, req.user.id, at, existing.id);
      } else {
        db.prepare(
          `INSERT INTO exam_marks (id, school_id, exam_subject_id, student_id, theory_marks, practical_marks, marks_obtained,
            is_absent, is_exempt, entered_by, entered_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(newId('emk'), req.user.school_id, subject.id, rec.student_id, rec.theory_marks ?? null,
          rec.practical_marks ?? null, obtained, rec.is_absent ? 1 : 0, rec.is_exempt ? 1 : 0, req.user.id, at, at);
      }
      saved += 1;
    }

    const entered = db.prepare('SELECT COUNT(*) c FROM exam_marks WHERE exam_subject_id = ?').get(subject.id).c;
    const required = db.prepare(
      `SELECT COUNT(*) c FROM students WHERE school_id = ? AND class_id = ? AND (? IS NULL OR section_id = ?) AND status = 'active'`,
    ).get(req.user.school_id, subject.class_id, subject.section_id, subject.section_id).c;
    if (entered >= required && exam.status === 'marks_entry') {
      const pending = db.prepare(
        `SELECT COUNT(*) c FROM exam_subjects es WHERE es.exam_id = ? AND
          (SELECT COUNT(*) FROM exam_marks em WHERE em.exam_subject_id = es.id) <
          (SELECT COUNT(*) FROM students st WHERE st.class_id = es.class_id
             AND (es.section_id IS NULL OR st.section_id = es.section_id) AND st.status = 'active')`,
      ).get(exam.id).c;
      if (pending === 0) db.prepare("UPDATE exams SET status = 'marks_complete', updated_at = ? WHERE id = ?").run(at, exam.id);
    }
  });
  run();

  if (errors.length && saved === 0) throw badRequest('No marks were saved', errors);
  if (changedAfterFinal > 0) {
    audit(req, {
      action: 'marks_corrected', module: 'exams', entityType: 'exam', entityId: exam.id,
      summary: `Corrected ${changedAfterFinal} mark(s) on a finalized examination`,
      meta: { examSubjectId: subject.id },
    });
  } else {
    audit(req, { action: 'marks_entry', module: 'exams', entityType: 'exam_subject', entityId: subject.id, summary: `Saved ${saved} marks` });
  }
  res.json({ saved, errors, status: db.prepare('SELECT status FROM exams WHERE id = ?').get(exam.id).status });
}));

/* ---------------------------- result computation --------------------------- */

function gradeFor(percentage, ranges) {
  const sorted = [...ranges].sort((a, b) => b.min - a.min);
  const hit = sorted.find((r) => percentage >= r.min && percentage <= (r.max ?? 100));
  return hit || sorted[sorted.length - 1] || { grade: null, points: 0, remark: '' };
}

export function computeExamResults(examId, { schoolId, reason = null, userId = null }) {
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId);
  if (!exam) throw new Error('Exam not found');
  const scale = db.prepare('SELECT * FROM grading_scales WHERE id = ?').get(exam.grading_scale_id)
    || db.prepare('SELECT * FROM grading_scales WHERE school_id = ? ORDER BY is_default DESC LIMIT 1').get(exam.school_id);
  const ranges = safeJson(scale?.ranges, []);
  const rankScope = getSetting(exam.school_id, 'exams', 'rankScope', 'section');
  const at = nowIso();

  const examClasses = db.prepare('SELECT * FROM exam_classes WHERE exam_id = ?').all(examId);
  const computed = [];

  for (const examClass of examClasses) {
    const subjects = db.prepare('SELECT * FROM exam_subjects WHERE exam_id = ? AND exam_class_id = ? ORDER BY sort_order').all(examId, examClass.id);
    const students = db.prepare(
      `SELECT * FROM students WHERE school_id = ? AND class_id = ? AND (? IS NULL OR section_id = ?) AND status = 'active'
       ORDER BY full_name`,
    ).all(exam.school_id, examClass.class_id, examClass.section_id, examClass.section_id);

    const rows = students.map((student) => {
      const subjectData = [];
      let obtained = 0;
      let maxTotal = 0;
      let failed = 0;
      let gpaSum = 0;
      let gpaCount = 0;

      for (const subject of subjects) {
        const mark = db.prepare('SELECT * FROM exam_marks WHERE exam_subject_id = ? AND student_id = ?').get(subject.id, student.id);
        const subjectMeta = db.prepare('SELECT name FROM subjects WHERE id = ?').get(subject.subject_id);
        const isAbsent = Boolean(mark?.is_absent);
        const isExempt = Boolean(mark?.is_exempt);
        const marksObtained = mark ? Number(mark.marks_obtained || 0) : 0;
        const pct = subject.max_marks ? (marksObtained / subject.max_marks) * 100 : 0;
        const grade = gradeFor(pct, ranges);
        const passed = isExempt ? true : marksObtained >= Number(subject.pass_marks);

        if (!isExempt) {
          obtained += marksObtained;
          maxTotal += Number(subject.max_marks);
          gpaSum += Number(grade.points || 0);
          gpaCount += 1;
        }
        if (!isExempt && !passed) failed += 1;

        subjectData.push({
          exam_subject_id: subject.id,
          subject_id: subject.subject_id,
          subject_name: subjectMeta?.name || 'Subject',
          max_marks: subject.max_marks,
          pass_marks: subject.pass_marks,
          theory_marks: mark?.theory_marks ?? null,
          practical_marks: mark?.practical_marks ?? null,
          obtained: marksObtained,
          is_absent: isAbsent,
          is_exempt: isExempt,
          grade: isExempt ? 'EX' : isAbsent ? 'AB' : grade.grade,
          grade_points: grade.points || 0,
          passed,
        });
      }

      const percentage = maxTotal ? (obtained / maxTotal) * 100 : 0;
      const overallGrade = gradeFor(percentage, ranges);
      const resultStatus = failed > 0 ? 'fail' : percentage < Number(exam.pass_percentage) ? 'fail' : 'pass';
      const attendance = db.prepare(
        "SELECT COUNT(*) total, SUM(CASE WHEN status IN ('present','late') THEN 1 ELSE 0 END) present FROM attendance WHERE entity_id = ? AND entity_type = 'student'",
      ).get(student.id);

      return {
        student_id: student.id,
        student_name: student.full_name,
        roll_no: student.roll_no,
        class_id: examClass.class_id,
        section_id: examClass.section_id,
        total_obtained: Math.round(obtained * 100) / 100,
        total_max: maxTotal,
        percentage: Math.round(percentage * 100) / 100,
        grade: overallGrade.grade,
        gpa: gpaCount ? Math.round((gpaSum / gpaCount) * 100) / 100 : 0,
        result_status: resultStatus,
        failed_subjects: failed,
        subjects_data: subjectData,
        attendance_present: attendance.present || 0,
        attendance_total: attendance.total || 0,
      };
    });

    // Ranking: competition ranking (1,1,3) inside the configured scope.
    const groups = new Map();
    for (const row of rows) {
      const key = rankScope === 'class' ? row.class_id : `${row.class_id}:${row.section_id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    for (const [, group] of groups) {
      const sorted = [...group].sort((a, b) => {
        if (b.total_obtained !== a.total_obtained) return b.total_obtained - a.total_obtained;
        if (exam.tie_break === 'subject_priority') {
          for (let i = 0; i < Math.max(a.subjects_data.length, b.subjects_data.length); i += 1) {
            const av = a.subjects_data[i]?.obtained || 0;
            const bv = b.subjects_data[i]?.obtained || 0;
            if (bv !== av) return bv - av;
          }
        }
        if (exam.tie_break === 'name_asc') return String(a.student_name).localeCompare(String(b.student_name));
        if (exam.tie_break === 'dob_oldest') {
          const aDob = db.prepare('SELECT dob FROM students WHERE id = ?').get(a.student_id)?.dob || '9999';
          const bDob = db.prepare('SELECT dob FROM students WHERE id = ?').get(b.student_id)?.dob || '9999';
          return String(aDob).localeCompare(String(bDob));
        }
        return String(a.student_name).localeCompare(String(b.student_name));
      });
      let previousTotal = null;
      let previousRank = 0;
      sorted.forEach((row, idx) => {
        if (previousTotal !== null && row.total_obtained === previousTotal) {
          row.rank = previousRank;
        } else {
          row.rank = idx + 1;
          previousRank = row.rank;
        }
        previousTotal = row.total_obtained;
        // section rank is always relative to the section
        row.section_rank = row.rank;
      });
    }

    for (const row of rows) {
      const existing = db.prepare('SELECT * FROM exam_results WHERE exam_id = ? AND student_id = ?').get(examId, row.student_id);
      const payload = [
        row.class_id, row.section_id, exam.session_id, row.total_obtained, row.total_max,
        row.percentage, row.grade, row.gpa, row.rank, row.section_rank, row.result_status, row.failed_subjects,
        JSON.stringify(row.subjects_data), row.attendance_present, row.attendance_total, at,
      ];
      if (existing) {
        if (reason && userId) {
          db.prepare(
            'INSERT INTO result_revisions (id, school_id, result_id, exam_id, changed_by, reason, before_json, after_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
          ).run(newId('rev'), exam.school_id, existing.id, examId, userId, reason,
            JSON.stringify({
              total_obtained: existing.total_obtained, percentage: existing.percentage, grade: existing.grade,
              rank: existing.rank, result_status: existing.result_status, subjects_data: safeJson(existing.subjects_data),
            }),
            JSON.stringify(row), at);
        }
        db.prepare(
          `UPDATE exam_results SET class_id = ?, section_id = ?, session_id = ?, total_obtained = ?, total_max = ?,
            percentage = ?, grade = ?, gpa = ?, rank = ?, section_rank = ?, result_status = ?, failed_subjects = ?,
            subjects_data = ?, attendance_present = ?, attendance_total = ?, computed_at = ? WHERE id = ?`,
        ).run(...payload, existing.id);
      } else {
        db.prepare(
          `INSERT INTO exam_results (id, school_id, exam_id, student_id, class_id, section_id, session_id, total_obtained,
            total_max, percentage, grade, gpa, rank, section_rank, result_status, failed_subjects, subjects_data,
            attendance_present, attendance_total, computed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(newId('res'), exam.school_id, examId, row.student_id, ...payload);
      }
      computed.push(row);
    }
  }

  db.prepare("UPDATE exam_classes SET status = CASE WHEN status = 'pending' THEN 'marks_entry' ELSE status END WHERE exam_id = ?").run(examId);
  return computed;
}

function missingMarks(examId) {
  return db.prepare(
    `SELECT es.id, s.name AS subject_name, c.name AS class_name, sec.name AS section_name,
       (SELECT COUNT(*) FROM exam_marks em WHERE em.exam_subject_id = es.id) entered,
       (SELECT COUNT(*) FROM students st WHERE st.class_id = es.class_id
          AND (es.section_id IS NULL OR st.section_id = es.section_id) AND st.status = 'active') required
     FROM exam_subjects es
     LEFT JOIN subjects s ON s.id = es.subject_id
     LEFT JOIN classes c ON c.id = es.class_id
     LEFT JOIN sections sec ON sec.id = es.section_id
     WHERE es.exam_id = ?`,
  ).all(examId).filter((r) => r.entered < r.required);
}

router.post('/:id/finalize', requirePermission('results.finalize'), validateBody(z.object({
  force: z.boolean().optional().default(false),
})), asyncHandler(async (req, res) => {
  const exam = db.prepare('SELECT * FROM exams WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!exam) throw notFound('Examination not found');
  if (exam.status === 'published') throw conflict('Results are already published. Unpublish first to recalculate.');
  if (exam.status === 'finalized' && !req.data.force) throw conflict('Results are already finalized');

  const missing = missingMarks(exam.id);
  if (missing.length && !req.data.force) {
    return res.status(409).json({
      error: 'Marks entry is incomplete',
      code: 'marks_incomplete',
      details: missing.map((m) => ({
        subject: m.subject_name,
        class: `${m.class_name || ''} ${m.section_name || ''}`.trim(),
        entered: m.entered,
        required: m.required,
      })),
    });
  }

  const computed = computeExamResults(exam.id, { schoolId: req.user.school_id, userId: req.user.id });
  db.prepare("UPDATE exams SET status = 'finalized', finalized_at = ?, finalized_by = ?, updated_at = ? WHERE id = ?")
    .run(nowIso(), req.user.id, nowIso(), exam.id);
  db.prepare("UPDATE exam_classes SET status = 'finalized' WHERE exam_id = ?").run(exam.id);

  audit(req, {
    action: 'finalize', module: 'results', entityType: 'exam', entityId: exam.id,
    summary: `Finalized results for ${exam.name} (${computed.length} students)`,
    meta: { forced: Boolean(req.data.force), missingSubjects: missing.length },
  });
  res.json({
    ok: true,
    students: computed.length,
    passed: computed.filter((r) => r.result_status === 'pass').length,
    failed: computed.filter((r) => r.result_status !== 'pass').length,
    topRank: computed.filter((r) => r.rank === 1).length,
  });
}));

router.post('/:id/publish', requirePermission('results.publish'), validateBody(z.object({
  notify: z.boolean().optional().default(true),
})), asyncHandler(async (req, res) => {
  const exam = db.prepare('SELECT * FROM exams WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!exam) throw notFound('Examination not found');
  if (exam.status !== 'finalized') throw badRequest('Finalize the results before publishing');

  const results = db.prepare('SELECT * FROM exam_results WHERE exam_id = ?').all(exam.id);
  if (!results.length) throw badRequest('No computed results to publish');

  const at = nowIso();
  db.prepare('UPDATE exam_results SET is_published = 1 WHERE exam_id = ?').run(exam.id);
  db.prepare("UPDATE exams SET status = 'published', result_published_at = ?, updated_at = ? WHERE id = ?").run(at, at, exam.id);
  db.prepare("UPDATE exam_classes SET status = 'published' WHERE exam_id = ?").run(exam.id);

  if (req.data.notify) {
    const recipients = [];
    for (const r of results) {
      const parents = db.prepare('SELECT parent_user_id FROM parent_students WHERE student_id = ?').all(r.student_id);
      recipients.push(...parents.map((p) => p.parent_user_id));
      const studentUser = db.prepare('SELECT user_id FROM students WHERE id = ?').get(r.student_id)?.user_id;
      if (studentUser) recipients.push(studentUser);
    }
    const unique = [...new Set(recipients)];
    for (let i = 0; i < unique.length; i += 200) {
      notifyUsers(req.user.school_id, unique.slice(i, i + 200), {
        title: 'Results published',
        body: `${exam.name} results are now available in your portal.`,
        type: 'success',
        link: '/portal/results',
      });
    }
  }

  audit(req, { action: 'publish', module: 'results', entityType: 'exam', entityId: exam.id, summary: `Published results for ${exam.name}`, meta: { students: results.length } });
  res.json({ ok: true, students: results.length });
}));

router.post('/:id/unpublish', requirePermission('results.publish'), validateBody(z.object({
  reason: z.string().min(3).max(300),
})), asyncHandler(async (req, res) => {
  const exam = db.prepare('SELECT * FROM exams WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!exam) throw notFound('Examination not found');
  if (exam.status !== 'published') throw badRequest('Results are not currently published');
  db.prepare('UPDATE exam_results SET is_published = 0 WHERE exam_id = ?').run(exam.id);
  db.prepare("UPDATE exams SET status = 'finalized', result_published_at = NULL, updated_at = ? WHERE id = ?").run(nowIso(), exam.id);
  db.prepare("UPDATE exam_classes SET status = 'finalized' WHERE exam_id = ?").run(exam.id);
  audit(req, {
    action: 'unpublish', module: 'results', entityType: 'exam', entityId: exam.id,
    summary: `Unpublished results for ${exam.name}`, meta: { reason: req.data.reason },
  });
  res.json({ ok: true });
}));

router.post('/:id/recalculate', requirePermission('results.recalculate', 'results.finalize'), validateBody(z.object({
  reason: z.string().min(3).max(300).optional().default('Rank recalculation'),
})), asyncHandler(async (req, res) => {
  const exam = db.prepare('SELECT * FROM exams WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!exam) throw notFound('Examination not found');
  if (!['finalized', 'published'].includes(exam.status)) throw badRequest('Only finalized examinations can be recalculated');
  const rows = computeExamResults(exam.id, { schoolId: req.user.school_id, userId: req.user.id, reason: req.data.reason });
  audit(req, {
    action: 'recalculate', module: 'results', entityType: 'exam', entityId: exam.id,
    summary: `Recalculated results and ranks for ${exam.name}`, meta: { reason: req.data.reason, students: rows.length },
  });
  res.json({ ok: true, students: rows.length });
}));

/* --------------------------------- results -------------------------------- */

/* --------------------------------- portal --------------------------------- */

router.get('/my/results', asyncHandler(async (req, res) => {
  if (!['student', 'parent'].includes(req.user.role)) throw forbidden('Portal endpoint');
  const studentIds = req.user.role === 'student'
    ? [db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.user.id)?.id].filter(Boolean)
    : db.prepare('SELECT student_id AS id FROM parent_students WHERE parent_user_id = ?').all(req.user.id).map((r) => r.id);
  if (!studentIds.length) return res.json({ items: [] });

  const rows = db.prepare(
    `SELECT r.*, e.name AS exam_name, e.result_published_at, ses.name AS session_name, s.full_name
     FROM exam_results r JOIN exams e ON e.id = r.exam_id JOIN students s ON s.id = r.student_id
     LEFT JOIN academic_sessions ses ON ses.id = r.session_id
     WHERE r.student_id IN (${studentIds.map(() => '?').join(',')}) AND r.is_published = 1
     ORDER BY e.start_date DESC`,
  ).all(...studentIds);
  res.json({ items: rows.map((r) => ({ ...r, subjects_data: safeJson(r.subjects_data) })) });
}));

router.get('/:id/results', requirePermission('results.view', 'results.export'), asyncHandler(async (req, res) => {
  const exam = db.prepare('SELECT * FROM exams WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!exam) throw notFound('Examination not found');
  const where = ['r.exam_id = ?'];
  const params = [exam.id];
  if (req.query.classId && req.query.classId !== 'all') { where.push('r.class_id = ?'); params.push(req.query.classId); }
  if (req.query.sectionId && req.query.sectionId !== 'all') { where.push('r.section_id = ?'); params.push(req.query.sectionId); }
  if (req.query.result && req.query.result !== 'all') { where.push('r.result_status = ?'); params.push(req.query.result); }
  if (req.query.q) { where.push('s.full_name LIKE ?'); params.push(`%${req.query.q}%`); }

  const rows = db.prepare(
    `SELECT r.*, s.full_name, s.admission_no, s.roll_no, c.name AS class_name, sec.name AS section_name, s.photo_url,
       s.father_name, s.dob
     FROM exam_results r JOIN students s ON s.id = r.student_id
     LEFT JOIN classes c ON c.id = r.class_id LEFT JOIN sections sec ON sec.id = r.section_id
     WHERE ${where.join(' AND ')} ORDER BY r.rank, s.full_name`,
  ).all(...params).map((r) => ({ ...r, subjects_data: safeJson(r.subjects_data) }));

  const stats = {
    students: rows.length,
    passed: rows.filter((r) => r.result_status === 'pass').length,
    failed: rows.filter((r) => r.result_status !== 'pass').length,
    average: rows.length ? Math.round((rows.reduce((s, r) => s + r.percentage, 0) / rows.length) * 10) / 10 : 0,
    highest: rows.length ? Math.max(...rows.map((r) => r.percentage)) : 0,
    lowest: rows.length ? Math.min(...rows.map((r) => r.percentage)) : 0,
    gradeDistribution: rows.reduce((acc, r) => {
      acc[r.grade] = (acc[r.grade] || 0) + 1;
      return acc;
    }, {}),
  };

  res.json({ exam, items: rows, stats });
}));

router.get('/:id/results/export', requirePermission('results.export'), asyncHandler(async (req, res) => {
  const exam = db.prepare('SELECT * FROM exams WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!exam) throw notFound('Examination not found');
  const rows = db.prepare(
    `SELECT r.*, s.full_name, s.admission_no, c.name AS class_name, sec.name AS section_name
     FROM exam_results r JOIN students s ON s.id = r.student_id
     LEFT JOIN classes c ON c.id = r.class_id LEFT JOIN sections sec ON sec.id = r.section_id
     WHERE r.exam_id = ? ORDER BY r.class_id, r.rank`,
  ).all(exam.id);

  const subjectNames = [...new Set(rows.flatMap((r) => safeJson(r.subjects_data).map((s) => s.subject_name)))];
  const columns = [
    { label: 'Rank', key: 'rank' },
    { label: 'Admission No', key: 'admission_no' },
    { label: 'Student', key: 'full_name' },
    { label: 'Class', key: 'class_name' },
    { label: 'Section', key: 'section_name' },
    ...subjectNames.map((name) => ({
      label: name,
      value: (row) => safeJson(row.subjects_data).find((s) => s.subject_name === name)?.obtained ?? '',
    })),
    { label: 'Total', value: (r) => `${r.total_obtained}/${r.total_max}` },
    { label: 'Percentage', value: (r) => `${r.percentage}%` },
    { label: 'Grade', key: 'grade' },
    { label: 'Result', key: 'result_status' },
  ];
  audit(req, { action: 'export', module: 'results', entityType: 'exam', entityId: exam.id, summary: `Exported results for ${exam.name}` });
  await sendTable(req, res, { filename: `results-${exam.name.replace(/\s+/g, '-').toLowerCase()}`, title: exam.name, columns, rows });
}));

function resultContext(resultId, schoolId) {
  const result = db.prepare(
    `SELECT r.*, s.full_name, s.admission_no, s.roll_no, s.photo_url, s.dob, s.father_name, s.guardian_name,
       c.name AS class_name, sec.name AS section_name
     FROM exam_results r JOIN students s ON s.id = r.student_id
     LEFT JOIN classes c ON c.id = r.class_id LEFT JOIN sections sec ON sec.id = r.section_id
     WHERE r.id = ? AND r.school_id = ?`,
  ).get(resultId, schoolId);
  if (!result) throw notFound('Result not found');
  const exam = db.prepare(
    `SELECT e.*, ses.name AS session_name FROM exams e LEFT JOIN academic_sessions ses ON ses.id = e.session_id WHERE e.id = ?`,
  ).get(result.exam_id);
  const template = getSetting(schoolId, 'theme', 'reportCard', {});
  const scale = db.prepare('SELECT * FROM grading_scales WHERE id = ?').get(exam.grading_scale_id)
    || db.prepare('SELECT * FROM grading_scales WHERE school_id = ? ORDER BY is_default DESC LIMIT 1').get(schoolId);
  return { result: { ...result, subjects_data: safeJson(result.subjects_data) }, exam, template, gradeRanges: safeJson(scale?.ranges, []) };
}

router.get('/results/:resultId/report-card', requirePermission('results.view', 'results.export'), asyncHandler(async (req, res) => {
  const { result, exam, template, gradeRanges } = resultContext(req.params.resultId, req.user.school_id);
  const doc = reportCardPdf({
    school: req.user.school, student: result, result, exam, template, gradeRanges,
  });
  audit(req, { action: 'download', module: 'results', entityType: 'exam_result', entityId: result.id, summary: `Downloaded report card for ${result.full_name}` });
  streamPdf(res, doc, `report-card-${result.admission_no}-${exam.name.replace(/\s+/g, '-')}.pdf`);
}));

router.get('/:id/report-cards', requirePermission('results.export'), asyncHandler(async (req, res) => {
  const exam = db.prepare(
    `SELECT e.*, ses.name AS session_name FROM exams e LEFT JOIN academic_sessions ses ON ses.id = e.session_id
     WHERE e.id = ? AND e.school_id = ?`,
  ).get(req.params.id, req.user.school_id);
  if (!exam) throw notFound('Examination not found');
  const where = ['r.exam_id = ?'];
  const params = [exam.id];
  if (req.query.classId && req.query.classId !== 'all') { where.push('r.class_id = ?'); params.push(req.query.classId); }
  if (req.query.sectionId && req.query.sectionId !== 'all') { where.push('r.section_id = ?'); params.push(req.query.sectionId); }
  const ids = db.prepare(`SELECT r.id FROM exam_results r WHERE ${where.join(' AND ')} ORDER BY r.class_id, r.rank`).all(...params).map((r) => r.id);
  if (!ids.length) throw badRequest('No results to export');
  if (ids.length > 400) throw badRequest('Export at most 400 report cards at a time');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="report-cards-${exam.name.replace(/\s+/g, '-').toLowerCase()}.pdf"`);
  const master = createDoc({ title: `Report cards - ${exam.name}` });
  master.pipe(res);
  ids.forEach((id, index) => {
    if (index > 0) master.addPage();
    const ctx = resultContext(id, req.user.school_id);
    reportCardPdf({ ...ctx, school: req.user.school, exam, doc: master });
  });
  finishDoc(master, { footerText: `${req.user.school.name} • ${exam.name}` });
  master.end();
  audit(req, { action: 'export', module: 'results', entityType: 'exam', entityId: exam.id, summary: `Bulk downloaded ${ids.length} report cards` });
}));

router.patch('/results/:resultId/remarks', requirePermission('results.view', 'results.publish', 'homework.grade'), validateBody(z.object({
  teacher_remark: z.string().max(500).optional(),
  principal_remark: z.string().max(500).optional(),
})), asyncHandler(async (req, res) => {
  const result = db.prepare('SELECT * FROM exam_results WHERE id = ? AND school_id = ?').get(req.params.resultId, req.user.school_id);
  if (!result) throw notFound('Result not found');
  if (req.data.principal_remark !== undefined && req.user.role !== 'principal' && !can(req.user, 'results.publish')) {
    throw forbidden('Only the principal can edit principal remarks');
  }
  db.prepare('UPDATE exam_results SET teacher_remark = ?, principal_remark = ? WHERE id = ?')
    .run(req.data.teacher_remark ?? result.teacher_remark, req.data.principal_remark ?? result.principal_remark, result.id);
  audit(req, {
    action: 'remarks', module: 'results', entityType: 'exam_result', entityId: result.id,
    summary: 'Updated report card remarks', meta: req.data,
  });
  res.json({ ok: true });
}));

/** Correct a published result: requires reason, writes a revision, recalculates. */
router.post('/results/:resultId/correct', requirePermission('results.correct'), validateBody(z.object({
  reason: z.string().min(5).max(500),
  subjects: z.array(z.object({
    exam_subject_id: z.string().min(1),
    marks_obtained: z.coerce.number().min(0).nullish(),
    theory_marks: z.coerce.number().min(0).nullish(),
    practical_marks: z.coerce.number().min(0).nullish(),
    is_absent: z.boolean().optional().default(false),
    is_exempt: z.boolean().optional().default(false),
  })).min(1).max(30),
})), asyncHandler(async (req, res) => {
  const result = db.prepare('SELECT * FROM exam_results WHERE id = ? AND school_id = ?').get(req.params.resultId, req.user.school_id);
  if (!result) throw notFound('Result not found');
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(result.exam_id);

  const at = nowIso();
  const run = db.transaction(() => {
    for (const entry of req.data.subjects) {
      const subject = db.prepare('SELECT * FROM exam_subjects WHERE id = ? AND exam_id = ?').get(entry.exam_subject_id, exam.id);
      if (!subject) continue;
      let obtained = entry.marks_obtained;
      if (entry.is_exempt) obtained = null;
      else if (entry.is_absent) obtained = 0;
      if (obtained != null && obtained > Number(subject.max_marks)) {
        throw badRequest(`Marks for ${subject.subject_id} exceed the maximum of ${subject.max_marks}`);
      }
      const existing = db.prepare('SELECT * FROM exam_marks WHERE exam_subject_id = ? AND student_id = ?').get(subject.id, result.student_id);
      if (existing) {
        db.prepare(
          `UPDATE exam_marks SET theory_marks = ?, practical_marks = ?, marks_obtained = ?, is_absent = ?, is_exempt = ?,
            entered_by = ?, updated_at = ? WHERE id = ?`,
        ).run(entry.theory_marks ?? null, entry.practical_marks ?? null, obtained, entry.is_absent ? 1 : 0,
          entry.is_exempt ? 1 : 0, req.user.id, at, existing.id);
      } else {
        db.prepare(
          `INSERT INTO exam_marks (id, school_id, exam_subject_id, student_id, theory_marks, practical_marks, marks_obtained,
            is_absent, is_exempt, entered_by, entered_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(newId('emk'), req.user.school_id, subject.id, result.student_id, entry.theory_marks ?? null,
          entry.practical_marks ?? null, obtained, entry.is_absent ? 1 : 0, entry.is_exempt ? 1 : 0, req.user.id, at, at);
      }
    }
  });
  run();

  // Recalculate the whole examination so ranks stay correct.
  computeExamResults(exam.id, { schoolId: req.user.school_id, userId: req.user.id, reason: req.data.reason });
  const refreshed = db.prepare('SELECT * FROM exam_results WHERE id = ?').get(result.id);

  audit(req, {
    action: 'result_corrected', module: 'results', entityType: 'exam_result', entityId: result.id,
    summary: `Corrected published result for student ${result.student_id}: ${req.data.reason}`,
    meta: {
      before: { total: result.total_obtained, percentage: result.percentage, grade: result.grade, rank: result.rank },
      after: { total: refreshed.total_obtained, percentage: refreshed.percentage, grade: refreshed.grade, rank: refreshed.rank },
      subjects: req.data.subjects.map((s) => s.exam_subject_id),
    },
  });
  res.json({ ok: true, result: { ...refreshed, subjects_data: safeJson(refreshed.subjects_data) } });
}));

router.get('/results/:resultId/revisions', requirePermission('results.view', 'results.correct'), asyncHandler(async (req, res) => {
  const rows = db.prepare(
    `SELECT rv.*, u.full_name AS changed_by_name FROM result_revisions rv
     LEFT JOIN users u ON u.id = rv.changed_by WHERE rv.result_id = ? ORDER BY rv.created_at DESC`,
  ).all(req.params.resultId);
  res.json({ items: rows.map((r) => ({ ...r, before_json: safeJson(r.before_json, null), after_json: safeJson(r.after_json, null) })) });
}));


export default router;
