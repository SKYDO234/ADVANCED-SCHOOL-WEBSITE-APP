import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso, newId } from '../db/index.js';
import { validateBody } from '../lib/validate.js';
import { forbidden, notFound, badRequest, asyncHandler } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { portalStudentIds } from '../lib/notify.js';
import { studentFeePosition, recomputeInvoice } from '../lib/fees.js';
import { isGatewayReady, createRazorpayOrder, paymentConfig } from '../lib/integrations.js';
import { currentSession } from '../lib/defaults.js';
import { invoicePdf, receiptPdf, streamPdf } from '../lib/pdf.js';

const router = Router();

const safeJson = (v, f = []) => {
  if (v == null) return f;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return f; }
};

function requirePortal(req) {
  if (!['student', 'parent'].includes(req.user.role)) throw forbidden('This area is for students and parents');
}

function assertLinked(req, studentId) {
  const ids = portalStudentIds(req.user);
  if (!ids.includes(studentId)) throw forbidden('This student is not linked to your account');
  return ids;
}

function studentSummary(studentId) {
  const student = db.prepare(
    `SELECT s.*, c.name AS class_name, sec.name AS section_name FROM students s
     LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id
     WHERE s.id = ? AND s.school_id = ?`,
  ).get(studentId, db.prepare('SELECT school_id FROM students WHERE id = ?').get(studentId)?.school_id);
  if (!student) throw notFound('Student not found');

  const attendance = db.prepare(
    "SELECT COUNT(*) total, SUM(CASE WHEN status IN ('present','late') THEN 1 ELSE 0 END) present, SUM(CASE WHEN status='absent' THEN 1 ELSE 0 END) absent FROM attendance WHERE entity_id = ? AND entity_type = 'student'",
  ).get(studentId);

  const results = db.prepare(
    `SELECT r.*, e.name AS exam_name, ses.name AS session_name FROM exam_results r
     JOIN exams e ON e.id = r.exam_id LEFT JOIN academic_sessions ses ON ses.id = r.session_id
     WHERE r.student_id = ? AND r.is_published = 1 ORDER BY e.start_date DESC`,
  ).all(studentId).map((r) => ({ ...r, subjects_data: safeJson(r.subjects_data) }));

  const fees = studentFeePosition(studentId);
  const invoices = db.prepare("SELECT * FROM invoices WHERE student_id = ? AND status != 'cancelled' ORDER BY due_date DESC LIMIT 20").all(studentId);
  const payments = db.prepare("SELECT * FROM payments WHERE student_id = ? AND status IN ('success','partially_refunded') ORDER BY COALESCE(paid_at, created_at) DESC LIMIT 20").all(studentId);

  const day = new Date().getDay() === 0 ? 7 : new Date().getDay();
  const session = currentSession(student.school_id);
  const timetable = db.prepare(
    `SELECT te.*, tp.name AS period_name, tp.start_time, tp.end_time, sub.name AS subject_name, u.full_name AS teacher_name
     FROM timetable_entries te JOIN timetable_periods tp ON tp.id = te.period_id
     LEFT JOIN subjects sub ON sub.id = te.subject_id LEFT JOIN users u ON u.id = te.teacher_id
     WHERE te.school_id = ? AND te.session_id = ? AND te.section_id = ? AND te.day = ?
     ORDER BY tp.sort_order`,
  ).all(student.school_id, session?.id, student.section_id, day);

  const homework = db.prepare(
    `SELECT a.*, s.name AS subject_name,
       (SELECT status FROM assignment_submissions x WHERE x.assignment_id = a.id AND x.student_id = ?) my_status,
       (SELECT marks FROM assignment_submissions x WHERE x.assignment_id = a.id AND x.student_id = ?) my_marks
     FROM assignments a LEFT JOIN subjects s ON s.id = a.subject_id
     WHERE a.school_id = ? AND a.status = 'published' AND a.class_id = ?
       AND (a.section_id IS NULL OR a.section_id = ?)
     ORDER BY a.due_date DESC LIMIT 10`,
  ).all(studentId, studentId, student.school_id, student.class_id, student.section_id);

  const documents = db.prepare("SELECT * FROM documents WHERE owner_type = 'student' AND owner_id = ? ORDER BY created_at DESC").all(studentId);

  return {
    student,
    attendance: {
      total: attendance.total || 0,
      present: attendance.present || 0,
      absent: attendance.absent || 0,
      percentage: attendance.total ? Math.round(((attendance.present || 0) / attendance.total) * 100) : null,
    },
    results,
    fees: { ...fees, invoices, payments },
    timetable,
    homework,
    documents,
  };
}

router.get('/children', asyncHandler(async (req, res) => {
  requirePortal(req);
  const ids = portalStudentIds(req.user);
  const items = ids.map((id) => {
    const s = db.prepare(
      `SELECT s.id, s.full_name, s.admission_no, s.roll_no, s.photo_url, c.name AS class_name, sec.name AS section_name
       FROM students s LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id WHERE s.id = ?`,
    ).get(id);
    if (!s) return null;
    const att = db.prepare(
      "SELECT COUNT(*) t, SUM(CASE WHEN status IN ('present','late') THEN 1 ELSE 0 END) p FROM attendance WHERE entity_id = ?",
    ).get(id);
    const fee = studentFeePosition(id);
    return { ...s, attendancePercentage: att.t ? Math.round((att.p / att.t) * 100) : null, due: fee.due };
  }).filter(Boolean);
  res.json({ items });
}));

router.get('/overview', asyncHandler(async (req, res) => {
  requirePortal(req);
  const ids = portalStudentIds(req.user);
  if (!ids.length) {
    return res.json({
      scope: 'portal', students: [], studentId: null,
      message: req.user.role === 'parent'
        ? 'No children are linked to this account yet. Contact the school office.'
        : 'Your student profile is not linked yet. Contact the school office.',
    });
  }
  const studentId = req.query.studentId && ids.includes(req.query.studentId) ? req.query.studentId : ids[0];
  const data = studentSummary(studentId);
  const children = ids.map((id) => {
    const s = db.prepare('SELECT id, full_name FROM students WHERE id = ?').get(id);
    return s;
  });
  res.json({ scope: 'portal', studentId, children, ...data, gatewayReady: isGatewayReady(req.user.school_id) });
}));

router.get('/profile', asyncHandler(async (req, res) => {
  requirePortal(req);
  const ids = portalStudentIds(req.user);
  const items = ids.map((id) => studentSummary(id).student);
  res.json({ items, user: { id: req.user.id, full_name: req.user.full_name, email: req.user.email, phone: req.user.phone, role: req.user.role } });
}));

router.get('/fees', asyncHandler(async (req, res) => {
  requirePortal(req);
  const ids = portalStudentIds(req.user);
  const studentId = req.query.studentId && ids.includes(req.query.studentId) ? req.query.studentId : ids[0];
  if (!studentId) return res.json({ items: [], position: null });
  const invoices = db.prepare(
    "SELECT i.*, (SELECT COUNT(*) FROM payments p WHERE p.invoice_id = i.id AND p.status IN ('success','partially_refunded')) payments FROM invoices i WHERE i.student_id = ? ORDER BY i.due_date DESC",
  ).all(studentId);
  const payments = db.prepare(
    "SELECT p.*, i.invoice_no FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.student_id = ? AND p.status IN ('success','partially_refunded') ORDER BY COALESCE(p.paid_at, p.created_at) DESC",
  ).all(studentId);
  res.json({
    studentId, invoices, payments,
    position: studentFeePosition(studentId),
    gatewayReady: isGatewayReady(req.user.school_id),
  });
}));

router.get('/attendance', asyncHandler(async (req, res) => {
  requirePortal(req);
  const ids = portalStudentIds(req.user);
  const studentId = req.query.studentId && ids.includes(req.query.studentId) ? req.query.studentId : ids[0];
  if (!studentId) return res.json({ items: [], summary: null });
  const items = db.prepare('SELECT * FROM attendance WHERE entity_id = ? AND entity_type = ? ORDER BY date DESC LIMIT 120')
    .all(studentId, 'student');
  const summary = db.prepare(
    `SELECT status, COUNT(*) c FROM attendance WHERE entity_id = ? AND entity_type = 'student' GROUP BY status`,
  ).all(studentId);
  const total = summary.reduce((s, r) => s + r.c, 0);
  const present = summary.filter((r) => r.status === 'present' || r.status === 'late').reduce((s, r) => s + r.c, 0);
  res.json({ studentId, items, summary, percentage: total ? Math.round((present / total) * 100) : null });
}));

router.get('/timetable', asyncHandler(async (req, res) => {
  requirePortal(req);
  const ids = portalStudentIds(req.user);
  const studentId = req.query.studentId && ids.includes(req.query.studentId) ? req.query.studentId : ids[0];
  if (!studentId) return res.json({ entries: [], periods: [] });
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  const session = currentSession(req.user.school_id);
  const periods = db.prepare('SELECT * FROM timetable_periods WHERE school_id = ? ORDER BY sort_order').all(req.user.school_id);
  const entries = db.prepare(
    `SELECT te.*, tp.name AS period_name, tp.start_time, tp.end_time, tp.sort_order, s.name AS subject_name, u.full_name AS teacher_name
     FROM timetable_entries te JOIN timetable_periods tp ON tp.id = te.period_id
     LEFT JOIN subjects s ON s.id = te.subject_id LEFT JOIN users u ON u.id = te.teacher_id
     WHERE te.school_id = ? AND te.session_id = ? AND te.section_id = ? ORDER BY te.day, tp.sort_order`,
  ).all(req.user.school_id, session?.id, student?.section_id);
  res.json({ periods, entries, section_id: student?.section_id });
}));

/* ------------------------------- online payment --------------------------- */

router.post('/pay', validateBody(z.object({
  invoice_id: z.string().min(1),
  amount: z.coerce.number().positive().optional(),
})), asyncHandler(async (req, res) => {
  requirePortal(req);
  if (!isGatewayReady(req.user.school_id)) {
    throw badRequest('Online payment is not enabled by the school yet. Please pay at the school office.');
  }
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND school_id = ?').get(req.data.invoice_id, req.user.school_id);
  if (!invoice) throw notFound('Invoice not found');
  assertLinked(req, invoice.student_id);
  if (invoice.balance <= 0) throw badRequest('This invoice is already settled');
  const amount = Math.round((req.data.amount || invoice.balance) * 100) / 100;
  if (amount > Number(invoice.balance) + 0.01) throw badRequest('Amount exceeds the outstanding balance');

  const id = newId('pmy');
  const order = await createRazorpayOrder(req.user.school_id, {
    amount, receipt: `rcpt_${id.slice(-10)}`, notes: { invoice_id: invoice.id, student_id: invoice.student_id },
  });
  db.prepare(
    `INSERT INTO payments (id, school_id, invoice_id, student_id, amount, currency, method, status, gateway, gateway_order_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, req.user.school_id, invoice.id, invoice.student_id, amount, 'INR', 'card', 'pending', 'razorpay', order.id, nowIso(), nowIso());

  audit(req, { action: 'payment_initiated', module: 'fees', entityType: 'payment', entityId: id, summary: `Online payment initiated for ${invoice.invoice_no}` });
  res.json({
    paymentId: id, orderId: order.id, amount: order.amount, currency: order.currency,
    keyId: paymentConfig(req.user.school_id).keyId,
    invoice: { id: invoice.id, invoice_no: invoice.invoice_no, balance: invoice.balance },
  });
}));

router.get('/invoice/:id/pdf', asyncHandler(async (req, res) => {
  requirePortal(req);
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!invoice) throw notFound('Invoice not found');
  assertLinked(req, invoice.student_id);
  const student = db.prepare(
    `SELECT s.*, c.name AS class_name, sec.name AS section_name FROM students s
     LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id WHERE s.id = ?`,
  ).get(invoice.student_id);
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(invoice.id);
  const payments = db.prepare("SELECT * FROM payments WHERE invoice_id = ? AND status IN ('success','partially_refunded')").all(invoice.id);
  streamPdf(res, invoicePdf({ school: req.user.school, student, invoice, items, payments }), `invoice-${invoice.invoice_no}.pdf`);
}));

router.get('/receipt/:id/pdf', asyncHandler(async (req, res) => {
  requirePortal(req);
  const payment = db.prepare('SELECT * FROM payments WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!payment) throw notFound('Receipt not found');
  assertLinked(req, payment.student_id);
  const student = db.prepare(
    `SELECT s.*, c.name AS class_name, sec.name AS section_name FROM students s
     LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id WHERE s.id = ?`,
  ).get(payment.student_id);
  const invoice = payment.invoice_id ? db.prepare('SELECT * FROM invoices WHERE id = ?').get(payment.invoice_id) : null;
  streamPdf(res, receiptPdf({ school: req.user.school, student, payment, invoice }), `receipt-${payment.receipt_no || payment.id}.pdf`);
}));

/* ------------------------------ report card PDF --------------------------- */

router.get('/report-card/:resultId/pdf', asyncHandler(async (req, res) => {
  requirePortal(req);
  const result = db.prepare('SELECT * FROM exam_results WHERE id = ? AND school_id = ? AND is_published = 1').get(req.params.resultId, req.user.school_id);
  if (!result) throw notFound('Report card not found');
  assertLinked(req, result.student_id);
  const { reportCardPdf } = await import('../lib/pdf.js');
  const student = db.prepare(
    `SELECT s.*, c.name AS class_name, sec.name AS section_name FROM students s
     LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id WHERE s.id = ?`,
  ).get(result.student_id);
  const exam = db.prepare(
    'SELECT e.*, ses.name AS session_name FROM exams e LEFT JOIN academic_sessions ses ON ses.id = e.session_id WHERE e.id = ?',
  ).get(result.exam_id);
  const template = db.prepare("SELECT value FROM settings WHERE school_id = ? AND category = 'theme' AND key = 'reportCard'").get(req.user.school_id);
  const scale = db.prepare('SELECT * FROM grading_scales WHERE id = ?').get(exam.grading_scale_id)
    || db.prepare('SELECT * FROM grading_scales WHERE school_id = ? ORDER BY is_default DESC LIMIT 1').get(req.user.school_id);
  const doc = reportCardPdf({
    school: req.user.school,
    student,
    result: { ...result, subjects_data: safeJson(result.subjects_data) },
    exam,
    template: template ? safeJson(template.value, {}) : {},
    gradeRanges: safeJson(scale?.ranges, []),
  });
  streamPdf(res, doc, `report-card-${student.admission_no}.pdf`);
}));

export default router;
