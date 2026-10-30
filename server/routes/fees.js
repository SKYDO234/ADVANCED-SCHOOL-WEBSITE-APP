import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso, newId, getSetting } from '../db/index.js';
import { validateBody, pagination, searchTerm, sorting } from '../lib/validate.js';
import { requirePermission, can } from '../lib/auth.js';
import { badRequest, conflict, forbidden, notFound, asyncHandler } from '../lib/errors.js';
import { audit, notifyUsers } from '../lib/audit.js';
import { currentSession } from '../lib/defaults.js';
import { sendTable } from '../lib/export.js';
import {
  invoicePdf, receiptPdf, tableReportPdf, streamPdf, money as fmtMoney,
} from '../lib/pdf.js';
import {
  money, nextInvoiceNo, nextReceiptNo, recomputeInvoice, applySuccessfulPayment,
  applyLateFees, studentFeePosition, syncStudentFees,
} from '../lib/fees.js';
import {
  isGatewayReady, createRazorpayOrder, fetchRazorpayPayment, verifyCheckoutSignature, paymentConfig,
} from '../lib/integrations.js';

const router = Router();
const round = (n) => Math.round(Number(n || 0) * 100) / 100;

/* --------------------------------- helpers -------------------------------- */

function structureGross(structId) {
  const items = db.prepare('SELECT * FROM fee_structure_items WHERE fee_structure_id = ?').all(structId);
  return round(items.reduce((sum, it) => {
    const multiplier = it.frequency === 'monthly' ? 12 : it.frequency === 'quarterly' ? 4 : 1;
    return sum + Number(it.amount) * multiplier;
  }, 0));
}

function discountTotal(studentId, sessionId, gross) {
  const rows = db.prepare('SELECT * FROM student_discounts WHERE student_id = ? AND (session_id IS NULL OR session_id = ?)')
    .all(studentId, sessionId);
  return round(rows.reduce((sum, d) => {
    if (d.calc_type === 'percent') return sum + (d.value / 100) * gross;
    return sum + Number(d.value || d.amount || 0);
  }, 0));
}

function syncStudentFeeRow(studentId, sessionId, structId = null) {
  const existing = db.prepare('SELECT * FROM student_fees WHERE student_id = ? AND session_id = ?').get(studentId, sessionId);
  const structureId = structId || existing?.fee_structure_id;
  const gross = structureId ? structureGross(structureId) : Number(existing?.gross_amount || 0);
  const discount = discountTotal(studentId, sessionId, gross);
  const net = round(Math.max(0, gross - discount));
  const paid = Number(existing?.paid_amount || 0);
  const due = round(Math.max(0, net - paid));
  if (existing) {
    db.prepare(
      `UPDATE student_fees SET fee_structure_id = ?, gross_amount = ?, discount_amount = ?, net_amount = ?, due_amount = ?,
        status = ?, updated_at = ? WHERE id = ?`,
    ).run(structureId, gross, discount, net, due, due <= 0 ? 'paid' : paid > 0 ? 'partial' : 'pending', nowIso(), existing.id);
    return existing.id;
  }
  const id = newId('sf');
  db.prepare(
    `INSERT INTO student_fees (id, school_id, session_id, student_id, fee_structure_id, gross_amount, discount_amount,
      net_amount, paid_amount, due_amount, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, db.prepare('SELECT school_id FROM students WHERE id = ?').get(studentId).school_id, sessionId, studentId,
    structureId, gross, discount, net, paid, due, 'pending', nowIso(), nowIso());
  return id;
}

export { syncStudentFeeRow, structureGross, discountTotal };

/* -------------------------------- dashboard ------------------------------- */

router.get('/summary', requirePermission('fees.view'), asyncHandler(async (req, res) => {
  const schoolId = req.user.school_id;
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const session = currentSession(schoolId);

  const sum = (sql, ...params) => db.prepare(sql).get(...params);

  const collected = sum(
    "SELECT COALESCE(SUM(amount),0) v FROM payments WHERE school_id = ? AND status IN ('success','partially_refunded')",
    schoolId,
  ).v;
  const todayCollected = sum(
    "SELECT COALESCE(SUM(amount),0) v, COUNT(*) c FROM payments WHERE school_id = ? AND status IN ('success','partially_refunded') AND date(paid_at) = ?",
    schoolId, today,
  );
  const monthCollected = sum(
    "SELECT COALESCE(SUM(amount),0) v FROM payments WHERE school_id = ? AND status IN ('success','partially_refunded') AND date(paid_at) >= ?",
    schoolId, monthStart,
  ).v;
  const sessionCollected = sum(
    "SELECT COALESCE(SUM(amount),0) v FROM payments WHERE school_id = ? AND status IN ('success','partially_refunded') AND date(paid_at) >= ?",
    schoolId, session?.start_date || `${today.slice(0, 4)}-01-01`,
  ).v;
  const pending = sum(
    "SELECT COALESCE(SUM(balance),0) v, COUNT(*) c FROM invoices WHERE school_id = ? AND status IN ('unpaid','partial','overdue') AND balance > 0",
    schoolId,
  );
  const overdue = sum(
    "SELECT COALESCE(SUM(balance),0) v, COUNT(*) c FROM invoices WHERE school_id = ? AND status = 'overdue'",
    schoolId,
  );
  const refunds = sum("SELECT COALESCE(SUM(amount),0) v FROM refunds WHERE school_id = ?", schoolId).v;
  const discounts = sum(
    'SELECT COALESCE(SUM(discount_amount),0) v FROM student_fees WHERE school_id = ?', schoolId,
  ).v;
  const expenses = sum(
    'SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE school_id = ?', schoolId,
  ).v;
  const billed = sum('SELECT COALESCE(SUM(net_amount),0) v FROM student_fees WHERE school_id = ?', schoolId).v;

  const methods = db.prepare(
    `SELECT method, COUNT(*) count, COALESCE(SUM(amount),0) total FROM payments
     WHERE school_id = ? AND status IN ('success','partially_refunded') GROUP BY method ORDER BY total DESC`,
  ).all(schoolId);

  const byClass = db.prepare(
    `SELECT c.id, c.name, COUNT(DISTINCT s.id) students,
       COALESCE(SUM(sf.net_amount),0) billed, COALESCE(SUM(sf.paid_amount),0) collected, COALESCE(SUM(sf.due_amount),0) due
     FROM classes c LEFT JOIN students s ON s.class_id = c.id AND s.status = 'active'
     LEFT JOIN student_fees sf ON sf.student_id = s.id
     WHERE c.school_id = ? GROUP BY c.id ORDER BY c.order_index`,
  ).all(schoolId);

  const monthly = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date();
    d.setMonth(d.getMonth() - i, 1);
    const key = d.toISOString().slice(0, 7);
    const row = db.prepare(
      `SELECT COALESCE(SUM(amount),0) v FROM payments WHERE school_id = ?
       AND status IN ('success','partially_refunded') AND substr(COALESCE(paid_at, created_at),1,7) = ?`,
    ).get(schoolId, key);
    monthly.push({ month: key, label: d.toLocaleString('en-IN', { month: 'short' }), value: Math.round(row.v) });
  }

  const expenseByCategory = db.prepare(
    'SELECT category, COALESCE(SUM(amount),0) total FROM expenses WHERE school_id = ? GROUP BY category ORDER BY total DESC',
  ).all(schoolId);

  const recent = db.prepare(
    `SELECT p.id, p.amount, p.method, p.receipt_no, p.paid_at, p.status, s.full_name, s.admission_no
     FROM payments p LEFT JOIN students s ON s.id = p.student_id
     WHERE p.school_id = ? ORDER BY COALESCE(p.paid_at, p.created_at) DESC LIMIT 10`,
  ).all(schoolId);

  const defaulters = db.prepare(
    `SELECT s.id, s.full_name, s.admission_no, c.name AS class_name, sf.due_amount, sf.net_amount, sf.paid_amount
     FROM student_fees sf JOIN students s ON s.id = sf.student_id LEFT JOIN classes c ON c.id = s.class_id
     WHERE sf.school_id = ? AND sf.due_amount > 0 ORDER BY sf.due_amount DESC LIMIT 10`,
  ).all(schoolId);

  res.json({
    kpis: {
      collected: round(collected), todayCollected: round(todayCollected.v), todayReceipts: todayCollected.c,
      monthCollected: round(monthCollected), sessionCollected: round(sessionCollected),
      pending: round(pending.v), pendingInvoices: pending.c, overdue: round(overdue.v), overdueInvoices: overdue.c,
      refunds: round(refunds), discounts: round(discounts), expenses: round(expenses),
      billed: round(billed), netPosition: round(collected - expenses - refunds),
    },
    charts: { monthly, methods, byClass, expenseByCategory },
    recent, defaulters,
    gateway: { ready: isGatewayReady(schoolId), ...paymentConfig(schoolId) },
  });
}));

/* -------------------------------- fee heads ------------------------------- */

router.get('/heads', requirePermission('fees.view'), asyncHandler(async (req, res) => {
  const items = db.prepare(
    `SELECT fh.*, (SELECT COUNT(*) FROM fee_structure_items i WHERE i.fee_head_id = fh.id) usage
     FROM fee_heads fh WHERE fh.school_id = ? ORDER BY fh.name`,
  ).all(req.user.school_id);
  res.json({ items });
}));

router.post('/heads', requirePermission('fees.structure'), validateBody(z.object({
  name: z.string().min(2).max(60),
  code: z.string().max(12).optional().default(''),
  type: z.enum(['one_time', 'monthly', 'quarterly', 'annual', 'custom']).default('annual'),
  description: z.string().max(200).optional().default(''),
})), asyncHandler(async (req, res) => {
  const exists = db.prepare('SELECT id FROM fee_heads WHERE school_id = ? AND lower(name) = lower(?)').get(req.user.school_id, req.data.name);
  if (exists) throw conflict('This fee head already exists');
  const id = newId('fh');
  db.prepare('INSERT INTO fee_heads (id, school_id, name, code, type, description, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, req.user.school_id, req.data.name, req.data.code || null, req.data.type, req.data.description, 1, nowIso(), nowIso());
  audit(req, { action: 'create', module: 'fees', entityType: 'fee_head', entityId: id, summary: `Created fee head ${req.data.name}` });
  res.status(201).json({ id });
}));

router.patch('/heads/:id', requirePermission('fees.structure'), validateBody(z.object({
  name: z.string().min(2).max(60).optional(),
  code: z.string().max(12).optional(),
  type: z.enum(['one_time', 'monthly', 'quarterly', 'annual', 'custom']).optional(),
  description: z.string().max(200).optional(),
  is_active: z.boolean().optional(),
})), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM fee_heads WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Fee head not found');
  db.prepare('UPDATE fee_heads SET name = ?, code = ?, type = ?, description = ?, is_active = ?, updated_at = ? WHERE id = ?')
    .run(req.data.name ?? row.name, req.data.code ?? row.code, req.data.type ?? row.type,
      req.data.description ?? row.description, req.data.is_active === undefined ? row.is_active : (req.data.is_active ? 1 : 0),
      nowIso(), row.id);
  res.json({ ok: true });
}));

router.delete('/heads/:id', requirePermission('fees.structure'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM fee_heads WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Fee head not found');
  const used = db.prepare('SELECT COUNT(*) c FROM fee_structure_items WHERE fee_head_id = ?').get(row.id).c;
  if (used) throw conflict('This fee head is used in fee structures');
  db.prepare('DELETE FROM fee_heads WHERE id = ?').run(row.id);
  audit(req, { action: 'delete', module: 'fees', entityType: 'fee_head', entityId: row.id, summary: `Deleted fee head ${row.name}` });
  res.json({ ok: true });
}));

/* ----------------------------- fee structures ----------------------------- */

router.get('/structures', requirePermission('fees.view'), asyncHandler(async (req, res) => {
  const sessionId = req.query.sessionId || currentSession(req.user.school_id)?.id;
  const structures = db.prepare(
    `SELECT fs.*, c.name AS class_name, ses.name AS session_name,
       (SELECT COUNT(*) FROM student_fees sf WHERE sf.fee_structure_id = fs.id) assigned
     FROM fee_structures fs LEFT JOIN classes c ON c.id = fs.class_id
     LEFT JOIN academic_sessions ses ON ses.id = fs.session_id
     WHERE fs.school_id = ? AND (? IS NULL OR fs.session_id = ?) ORDER BY c.order_index, fs.name`,
  ).all(req.user.school_id, sessionId, sessionId);
  const items = db.prepare(
    `SELECT i.*, fh.name AS head_name, fh.type AS head_type FROM fee_structure_items i
     JOIN fee_heads fh ON fh.id = i.fee_head_id WHERE i.school_id = ? ORDER BY i.sort_order`,
  ).all(req.user.school_id);
  res.json({
    items: structures.map((s) => ({
      ...s,
      gross: structureGross(s.id),
      items: items.filter((i) => i.fee_structure_id === s.id),
    })),
    feeHeads: db.prepare('SELECT * FROM fee_heads WHERE school_id = ? AND is_active = 1 ORDER BY name').all(req.user.school_id),
    sessionId,
  });
}));

const structureSchema = z.object({
  name: z.string().min(2).max(80),
  class_id: z.string().nullish(),
  sessionId: z.string().optional(),
  description: z.string().max(200).optional().default(''),
  items: z.array(z.object({
    fee_head_id: z.string().min(1),
    amount: z.coerce.number().min(0).max(10_000_000),
    frequency: z.enum(['monthly', 'quarterly', 'annual', 'one_time', 'custom']).default('annual'),
    due_day: z.coerce.number().int().min(1).max(28).optional().default(10),
    is_optional: z.boolean().optional().default(false),
  })).min(1).max(40),
});

router.post('/structures', requirePermission('fees.structure'), validateBody(structureSchema), asyncHandler(async (req, res) => {
  const sessionId = req.data.sessionId || currentSession(req.user.school_id)?.id;
  if (!sessionId) throw badRequest('No academic session found');
  const id = newId('fst');
  const at = nowIso();
  const run = db.transaction(() => {
    db.prepare('INSERT INTO fee_structures (id, school_id, session_id, name, class_id, description, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, req.user.school_id, sessionId, req.data.name, req.data.class_id || null, req.data.description, 1, at, at);
    req.data.items.forEach((item, idx) => {
      db.prepare(
        `INSERT INTO fee_structure_items (id, school_id, fee_structure_id, fee_head_id, amount, frequency, due_day, is_optional, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(newId('fsi'), req.user.school_id, id, item.fee_head_id, item.amount, item.frequency,
        item.due_day, item.is_optional ? 1 : 0, idx);
    });
  });
  run();
  audit(req, { action: 'create', module: 'fees', entityType: 'fee_structure', entityId: id, summary: `Created fee structure ${req.data.name}`, meta: { gross: structureGross(id) } });
  res.status(201).json({ id, gross: structureGross(id) });
}));

router.patch('/structures/:id', requirePermission('fees.structure'), validateBody(structureSchema.partial()), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM fee_structures WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Fee structure not found');
  const at = nowIso();
  const run = db.transaction(() => {
    db.prepare('UPDATE fee_structures SET name = ?, class_id = ?, description = ?, is_active = ?, updated_at = ? WHERE id = ?')
      .run(req.data.name ?? row.name, req.data.class_id === undefined ? row.class_id : req.data.class_id,
        req.data.description ?? row.description, req.data.is_active === undefined ? row.is_active : (req.data.is_active ? 1 : 0), at, row.id);
    if (req.data.items) {
      db.prepare('DELETE FROM fee_structure_items WHERE fee_structure_id = ?').run(row.id);
      req.data.items.forEach((item, idx) => {
        db.prepare(
          `INSERT INTO fee_structure_items (id, school_id, fee_structure_id, fee_head_id, amount, frequency, due_day, is_optional, sort_order)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        ).run(newId('fsi'), req.user.school_id, row.id, item.fee_head_id, item.amount, item.frequency,
          item.due_day ?? 10, item.is_optional ? 1 : 0, idx);
      });
      // Re-sync every assigned student so ledgers stay correct.
      db.prepare('SELECT student_id FROM student_fees WHERE fee_structure_id = ?').all(row.id)
        .forEach((sf) => syncStudentFeeRow(sf.student_id, row.session_id, row.id));
    }
  });
  run();
  audit(req, { action: 'update', module: 'fees', entityType: 'fee_structure', entityId: row.id, summary: `Updated fee structure ${req.data.name || row.name}` });
  res.json({ ok: true, gross: structureGross(row.id) });
}));

router.delete('/structures/:id', requirePermission('fees.structure'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM fee_structures WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Fee structure not found');
  const assigned = db.prepare('SELECT COUNT(*) c FROM student_fees WHERE fee_structure_id = ?').get(row.id).c;
  if (assigned) throw conflict(`${assigned} student ledger(s) use this structure. Reassign them first.`);
  db.prepare('DELETE FROM fee_structure_items WHERE fee_structure_id = ?').run(row.id);
  db.prepare('DELETE FROM fee_structures WHERE id = ?').run(row.id);
  audit(req, { action: 'delete', module: 'fees', entityType: 'fee_structure', entityId: row.id, summary: `Deleted fee structure ${row.name}` });
  res.json({ ok: true });
}));

/* ------------------------------ student ledger ---------------------------- */

router.get('/students', requirePermission('fees.view'), asyncHandler(async (req, res) => {
  const { limit, offset, page } = pagination(req);
  const q = searchTerm(req);
  const sessionId = req.query.sessionId || currentSession(req.user.school_id)?.id;
  const where = ["s.school_id = ?", "s.status = 'active'"];
  const params = [req.user.school_id];
  if (q) { where.push('(s.full_name LIKE ? OR s.admission_no LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (req.query.classId && req.query.classId !== 'all') { where.push('s.class_id = ?'); params.push(req.query.classId); }
  if (req.query.sectionId && req.query.sectionId !== 'all') { where.push('s.section_id = ?'); params.push(req.query.sectionId); }
  if (req.query.status === 'due') where.push('COALESCE(sf.due_amount,0) > 0');
  if (req.query.status === 'paid') where.push('COALESCE(sf.due_amount,0) = 0');
  if (req.query.status === 'unassigned') where.push('sf.id IS NULL');

  const total = db.prepare(
    `SELECT COUNT(*) c FROM students s LEFT JOIN student_fees sf ON sf.student_id = s.id AND sf.session_id = ?
     WHERE ${where.join(' AND ')}`,
  ).get(sessionId, ...params).c;
  const items = db.prepare(
    `SELECT s.id, s.full_name, s.admission_no, s.roll_no, c.name AS class_name, sec.name AS section_name, s.photo_url,
       sf.id AS ledger_id, sf.gross_amount, sf.discount_amount, sf.net_amount, sf.paid_amount, sf.due_amount, sf.status AS fee_status,
       sf.fee_structure_id
     FROM students s
     LEFT JOIN student_fees sf ON sf.student_id = s.id AND sf.session_id = ?
     LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id
     WHERE ${where.join(' AND ')} ORDER BY c.order_index, s.full_name LIMIT ? OFFSET ?`,
  ).all(sessionId, ...params, limit, offset);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1, sessionId });
}));

router.post('/assign', requirePermission('fees.structure'), validateBody(z.object({
  studentIds: z.array(z.string()).min(1).max(2000),
  structureId: z.string().min(1),
  sessionId: z.string().optional(),
})), asyncHandler(async (req, res) => {
  const sessionId = req.data.sessionId || currentSession(req.user.school_id)?.id;
  const structure = db.prepare('SELECT * FROM fee_structures WHERE id = ? AND school_id = ?').get(req.data.structureId, req.user.school_id);
  if (!structure) throw notFound('Fee structure not found');
  let assigned = 0;
  const run = db.transaction(() => {
    for (const studentId of req.data.studentIds) {
      const student = db.prepare('SELECT id FROM students WHERE id = ? AND school_id = ?').get(studentId, req.user.school_id);
      if (!student) continue;
      syncStudentFeeRow(studentId, sessionId, structure.id);
      assigned += 1;
    }
  });
  run();
  audit(req, { action: 'assign', module: 'fees', entityType: 'fee_structure', entityId: structure.id, summary: `Assigned fee structure to ${assigned} students` });
  res.json({ assigned });
}));

router.get('/students/:id', requirePermission('fees.view'), asyncHandler(async (req, res) => {
  const student = db.prepare(
    `SELECT s.*, c.name AS class_name, sec.name AS section_name FROM students s
     LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id
     WHERE s.id = ? AND s.school_id = ?`,
  ).get(req.params.id, req.user.school_id);
  if (!student) throw notFound('Student not found');
  const ledger = db.prepare('SELECT * FROM student_fees WHERE student_id = ? ORDER BY created_at DESC').all(student.id);
  const invoices = db.prepare('SELECT * FROM invoices WHERE student_id = ? ORDER BY issue_date DESC').all(student.id);
  const payments = db.prepare('SELECT * FROM payments WHERE student_id = ? ORDER BY COALESCE(paid_at, created_at) DESC').all(student.id);
  const discounts = db.prepare('SELECT * FROM student_discounts WHERE student_id = ?').all(student.id);
  res.json({ student, ledger, invoices, payments, discounts, position: studentFeePosition(student.id) });
}));

/* -------------------------------- discounts ------------------------------- */

router.post('/discounts', requirePermission('fees.discount'), validateBody(z.object({
  student_id: z.string().min(1),
  kind: z.enum(['discount', 'scholarship', 'concession', 'waiver']).default('discount'),
  name: z.string().min(2).max(80),
  calc_type: z.enum(['fixed', 'percent']).default('fixed'),
  value: z.coerce.number().min(0).max(100_000),
  reason: z.string().max(300).optional().default(''),
  sessionId: z.string().optional(),
})), asyncHandler(async (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').get(req.data.student_id, req.user.school_id);
  if (!student) throw notFound('Student not found');
  if (req.data.calc_type === 'percent' && req.data.value > 100) throw badRequest('Percentage cannot exceed 100');
  const sessionId = req.data.sessionId || currentSession(req.user.school_id)?.id;
  const id = newId('dis');
  db.prepare(
    `INSERT INTO student_discounts (id, school_id, student_id, session_id, kind, name, calc_type, value, amount, reason, approved_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, req.user.school_id, student.id, sessionId, req.data.kind, req.data.name, req.data.calc_type,
    req.data.value, 0, req.data.reason, req.user.id, nowIso());
  syncStudentFeeRow(student.id, sessionId);
  audit(req, {
    action: 'create', module: 'fees', entityType: 'discount', entityId: id,
    summary: `${req.data.kind} "${req.data.name}" applied to ${student.full_name}`,
    meta: { calc_type: req.data.calc_type, value: req.data.value },
  });
  res.status(201).json({ id });
}));

router.delete('/discounts/:id', requirePermission('fees.discount'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM student_discounts WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Discount not found');
  db.prepare('DELETE FROM student_discounts WHERE id = ?').run(row.id);
  if (row.session_id) syncStudentFeeRow(row.student_id, row.session_id);
  audit(req, { action: 'delete', module: 'fees', entityType: 'discount', entityId: row.id, summary: `Removed ${row.kind} ${row.name}` });
  res.json({ ok: true });
}));

/* --------------------------------- invoices ------------------------------- */

router.get('/invoices', requirePermission('fees.view'), asyncHandler(async (req, res) => {
  const { limit, offset, page } = pagination(req);
  const q = searchTerm(req);
  const { clause } = sorting(req, ['issue_date', 'due_date', 'total', 'balance', 'invoice_no'], 'issue_date');
  const where = ['i.school_id = ?'];
  const params = [req.user.school_id];
  if (q) { where.push('(i.invoice_no LIKE ? OR s.full_name LIKE ? OR s.admission_no LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (req.query.status && req.query.status !== 'all') { where.push('i.status = ?'); params.push(req.query.status); }
  if (req.query.classId && req.query.classId !== 'all') { where.push('s.class_id = ?'); params.push(req.query.classId); }
  if (req.query.studentId) { where.push('i.student_id = ?'); params.push(req.query.studentId); }
  if (req.query.from) { where.push('i.issue_date >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('i.issue_date <= ?'); params.push(req.query.to); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const total = db.prepare(`SELECT COUNT(*) c FROM invoices i JOIN students s ON s.id = i.student_id ${whereSql}`).get(...params).c;
  const items = db.prepare(
    `SELECT i.*, s.full_name, s.admission_no, c.name AS class_name, sec.name AS section_name
     FROM invoices i JOIN students s ON s.id = i.student_id
     LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id
     ${whereSql} ORDER BY i.${clause} LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);
  const totals = db.prepare(
    `SELECT COALESCE(SUM(i.total),0) billed, COALESCE(SUM(i.amount_paid),0) paid, COALESCE(SUM(i.balance),0) balance
     FROM invoices i JOIN students s ON s.id = i.student_id ${whereSql}`,
  ).get(...params);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1, totals });
}));

router.get('/invoices/:id', requirePermission('fees.view'), asyncHandler(async (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!invoice) throw notFound('Invoice not found');
  const student = db.prepare(
    `SELECT s.*, c.name AS class_name, sec.name AS section_name FROM students s
     LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id WHERE s.id = ?`,
  ).get(invoice.student_id);
  res.json({
    invoice,
    student,
    items: db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(invoice.id),
    payments: db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY COALESCE(paid_at, created_at) DESC').all(invoice.id),
    refunds: db.prepare('SELECT * FROM refunds WHERE payment_id IN (SELECT id FROM payments WHERE invoice_id = ?)').all(invoice.id),
  });
}));

const invoiceSchema = z.object({
  student_id: z.string().min(1),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period: z.string().max(30).optional().default(''),
  discount: z.coerce.number().min(0).optional().default(0),
  notes: z.string().max(500).optional().default(''),
  items: z.array(z.object({
    fee_head_id: z.string().nullish(),
    description: z.string().min(1).max(120),
    amount: z.coerce.number().min(0),
    quantity: z.coerce.number().min(0.1).max(100).optional().default(1),
  })).min(1).max(30),
});

function writeInvoice(data, schoolId, userId) {
  const student = db.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').get(data.student_id, schoolId);
  if (!student) throw notFound('Student not found');
  const sessionId = currentSession(schoolId)?.id;
  const subtotal = round(data.items.reduce((s, i) => s + Number(i.amount) * Number(i.quantity || 1), 0));
  const discount = round(data.discount || 0);
  const total = round(Math.max(0, subtotal - discount));
  const id = newId('inv');
  const invoiceNo = nextInvoiceNo(schoolId);
  const at = nowIso();
  db.prepare(
    `INSERT INTO invoices (id, school_id, session_id, student_id, invoice_no, issue_date, due_date, period, subtotal,
      discount, late_fee, total, amount_paid, balance, status, notes, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, schoolId, sessionId, student.id, invoiceNo, data.issue_date || at.slice(0, 10), data.due_date,
    data.period || null, subtotal, discount, 0, total, 0, total, 'unpaid', data.notes || null, userId, at, at);
  data.items.forEach((item) => {
    db.prepare('INSERT INTO invoice_items (id, school_id, invoice_id, fee_head_id, description, amount, quantity) VALUES (?,?,?,?,?,?,?)')
      .run(newId('ivi'), schoolId, id, item.fee_head_id || null, item.description, item.amount, item.quantity || 1);
  });
  return { id, invoiceNo, student, total };
}

router.post('/invoices', requirePermission('fees.invoice_create'), validateBody(invoiceSchema), asyncHandler(async (req, res) => {
  const result = db.transaction(() => writeInvoice(req.data, req.user.school_id, req.user.id))();
  syncStudentFees(result.student.id, currentSession(req.user.school_id)?.id);
  audit(req, {
    action: 'create', module: 'fees', entityType: 'invoice', entityId: result.id,
    summary: `Invoice ${result.invoiceNo} created for ${result.student.full_name} (${fmtMoney(result.total)})`,
  });

  const parents = db.prepare('SELECT parent_user_id FROM parent_students WHERE student_id = ?').all(result.student.id);
  notifyUsers(req.user.school_id, parents.map((p) => p.parent_user_id), {
    title: 'New fee invoice',
    body: `Invoice ${result.invoiceNo} of ${fmtMoney(result.total)} is due on ${req.data.due_date}.`,
    type: 'info', link: '/portal/fees',
  });
  res.status(201).json({ id: result.id, invoice_no: result.invoiceNo, total: result.total });
}));

router.post('/invoices/generate', requirePermission('fees.invoice_create'), validateBody(z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM'),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  classIds: z.array(z.string()).optional().default([]),
  sectionIds: z.array(z.string()).optional().default([]),
  includeMonthlyOnly: z.boolean().optional().default(true),
})), asyncHandler(async (req, res) => {
  const schoolId = req.user.school_id;
  const monthIndex = Number(req.data.period.slice(5, 7));
  const year = req.data.period.slice(0, 4);
  const where = ["s.school_id = ?", "s.status = 'active'", 'sf.id IS NOT NULL'];
  const params = [schoolId];
  if (req.data.classIds.length) { where.push(`s.class_id IN (${req.data.classIds.map(() => '?').join(',')})`); params.push(...req.data.classIds); }
  if (req.data.sectionIds.length) { where.push(`s.section_id IN (${req.data.sectionIds.map(() => '?').join(',')})`); params.push(...req.data.sectionIds); }

  const students = db.prepare(
    `SELECT s.id, s.full_name, sf.fee_structure_id, sf.net_amount FROM students s
     JOIN student_fees sf ON sf.student_id = s.id WHERE ${where.join(' AND ')}`,
  ).all(...params);

  let created = 0;
  let skipped = 0;
  const run = db.transaction(() => {
    for (const student of students) {
      const existing = db.prepare('SELECT id FROM invoices WHERE student_id = ? AND period = ?').get(student.id, req.data.period);
      if (existing) { skipped += 1; continue; }
      const structureItems = db.prepare('SELECT i.*, fh.name AS head_name FROM fee_structure_items i JOIN fee_heads fh ON fh.id = i.fee_head_id WHERE i.fee_structure_id = ?').all(student.fee_structure_id);
      const monthly = structureItems.filter((i) => i.frequency === 'monthly');
      const selected = req.data.includeMonthlyOnly && monthly.length ? monthly : structureItems.filter((i) => i.frequency !== 'monthly');
      if (!selected.length) { skipped += 1; continue; }
      // Annual charges are billed once (April); quarterly in quarter-start months.
      const items = selected.filter((i) => {
        if (i.frequency === 'quarterly') return [4, 7, 10, 1].includes(monthIndex);
        if (i.frequency === 'annual' || i.frequency === 'one_time') return monthIndex === 4;
        return true;
      }).map((i) => ({
        fee_head_id: i.fee_head_id,
        description: `${i.head_name}${i.frequency === 'monthly' ? ` — ${req.data.period}` : ''}`,
        amount: i.amount,
        quantity: 1,
      }));
      if (!items.length) { skipped += 1; continue; }
      writeInvoice({
        student_id: student.id, due_date: req.data.due_date, period: req.data.period,
        items, discount: 0, notes: `Auto-generated for ${req.data.period}`,
      }, schoolId, req.user.id);
      created += 1;
    }
  });
  run();
  audit(req, { action: 'generate', module: 'fees', summary: `Generated ${created} invoices for ${req.data.period}`, meta: { skipped } });
  res.json({ created, skipped, students: students.length });
}));

router.post('/invoices/:id/cancel', requirePermission('fees.invoice_delete'), validateBody(z.object({
  reason: z.string().min(3).max(300),
})), asyncHandler(async (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!invoice) throw notFound('Invoice not found');
  if (Number(invoice.amount_paid) > 0) throw conflict('Invoices with payments cannot be cancelled. Issue a refund first.');
  db.prepare("UPDATE invoices SET status = 'cancelled', balance = 0, notes = ?, updated_at = ? WHERE id = ?")
    .run(`${invoice.notes || ''}\nCancelled: ${req.data.reason}`.trim(), nowIso(), invoice.id);
  syncStudentFees(invoice.student_id, invoice.session_id);
  audit(req, {
    action: 'cancel', module: 'fees', entityType: 'invoice', entityId: invoice.id,
    summary: `Cancelled invoice ${invoice.invoice_no}`, meta: { reason: req.data.reason },
  });
  res.json({ ok: true });
}));

router.post('/invoices/:id/late-fee', requirePermission('fees.invoice_edit'), validateBody(z.object({
  amount: z.coerce.number().min(0),
  reason: z.string().max(200).optional().default('Late payment penalty'),
})), asyncHandler(async (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!invoice) throw notFound('Invoice not found');
  if (['paid', 'cancelled'].includes(invoice.status)) throw conflict('Cannot add a late fee to a paid or cancelled invoice');
  const lateFee = round(req.data.amount);
  const total = round(Number(invoice.total) + lateFee);
  db.prepare('UPDATE invoices SET late_fee = ?, total = ?, balance = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(round(Number(invoice.late_fee) + lateFee), total, round(total - Number(invoice.amount_paid)), 'overdue', nowIso(), invoice.id);
  audit(req, {
    action: 'late_fee', module: 'fees', entityType: 'invoice', entityId: invoice.id,
    summary: `Added late fee ${fmtMoney(lateFee)} to ${invoice.invoice_no}`, meta: { reason: req.data.reason },
  });
  res.json({ ok: true, total });
}));

router.post('/invoices/late-fees/run', requirePermission('fees.invoice_edit'), asyncHandler(async (req, res) => {
  const result = applyLateFees(req.user.school_id);
  audit(req, { action: 'late_fee_run', module: 'fees', summary: `Applied late fees to ${result.updated} invoices` });
  res.json(result);
}));

router.get('/invoices/:id/pdf', requirePermission('fees.view'), asyncHandler(async (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!invoice) throw notFound('Invoice not found');
  const student = db.prepare(
    `SELECT s.*, c.name AS class_name, sec.name AS section_name FROM students s
     LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id WHERE s.id = ?`,
  ).get(invoice.student_id);
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(invoice.id);
  const payments = db.prepare("SELECT * FROM payments WHERE invoice_id = ? AND status IN ('success','partially_refunded')").all(invoice.id);
  streamPdf(res, invoicePdf({ school: req.user.school, student, invoice, items, payments }), `invoice-${invoice.invoice_no}.pdf`);
}));

/* --------------------------------- payments ------------------------------- */

router.get('/payments', requirePermission('fees.view'), asyncHandler(async (req, res) => {
  const { limit, offset, page } = pagination(req);
  const q = searchTerm(req);
  const where = ['p.school_id = ?'];
  const params = [req.user.school_id];
  if (q) { where.push('(p.receipt_no LIKE ? OR p.txn_ref LIKE ? OR s.full_name LIKE ? OR p.gateway_payment_id LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  if (req.query.status && req.query.status !== 'all') { where.push('p.status = ?'); params.push(req.query.status); }
  if (req.query.method && req.query.method !== 'all') { where.push('p.method = ?'); params.push(req.query.method); }
  if (req.query.from) { where.push('date(COALESCE(p.paid_at, p.created_at)) >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('date(COALESCE(p.paid_at, p.created_at)) <= ?'); params.push(req.query.to); }
  if (req.query.classId && req.query.classId !== 'all') { where.push('s.class_id = ?'); params.push(req.query.classId); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const total = db.prepare(`SELECT COUNT(*) c FROM payments p LEFT JOIN students s ON s.id = p.student_id ${whereSql}`).get(...params).c;
  const items = db.prepare(
    `SELECT p.*, s.full_name, s.admission_no, c.name AS class_name, i.invoice_no, u.full_name AS recorded_by_name
     FROM payments p LEFT JOIN students s ON s.id = p.student_id
     LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN invoices i ON i.id = p.invoice_id
     LEFT JOIN users u ON u.id = p.recorded_by
     ${whereSql} ORDER BY COALESCE(p.paid_at, p.created_at) DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);
  const totals = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN p.status IN ('success','partially_refunded') THEN p.amount ELSE 0 END),0) collected,
            COALESCE(SUM(CASE WHEN p.status = 'pending' THEN p.amount ELSE 0 END),0) pending,
            COALESCE(SUM(CASE WHEN p.status = 'failed' THEN p.amount ELSE 0 END),0) failed
     FROM payments p LEFT JOIN students s ON s.id = p.student_id ${whereSql}`,
  ).get(...params);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1, totals });
}));

router.get('/payments/export', requirePermission('fees.export'), asyncHandler(async (req, res) => {
  const rows = db.prepare(
    `SELECT p.*, s.full_name, s.admission_no, c.name AS class_name, i.invoice_no
     FROM payments p LEFT JOIN students s ON s.id = p.student_id
     LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN invoices i ON i.id = p.invoice_id
     WHERE p.school_id = ? ORDER BY COALESCE(p.paid_at, p.created_at) DESC LIMIT 10000`,
  ).all(req.user.school_id);
  const columns = [
    { label: 'Receipt No', key: 'receipt_no' },
    { label: 'Date', value: (r) => (r.paid_at || r.created_at || '').slice(0, 10) },
    { label: 'Student', key: 'full_name' },
    { label: 'Admission No', key: 'admission_no' },
    { label: 'Class', key: 'class_name' },
    { label: 'Invoice', key: 'invoice_no' },
    { label: 'Amount', key: 'amount' },
    { label: 'Method', key: 'method' },
    { label: 'Status', key: 'status' },
    { label: 'Transaction Ref', key: 'txn_ref' },
    { label: 'Gateway Payment Id', key: 'gateway_payment_id' },
  ];
  audit(req, { action: 'export', module: 'fees', summary: `Exported ${rows.length} payments` });
  await sendTable(req, res, { filename: 'payments', title: 'Payment Collection Register', columns, rows });
}));

const collectSchema = z.object({
  invoice_id: z.string().nullish(),
  student_id: z.string().nullish(),
  amount: z.coerce.number().positive(),
  method: z.enum(['cash', 'upi', 'card', 'netbanking', 'cheque', 'bank_transfer', 'dd', 'other']),
  txn_ref: z.string().max(80).optional().default(''),
  notes: z.string().max(300).optional().default(''),
  paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.post('/payments', requirePermission('fees.collect'), validateBody(collectSchema), asyncHandler(async (req, res) => {
  const schoolId = req.user.school_id;
  if (!req.data.invoice_id && !req.data.student_id) throw badRequest('Select an invoice or student');
  const invoice = req.data.invoice_id
    ? db.prepare('SELECT * FROM invoices WHERE id = ? AND school_id = ?').get(req.data.invoice_id, schoolId)
    : null;
  if (req.data.invoice_id && !invoice) throw notFound('Invoice not found');
  if (invoice?.status === 'cancelled') throw badRequest('This invoice is cancelled');
  if (invoice && invoice.status === 'paid') throw conflict('This invoice is already fully paid');

  const allowPartial = getSetting(schoolId, 'fees', 'partialPaymentsAllowed', true);
  if (invoice && !allowPartial && round(req.data.amount) < round(invoice.balance)) {
    throw badRequest('Partial payments are disabled. Collect the full balance.');
  }
  if (invoice && round(req.data.amount) > round(invoice.balance) + 0.01) {
    throw badRequest(`Amount exceeds the outstanding balance of ${fmtMoney(invoice.balance)}`);
  }
  const studentId = invoice?.student_id || req.data.student_id;
  const student = db.prepare('SELECT * FROM students WHERE id = ? AND school_id = ?').get(studentId, schoolId);
  if (!student) throw notFound('Student not found');

  const id = newId('pmy');
  const receiptNo = nextReceiptNo(schoolId);
  const at = nowIso();
  db.prepare(
    `INSERT INTO payments (id, school_id, invoice_id, student_id, amount, currency, method, status, txn_ref, receipt_no,
      paid_at, recorded_by, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, schoolId, invoice?.id || null, student.id, round(req.data.amount), 'INR', req.data.method, 'success',
    req.data.txn_ref || null, receiptNo, req.data.paid_at ? `${req.data.paid_at}T00:00:00.000Z` : at,
    req.user.id, req.data.notes || null, at, at);

  if (invoice) recomputeInvoice(invoice.id);
  else {
    const ledger = db.prepare('SELECT * FROM student_fees WHERE student_id = ? ORDER BY created_at DESC LIMIT 1').get(student.id);
    if (ledger) {
      const paid = round(Number(ledger.paid_amount) + Number(req.data.amount));
      const due = round(Math.max(0, Number(ledger.net_amount) - paid));
      db.prepare('UPDATE student_fees SET paid_amount = ?, due_amount = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(paid, due, due <= 0 ? 'paid' : 'partial', at, ledger.id);
    }
  }

  const parents = db.prepare('SELECT parent_user_id FROM parent_students WHERE student_id = ?').all(student.id);
  notifyUsers(schoolId, parents.map((p) => p.parent_user_id), {
    title: 'Payment received',
    body: `${fmtMoney(req.data.amount)} received for ${student.full_name}. Receipt ${receiptNo}.`,
    type: 'success', link: '/portal/fees',
  });

  audit(req, {
    action: 'collect', module: 'fees', entityType: 'payment', entityId: id,
    summary: `Collected ${fmtMoney(req.data.amount)} (${req.data.method}) from ${student.full_name} • receipt ${receiptNo}`,
    meta: { invoiceId: invoice?.id || null },
  });
  res.status(201).json({ id, receipt_no: receiptNo, amount: round(req.data.amount) });
}));

router.get('/payments/:id/receipt', requirePermission('fees.view'), asyncHandler(async (req, res) => {
  const payment = db.prepare('SELECT * FROM payments WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!payment) throw notFound('Payment not found');
  const student = db.prepare(
    `SELECT s.*, c.name AS class_name, sec.name AS section_name FROM students s
     LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id WHERE s.id = ?`,
  ).get(payment.student_id);
  const invoice = payment.invoice_id ? db.prepare('SELECT * FROM invoices WHERE id = ?').get(payment.invoice_id) : null;
  streamPdf(res, receiptPdf({ school: req.user.school, student, payment, invoice }), `receipt-${payment.receipt_no || payment.id}.pdf`);
}));

router.post('/payments/:id/refund', requirePermission('fees.refund'), validateBody(z.object({
  amount: z.coerce.number().positive(),
  reason: z.string().min(3).max(300),
})), asyncHandler(async (req, res) => {
  const payment = db.prepare('SELECT * FROM payments WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!payment) throw notFound('Payment not found');
  if (!['success', 'partially_refunded'].includes(payment.status)) throw badRequest('Only successful payments can be refunded');
  const already = db.prepare('SELECT COALESCE(SUM(amount),0) v FROM refunds WHERE payment_id = ?').get(payment.id).v;
  const refundable = round(Number(payment.amount) - Number(already));
  const amount = round(req.data.amount);
  if (amount > refundable + 0.001) throw badRequest(`Refundable amount is ${fmtMoney(refundable)}`);

  const id = newId('ref');
  const run = db.transaction(() => {
    db.prepare('INSERT INTO refunds (id, school_id, payment_id, student_id, amount, reason, status, processed_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, req.user.school_id, payment.id, payment.student_id, amount, req.data.reason, 'processed', req.user.id, nowIso());
    const newStatus = round(Number(already) + amount) >= round(Number(payment.amount)) ? 'refunded' : 'partially_refunded';
    db.prepare('UPDATE payments SET status = ?, updated_at = ? WHERE id = ?').run(newStatus, nowIso(), payment.id);
    if (payment.invoice_id) recomputeInvoice(payment.invoice_id);
  });
  run();
  audit(req, {
    action: 'refund', module: 'fees', entityType: 'payment', entityId: payment.id,
    summary: `Refunded ${fmtMoney(amount)} — ${req.data.reason}`, meta: { refundId: id },
  });
  res.status(201).json({ id, refundable: round(refundable - amount) });
}));

/* ------------------------------ online gateway ---------------------------- */

router.post('/gateway/order', requirePermission('fees.view'), validateBody(z.object({
  invoice_id: z.string().min(1),
  amount: z.coerce.number().positive().optional(),
})), asyncHandler(async (req, res) => {
  if (!isGatewayReady(req.user.school_id)) {
    throw badRequest('Online payments are not configured. Add Razorpay keys in Settings → Integrations.');
  }
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND school_id = ?').get(req.data.invoice_id, req.user.school_id);
  if (!invoice) throw notFound('Invoice not found');
  const amount = round(req.data.amount || invoice.balance);
  if (amount > Number(invoice.balance) + 0.01) throw badRequest('Amount exceeds the outstanding balance');

  const id = newId('pmy');
  const receipt = `rcpt_${id.slice(-10)}`;
  const order = await createRazorpayOrder(req.user.school_id, {
    amount, receipt, notes: { invoice_id: invoice.id, student_id: invoice.student_id },
  });

  db.prepare(
    `INSERT INTO payments (id, school_id, invoice_id, student_id, amount, currency, method, status, gateway,
      gateway_order_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, req.user.school_id, invoice.id, invoice.student_id, amount, 'INR', 'card', 'pending', 'razorpay',
    order.id, nowIso(), nowIso());

  res.json({
    paymentId: id,
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: paymentConfig(req.user.school_id).keyId,
    invoice: { id: invoice.id, invoice_no: invoice.invoice_no, balance: invoice.balance },
  });
}));

router.post('/gateway/verify', requirePermission('fees.view'), validateBody(z.object({
  paymentId: z.string().min(1),
  razorpay_payment_id: z.string().min(3),
  razorpay_order_id: z.string().min(3),
  razorpay_signature: z.string().min(10),
})), asyncHandler(async (req, res) => {
  const local = db.prepare('SELECT * FROM payments WHERE id = ? AND school_id = ?').get(req.data.paymentId, req.user.school_id);
  if (!local) throw notFound('Payment attempt not found');
  if (local.gateway_order_id !== req.data.razorpay_order_id) throw badRequest('Order mismatch');

  const valid = verifyCheckoutSignature(req.user.school_id, {
    orderId: req.data.razorpay_order_id, paymentId: req.data.razorpay_payment_id, signature: req.data.razorpay_signature,
  });
  if (!valid) {
    db.prepare("UPDATE payments SET status = 'failed', failure_reason = 'signature_mismatch', updated_at = ? WHERE id = ?")
      .run(nowIso(), local.id);
    audit(req, { action: 'payment_failed', module: 'fees', entityType: 'payment', entityId: local.id, summary: 'Gateway signature verification failed' });
    throw badRequest('Payment signature verification failed. You have not been charged by this system.');
  }

  // Confirm the payment with the gateway API before crediting the account.
  const remote = await fetchRazorpayPayment(req.user.school_id, req.data.razorpay_payment_id);
  const remoteAmount = round(Number(remote.amount) / 100);
  if (remote.order_id !== local.gateway_order_id) throw badRequest('Gateway order mismatch');
  if (remoteAmount !== round(Number(local.amount))) throw badRequest('Amount mismatch with gateway');
  if (!['captured', 'authorized'].includes(remote.status)) {
    db.prepare("UPDATE payments SET status = 'failed', failure_reason = ?, updated_at = ? WHERE id = ?")
      .run(`gateway_status_${remote.status}`, nowIso(), local.id);
    throw badRequest(`Payment is ${remote.status}, not captured`);
  }

  const result = applySuccessfulPayment({
    paymentId: local.id, gatewayPaymentId: req.data.razorpay_payment_id, rawPayload: remote, source: 'checkout_verify',
  });
  res.json({ ok: true, receipt_no: result.receiptNo, payment: result.payment });
}));

/* --------------------------------- expenses ------------------------------- */

router.get('/expenses', requirePermission('fees.expense', 'fees.view'), asyncHandler(async (req, res) => {
  const { limit, offset, page } = pagination(req);
  const where = ['e.school_id = ?'];
  const params = [req.user.school_id];
  if (req.query.category && req.query.category !== 'all') { where.push('e.category = ?'); params.push(req.query.category); }
  if (req.query.from) { where.push('e.expense_date >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('e.expense_date <= ?'); params.push(req.query.to); }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) amount FROM expenses e ${whereSql}`).get(...params);
  const items = db.prepare(
    `SELECT e.*, u.full_name AS recorded_by_name FROM expenses e LEFT JOIN users u ON u.id = e.recorded_by
     ${whereSql} ORDER BY e.expense_date DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);
  const byCategory = db.prepare(
    `SELECT category, COALESCE(SUM(amount),0) total FROM expenses e ${whereSql} GROUP BY category ORDER BY total DESC`,
  ).all(...params);
  res.json({ items, total: total.c, amount: total.amount, page, limit, pages: Math.ceil(total.c / limit) || 1, byCategory });
}));

router.post('/expenses', requirePermission('fees.expense'), validateBody(z.object({
  category: z.string().min(2).max(60),
  description: z.string().max(300).optional().default(''),
  amount: z.coerce.number().positive(),
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paid_to: z.string().max(120).optional().default(''),
  method: z.string().max(30).optional().default('cash'),
  voucher_no: z.string().max(40).optional().default(''),
  attachment_url: z.string().max(300).nullish(),
})), asyncHandler(async (req, res) => {
  const id = newId('exp');
  db.prepare(
    `INSERT INTO expenses (id, school_id, session_id, category, description, amount, expense_date, paid_to, method,
      voucher_no, attachment_url, recorded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, req.user.school_id, currentSession(req.user.school_id)?.id, req.data.category, req.data.description,
    round(req.data.amount), req.data.expense_date, req.data.paid_to, req.data.method, req.data.voucher_no,
    req.data.attachment_url || null, req.user.id, nowIso());
  audit(req, {
    action: 'create', module: 'fees', entityType: 'expense', entityId: id,
    summary: `Recorded expense ${fmtMoney(req.data.amount)} — ${req.data.category}`,
  });
  res.status(201).json({ id });
}));

router.delete('/expenses/:id', requirePermission('fees.expense'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM expenses WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Expense not found');
  db.prepare('DELETE FROM expenses WHERE id = ?').run(row.id);
  audit(req, { action: 'delete', module: 'fees', entityType: 'expense', entityId: row.id, summary: `Deleted expense ${fmtMoney(row.amount)}` });
  res.json({ ok: true });
}));

router.get('/refunds', requirePermission('fees.refund', 'fees.view'), asyncHandler(async (req, res) => {
  const items = db.prepare(
    `SELECT r.*, s.full_name, p.receipt_no, u.full_name AS processed_by_name
     FROM refunds r LEFT JOIN students s ON s.id = r.student_id
     LEFT JOIN payments p ON p.id = r.payment_id LEFT JOIN users u ON u.id = r.processed_by
     WHERE r.school_id = ? ORDER BY r.created_at DESC LIMIT 200`,
  ).all(req.user.school_id);
  res.json({ items });
}));

router.get('/defaulters', requirePermission('fees.view', 'reports.finance'), asyncHandler(async (req, res) => {
  const sessionId = req.query.sessionId || currentSession(req.user.school_id)?.id;
  const rows = db.prepare(
    `SELECT s.id, s.full_name, s.admission_no, s.phone, c.name AS class_name, sec.name AS section_name,
       sf.net_amount, sf.paid_amount, sf.due_amount,
       (SELECT MIN(due_date) FROM invoices i WHERE i.student_id = s.id AND i.balance > 0) AS oldest_due
     FROM student_fees sf JOIN students s ON s.id = sf.student_id
     LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id
     WHERE sf.school_id = ? AND sf.session_id = ? AND sf.due_amount > 0
     ORDER BY sf.due_amount DESC LIMIT 1000`,
  ).all(req.user.school_id, sessionId);
  if (String(req.query.format || '') === 'pdf') {
    const doc = tableReportPdf({
      school: req.user.school, title: 'Fee Defaulters', subtitle: `Outstanding as on ${new Date().toLocaleDateString('en-GB')}`,
      columns: [
        { label: 'Admission No', key: 'admission_no', pdfWidth: 80 },
        { label: 'Student', key: 'full_name', pdfWidth: 150 },
        { label: 'Class', value: (r) => `${r.class_name || ''} ${r.section_name || ''}`, pdfWidth: 70 },
        { label: 'Net fee', value: (r) => fmtMoney(r.net_amount), pdfWidth: 80 },
        { label: 'Paid', value: (r) => fmtMoney(r.paid_amount), pdfWidth: 80 },
        { label: 'Due', value: (r) => fmtMoney(r.due_amount), pdfWidth: 80 },
        { label: 'Phone', key: 'phone', pdfWidth: 80 },
      ],
      rows,
    });
    return streamPdf(res, doc, 'fee-defaulters.pdf');
  }
  await sendTable(req, res, {
    filename: 'fee-defaulters', title: 'Fee Defaulters',
    columns: [
      { label: 'Admission No', key: 'admission_no' },
      { label: 'Student', key: 'full_name' },
      { label: 'Class', key: 'class_name' },
      { label: 'Section', key: 'section_name' },
      { label: 'Net Fee', key: 'net_amount' },
      { label: 'Paid', key: 'paid_amount' },
      { label: 'Due', key: 'due_amount' },
      { label: 'Phone', key: 'phone' },
    ],
    rows,
  });
}));

router.get('/config', requirePermission('fees.gateway', 'fees.view'), asyncHandler(async (req, res) => {
  res.json({
    settings: {
      fees: db.prepare("SELECT key, value FROM settings WHERE school_id = ? AND category = 'fees'").all(req.user.school_id)
        .reduce((acc, r) => ({ ...acc, [r.key]: safeParse(r.value) }), {}),
    },
    gateway: { ready: isGatewayReady(req.user.school_id), ...paymentConfig(req.user.school_id) },
    canManageGateway: can(req.user, 'fees.gateway'),
  });
}));

function safeParse(value) {
  try { return JSON.parse(value); } catch { return value; }
}

export default router;
