import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso, newId } from '../db/index.js';
import { validateBody, pagination } from '../lib/validate.js';
import { requirePermission } from '../lib/auth.js';
import { badRequest, conflict, notFound, asyncHandler } from '../lib/errors.js';
import { audit, notifyUsers } from '../lib/audit.js';
import { sendTable } from '../lib/export.js';

const router = Router();

const monthPattern = /^\d{4}-\d{2}$/;

router.get('/', requirePermission('payroll.view'), asyncHandler(async (req, res) => {
  const { limit, offset, page } = pagination(req, { defaultLimit: 50 });
  const month = req.query.month && monthPattern.test(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
  const where = ['p.school_id = ?'];
  const params = [req.user.school_id];
  if (req.query.month !== 'all') { where.push('p.month = ?'); params.push(month); }
  if (req.query.status && req.query.status !== 'all') { where.push('p.status = ?'); params.push(req.query.status); }
  if (req.query.employeeId) { where.push('p.employee_id = ?'); params.push(req.query.employeeId); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const total = db.prepare(`SELECT COUNT(*) c FROM payroll p ${whereSql}`).get(...params).c;
  const items = db.prepare(
    `SELECT p.*, u.full_name, e.employee_code, e.department, e.designation
     FROM payroll p JOIN employees e ON e.id = p.employee_id JOIN users u ON u.id = e.user_id
     ${whereSql} ORDER BY u.full_name LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);

  const summary = db.prepare(
    `SELECT COALESCE(SUM(net),0) total, COALESCE(SUM(CASE WHEN status='paid' THEN net ELSE 0 END),0) paid,
            COALESCE(SUM(CASE WHEN status='pending' THEN net ELSE 0 END),0) pending, COUNT(*) records
     FROM payroll WHERE school_id = ? AND (? = 'all' OR month = ?)`,
  ).get(req.user.school_id, req.query.month === 'all' ? 'all' : 'one', month);

  const months = db.prepare('SELECT DISTINCT month FROM payroll WHERE school_id = ? ORDER BY month DESC LIMIT 24')
    .all(req.user.school_id).map((r) => r.month);

  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1, summary, month, months });
}));

router.post('/generate', requirePermission('payroll.manage'), validateBody(z.object({
  month: z.string().regex(monthPattern),
  onlyActive: z.boolean().optional().default(true),
})), asyncHandler(async (req, res) => {
  const { month } = req.data;
  const employees = db.prepare(
    `SELECT e.*, u.full_name FROM employees e JOIN users u ON u.id = e.user_id
     WHERE e.school_id = ? ${req.data.onlyActive ? "AND e.status = 'active'" : ''}`,
  ).all(req.user.school_id);
  if (!employees.length) throw badRequest('No employees to process');

  let created = 0;
  let skipped = 0;
  const run = db.transaction(() => {
    for (const emp of employees) {
      const exists = db.prepare('SELECT id FROM payroll WHERE employee_id = ? AND month = ?').get(emp.id, month);
      if (exists) { skipped += 1; continue; }
      const basic = Number(emp.salary_amount || 0);
      const allowances = Math.round(basic * 0.1);
      const deductions = Math.round(basic * 0.12);
      const net = basic + allowances - deductions;
      db.prepare(
        `INSERT INTO payroll (id, school_id, employee_id, month, basic, allowances, deductions, net, status, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(newId('pay'), req.user.school_id, emp.id, month, basic, allowances, deductions, net, 'pending', req.user.id, nowIso(), nowIso());
      created += 1;
    }
  });
  run();
  audit(req, { action: 'generate', module: 'payroll', summary: `Generated payroll for ${month}: ${created} records`, meta: { month, created, skipped } });
  res.json({ created, skipped, month });
}));

router.patch('/:id', requirePermission('payroll.manage'), validateBody(z.object({
  basic: z.coerce.number().min(0).optional(),
  allowances: z.coerce.number().min(0).optional(),
  deductions: z.coerce.number().min(0).optional(),
  remarks: z.string().max(300).optional(),
})), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM payroll WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Payroll record not found');
  if (row.status === 'paid') throw badRequest('Paid payroll records cannot be edited');
  const basic = req.data.basic ?? row.basic;
  const allowances = req.data.allowances ?? row.allowances;
  const deductions = req.data.deductions ?? row.deductions;
  const net = Math.round((basic + allowances - deductions) * 100) / 100;
  db.prepare('UPDATE payroll SET basic = ?, allowances = ?, deductions = ?, net = ?, remarks = ?, updated_at = ? WHERE id = ?')
    .run(basic, allowances, deductions, net, req.data.remarks ?? row.remarks, nowIso(), row.id);
  audit(req, { action: 'update', module: 'payroll', entityType: 'payroll', entityId: row.id, summary: `Adjusted payroll for ${row.month}` });
  res.json({ ok: true, net });
}));

router.post('/:id/pay', requirePermission('payroll.manage'), validateBody(z.object({
  method: z.string().max(30).optional().default('bank_transfer'),
  paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM payroll WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Payroll record not found');
  if (row.status === 'paid') throw conflict('This payroll record is already paid');
  db.prepare("UPDATE payroll SET status = 'paid', paid_on = ?, method = ?, updated_at = ? WHERE id = ?")
    .run(req.data.paid_on || new Date().toISOString().slice(0, 10), req.data.method, nowIso(), row.id);

  const emp = db.prepare('SELECT user_id FROM employees WHERE id = ?').get(row.employee_id);
  notifyUsers(req.user.school_id, [emp?.user_id], {
    title: 'Salary credited',
    body: `Salary for ${row.month} of ${row.net} has been paid via ${req.data.method}.`,
    type: 'success', link: '/app/hr/payroll',
  });
  audit(req, { action: 'pay', module: 'payroll', entityType: 'payroll', entityId: row.id, summary: `Marked ${row.month} salary paid` });
  res.json({ ok: true });
}));

router.get('/export', requirePermission('payroll.view'), asyncHandler(async (req, res) => {
  const month = req.query.month && monthPattern.test(req.query.month) ? req.query.month : null;
  const rows = db.prepare(
    `SELECT p.*, u.full_name, e.employee_code, e.department FROM payroll p
     JOIN employees e ON e.id = p.employee_id JOIN users u ON u.id = e.user_id
     WHERE p.school_id = ? AND (? IS NULL OR p.month = ?) ORDER BY p.month DESC, u.full_name`,
  ).all(req.user.school_id, month, month);
  await sendTable(req, res, {
    filename: `payroll-${month || 'all'}`,
    title: 'Payroll Register',
    columns: [
      { label: 'Month', key: 'month' },
      { label: 'Employee Code', key: 'employee_code' },
      { label: 'Name', key: 'full_name' },
      { label: 'Department', key: 'department' },
      { label: 'Basic', key: 'basic' },
      { label: 'Allowances', key: 'allowances' },
      { label: 'Deductions', key: 'deductions' },
      { label: 'Net Payable', key: 'net' },
      { label: 'Status', key: 'status' },
      { label: 'Paid On', key: 'paid_on' },
    ],
    rows,
  });
}));

export default router;
