import { db, nowIso, newId, getSetting } from '../db/index.js';
import { notifyUsers } from './audit.js';

export const money = (n) => Math.round(Number(n || 0) * 100) / 100;

export function nextReceiptNo(schoolId) {
  const prefix = getSetting(schoolId, 'fees', 'receiptPrefix', 'RCP');
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const startAt = prefix.length + 7; // skip "PREFIX-YYYY-"
  const row = db.prepare(
    `SELECT MAX(CAST(substr(receipt_no, ?) AS INTEGER)) AS n FROM payments
     WHERE school_id = ? AND receipt_no LIKE ?`,
  ).get(startAt, schoolId, like);
  const last = Number(row?.n) || 0;
  return `${prefix}-${year}-${String(last + 1).padStart(5, '0')}`;
}

export function nextInvoiceNo(schoolId) {
  const prefix = getSetting(schoolId, 'fees', 'invoicePrefix', 'INV');
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const startAt = prefix.length + 7; // skip "PREFIX-YYYY-"
  const row = db.prepare(
    `SELECT MAX(CAST(substr(invoice_no, ?) AS INTEGER)) AS n FROM invoices
     WHERE school_id = ? AND invoice_no LIKE ?`,
  ).get(startAt, schoolId, like);
  const last = Number(row?.n) || 0;
  return `${prefix}-${year}-${String(last + 1).padStart(5, '0')}`;
}

export function recomputeInvoice(invoiceId) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice) return null;
  const paid = db.prepare(
    "SELECT COALESCE(SUM(amount),0) total FROM payments WHERE invoice_id = ? AND status IN ('success','partially_refunded')",
  ).get(invoiceId).total;
  const balance = money(invoice.total - paid);
  let status = invoice.status;
  if (invoice.status !== 'cancelled') {
    if (balance <= 0.009) status = 'paid';
    else if (paid > 0) status = 'partial';
    else status = new Date(invoice.due_date) < new Date(new Date().toISOString().slice(0, 10)) ? 'overdue' : 'unpaid';
  }
  db.prepare('UPDATE invoices SET amount_paid = ?, balance = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(money(paid), balance < 0 ? 0 : balance, status, nowIso(), invoiceId);
  syncStudentFees(invoice.student_id, invoice.session_id);
  return { paid: money(paid), balance, status };
}

export function syncStudentFees(studentId, sessionId) {
  const agg = db.prepare(
    `SELECT COALESCE(SUM(total),0) billed, COALESCE(SUM(amount_paid),0) paid
     FROM invoices WHERE student_id = ? AND school_id = ? AND (? IS NULL OR session_id = ?) AND status != 'cancelled'`,
  ).get(studentId, db.prepare('SELECT school_id FROM students WHERE id = ?').get(studentId)?.school_id, sessionId, sessionId);
  const record = db.prepare('SELECT * FROM student_fees WHERE student_id = ? AND (? IS NULL OR session_id = ?)').get(studentId, sessionId, sessionId);
  if (!record) return;
  const net = money(record.net_amount || agg.billed);
  const paid = money(agg.paid);
  const due = money(Math.max(0, net - paid));
  db.prepare('UPDATE student_fees SET paid_amount = ?, due_amount = ?, status = ?, updated_at = ? WHERE id = ?').run(
    paid, due, due <= 0.009 ? 'paid' : paid > 0 ? 'partial' : 'pending', nowIso(), record.id,
  );
}

/**
 * Single source of truth for "money actually received".
 * Called from the server-side Razorpay verification endpoint and the webhook.
 * Idempotent: repeated calls never double-credit an invoice.
 */
export function applySuccessfulPayment({ paymentId, gatewayPaymentId, rawPayload = null, source = 'verify' }) {
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!payment) throw new Error('Payment record not found');
  if (payment.status === 'success') {
    return { alreadyProcessed: true, payment };
  }
  const invoice = payment.invoice_id ? db.prepare('SELECT * FROM invoices WHERE id = ?').get(payment.invoice_id) : null;
  const receiptNo = payment.receipt_no || nextReceiptNo(payment.school_id);
  const at = nowIso();

  const run = db.transaction(() => {
    db.prepare(
      `UPDATE payments SET status = 'success', gateway_payment_id = COALESCE(?, gateway_payment_id),
        receipt_no = ?, paid_at = ?, updated_at = ?, raw = COALESCE(?, raw), failure_reason = NULL WHERE id = ?`,
    ).run(gatewayPaymentId || null, receiptNo, at, at, rawPayload ? JSON.stringify(rawPayload).slice(0, 8000) : null, payment.id);

    if (invoice) recomputeInvoice(invoice.id);

    // Credit the student fee ledger too when no invoice is attached.
    if (!invoice && payment.student_id) {
      const record = db.prepare('SELECT * FROM student_fees WHERE student_id = ? ORDER BY created_at DESC LIMIT 1').get(payment.student_id);
      if (record) {
        const paid = money(record.paid_amount + payment.amount);
        const due = money(Math.max(0, record.net_amount - paid));
        db.prepare('UPDATE student_fees SET paid_amount = ?, due_amount = ?, status = ?, updated_at = ? WHERE id = ?')
          .run(paid, due, due <= 0.009 ? 'paid' : 'partial', at, record.id);
      }
    }
  });
  run();

  const student = payment.student_id ? db.prepare('SELECT full_name FROM students WHERE id = ?').get(payment.student_id) : null;
  const recipients = [];
  if (payment.student_id) {
    db.prepare('SELECT parent_user_id FROM parent_students WHERE student_id = ?').all(payment.student_id)
      .forEach((r) => recipients.push(r.parent_user_id));
    const studentUser = db.prepare('SELECT user_id FROM students WHERE id = ?').get(payment.student_id)?.user_id;
    if (studentUser) recipients.push(studentUser);
  }
  notifyUsers(payment.school_id, recipients, {
    title: 'Payment received',
    body: `${student?.full_name || 'Student'} — payment of ${payment.amount} recorded. Receipt ${receiptNo}.`,
    type: 'success',
    link: '/portal/fees',
  });

  db.prepare(
    'INSERT INTO audit_logs (id, school_id, user_id, actor_name, actor_role, action, module, entity_type, entity_id, summary, meta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(newId('aud'), payment.school_id, null, source, 'system', 'payment_success', 'fees', 'payment', payment.id,
    `Payment ${receiptNo} of ${payment.amount} verified (${source})`, JSON.stringify({ invoiceId: payment.invoice_id }), at);

  return { payment: db.prepare('SELECT * FROM payments WHERE id = ?').get(payment.id), receiptNo };
}

/** Late fee accrual for overdue invoices. */
export function applyLateFees(schoolId) {
  const fixed = Number(getSetting(schoolId, 'fees', 'lateFeeFixed', 0));
  const percent = Number(getSetting(schoolId, 'fees', 'lateFeePercent', 0));
  const grace = Number(getSetting(schoolId, 'fees', 'graceDays', 5));
  if (!fixed && !percent) return { updated: 0 };
  const today = new Date();
  const rows = db.prepare(
    "SELECT * FROM invoices WHERE school_id = ? AND status IN ('unpaid','partial') AND balance > 0",
  ).all(schoolId);
  let updated = 0;
  for (const inv of rows) {
    const due = new Date(inv.due_date);
    const overdueDays = Math.floor((today - due) / 86_400_000);
    if (overdueDays <= grace) continue;
    if (Number(inv.late_fee) > 0) continue;
    const amount = money(fixed + (Number(inv.subtotal) - Number(inv.discount)) * (percent / 100));
    if (amount <= 0) continue;
    const newTotal = money(Number(inv.total) + amount);
    db.prepare('UPDATE invoices SET late_fee = ?, total = ?, balance = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(amount, newTotal, money(newTotal - Number(inv.amount_paid)), 'overdue', nowIso(), inv.id);
    updated += 1;
  }
  return { updated };
}

export function studentFeePosition(studentId) {
  const fees = db.prepare('SELECT * FROM student_fees WHERE student_id = ? ORDER BY created_at DESC').all(studentId);
  const invoices = db.prepare("SELECT * FROM invoices WHERE student_id = ? AND status != 'cancelled'").all(studentId);
  const payments = db.prepare("SELECT * FROM payments WHERE student_id = ? AND status IN ('success','partially_refunded')").all(studentId);
  const billed = fees.reduce((s, f) => s + Number(f.net_amount || 0), 0) || invoices.reduce((s, i) => s + Number(i.total || 0), 0);
  const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const discounts = fees.reduce((s, f) => s + Number(f.discount_amount || 0), 0);
  return {
    billed: money(billed),
    paid: money(paid),
    due: money(Math.max(0, billed - paid)),
    discounts: money(discounts),
    invoices: invoices.length,
    upcoming: invoices
      .filter((i) => i.balance > 0)
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
      .slice(0, 5)
      .map((i) => ({ id: i.id, invoice_no: i.invoice_no, due_date: i.due_date, balance: i.balance, status: i.status })),
  };
}
