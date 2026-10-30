import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, nowIso, newId, setSetting, getAllSettings, getSetting, BACKUP_DIR, DB_FILE, DATA_DIR } from '../db/index.js';
import { validateBody, pagination } from '../lib/validate.js';
import { requirePermission, passwordPolicy, DEFAULT_PASSWORD_POLICY, hashPassword, generatePassword } from '../lib/auth.js';
import { badRequest, conflict, notFound, forbidden, asyncHandler } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { uploader, publicUrl } from '../lib/upload.js';
import { sendEmailNow, verifyEmail, emailConfig, smsConfig, isEmailConfigured, isSmsConfigured, maskSecret, processOutbox } from '../lib/integrations.js';
import { sendTable } from '../lib/export.js';
import { DEFAULT_THEME } from '../lib/defaults.js';

const router = Router();

const SCHOOL_FIELDS = ['name', 'tagline', 'address', 'city', 'state', 'pincode', 'country', 'phone', 'email', 'website',
  'affiliation', 'principal_name', 'currency', 'currency_symbol', 'timezone', 'locale', 'logo_url', 'favicon_url'];

router.get('/', requirePermission('settings.view', 'settings.school', 'settings.customize'), asyncHandler(async (req, res) => {
  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(req.user.school_id);
  const categories = ['academic', 'attendance', 'fees', 'exams', 'security', 'retention', 'notifications', 'integrations', 'dashboard', 'library'];
  const settings = {};
  for (const category of categories) settings[category] = getAllSettings(req.user.school_id, category);
  res.json({
    school: school,
    settings,
    theme: { ...DEFAULT_THEME, ...getAllSettings(req.user.school_id, 'theme').config },
    reportCard: getAllSettings(req.user.school_id, 'theme').reportCard || {},
    invoiceTemplate: getAllSettings(req.user.school_id, 'theme').invoice || {},
    passwordPolicy: passwordPolicy(req.user.school_id),
    integrations: {
      email: { ...emailConfig(req.user.school_id), pass: emailConfig(req.user.school_id).pass ? '••••••••' : '' },
      sms: { ...smsConfig(req.user.school_id), apiKey: maskSecret(smsConfig(req.user.school_id).apiKey) },
    },
    system: systemInfo(req.user.school_id),
  });
}));

function systemInfo(schoolId) {
  const counts = {};
  for (const table of ['students', 'users', 'employees', 'invoices', 'payments', 'exams', 'exam_results', 'attendance', 'audit_logs', 'books']) {
    counts[table] = db.prepare(`SELECT COUNT(*) c FROM ${table}${table === 'users' ? ' WHERE school_id = ?' : ' WHERE school_id = ?'}`)
      .get(schoolId).c;
  }
  const stat = fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE) : { size: 0 };
  return {
    counts,
    dbSize: stat.size,
    uploadsSize: dirSize(path.join(DATA_DIR, 'uploads')),
    backups: db.prepare('SELECT COUNT(*) c FROM backups WHERE school_id = ? OR school_id IS NULL').get(schoolId).c,
    node: process.version,
    platform: process.platform,
    uptimeSeconds: Math.round(process.uptime()),
    dataDir: DATA_DIR,
  };
}

function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const walk = (p) => {
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, entry.name);
      if (entry.isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    }
  };
  walk(dir);
  return total;
}

router.patch('/school', requirePermission('settings.school'), validateBody(z.object({
  name: z.string().min(2).max(120).optional(),
  tagline: z.string().max(160).optional(),
  address: z.string().max(240).optional(),
  city: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  pincode: z.string().max(12).optional(),
  country: z.string().max(60).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  website: z.string().max(120).optional(),
  affiliation: z.string().max(120).optional(),
  principal_name: z.string().max(120).optional(),
  currency: z.string().max(6).optional(),
  currency_symbol: z.string().max(4).optional(),
  timezone: z.string().max(60).optional(),
  locale: z.string().max(12).optional(),
  logo_url: z.string().max(300).nullish(),
  favicon_url: z.string().max(300).nullish(),
  working_days: z.array(z.coerce.number().int().min(1).max(7)).max(7).optional(),
})), asyncHandler(async (req, res) => {
  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(req.user.school_id);
  const fields = [];
  const values = [];
  for (const key of SCHOOL_FIELDS) {
    if (req.data[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(req.data[key]);
    }
  }
  if (req.data.working_days) {
    fields.push('working_days = ?');
    values.push(JSON.stringify(req.data.working_days));
  }
  if (!fields.length) throw badRequest('Nothing to update');
  values.push(nowIso(), school.id);
  db.prepare(`UPDATE schools SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`).run(...values);
  audit(req, { action: 'update', module: 'settings', entityType: 'school', entityId: school.id, summary: 'Updated school configuration', meta: { fields: Object.keys(req.data) } });
  res.json({ ok: true });
}));

router.post('/branding/:kind', requirePermission('settings.school', 'settings.customize'), (req, res, next) => {
  const kind = req.params.kind === 'favicon' ? 'favicon' : 'logo';
  req.brandingKind = kind;
  uploader('branding', { maxMb: 2 })(req, res, next);
}, asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('No file uploaded');
  if (!/^image\//.test(req.file.mimetype)) throw badRequest('Upload an image file (png, jpg, svg or webp)');
  const column = req.brandingKind === 'favicon' ? 'favicon_url' : 'logo_url';
  const url = publicUrl(req.file);
  db.prepare(`UPDATE schools SET ${column} = ?, updated_at = ? WHERE id = ?`).run(url, nowIso(), req.user.school_id);
  audit(req, { action: 'update', module: 'settings', entityType: 'school', entityId: req.user.school_id, summary: `Updated school ${req.brandingKind}` });
  res.status(201).json({ url });
}));

/* ------------------------------- preferences ------------------------------ */

const SETTING_WHITELIST = {
  academic: ['sessionStartMonth', 'gradingStyle', 'attendanceLockDays', 'currentSessionId'],
  attendance: ['lateAfterMinutes', 'notifyParentsOnAbsence', 'workingDays', 'weeklyOff'],
  fees: ['invoicePrefix', 'receiptPrefix', 'lateFeeFixed', 'lateFeePercent', 'graceDays', 'partialPaymentsAllowed', 'invoiceDueDays'],
  exams: ['defaultPassPercentage', 'tieBreak', 'rankScope', 'weightageEnabled', 'showRankOnReportCard'],
  security: ['passwordPolicy', 'forceHttps', 'ipAllowlist', 'twoFactorPolicy', 'require2faForPrincipal'],
  retention: ['auditLogDays', 'loginHistoryDays', 'backupEveryHours', 'autoBackupEnabled', 'sessionInactiveDays'],
  notifications: ['emailOnResult', 'emailOnInvoice', 'smsOnAbsence', 'digestTime'],
  dashboard: ['widgets'],
  library: ['finePerDay', 'maxBooksPerBorrower', 'loanDays'],
  website: [],
};

router.patch('/:category', requirePermission('settings.school', 'settings.security', 'settings.customize'), asyncHandler(async (req, res) => {
  const category = req.params.category;
  const allowed = SETTING_WHITELIST[category];
  if (!allowed) throw badRequest(`Unknown settings category: ${category}`);
  const updates = req.body || {};
  const keys = Object.keys(updates).filter((k) => allowed.includes(k));
  if (!keys.length) throw badRequest('No recognised settings supplied');
  for (const key of keys) setSetting(req.user.school_id, category, key, updates[key], req.user.id);

  audit(req, {
    action: 'update', module: 'settings', entityType: 'settings', entityId: category,
    summary: `Updated ${category} settings`, meta: { keys },
  });
  res.json({ ok: true, updated: keys });
}));

router.put('/theme', requirePermission('settings.customize'), validateBody(z.object({
  mode: z.enum(['light', 'dark', 'system']).optional(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  accentSoft: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  radius: z.string().max(10).optional(),
  font: z.string().max(40).optional(),
  sidebarStyle: z.enum(['dark', 'light', 'accent']).optional(),
  density: z.enum(['comfortable', 'compact']).optional(),
  loginTitle: z.string().max(80).optional(),
  loginSubtitle: z.string().max(120).optional(),
  showPublicWebsite: z.boolean().optional(),
})), asyncHandler(async (req, res) => {
  const current = { ...DEFAULT_THEME, ...getAllSettings(req.user.school_id, 'theme').config };
  const next = { ...current, ...req.data };
  setSetting(req.user.school_id, 'theme', 'config', next, req.user.id);
  audit(req, { action: 'update', module: 'settings', entityType: 'theme', summary: 'Updated theme & branding', meta: req.data });
  res.json({ theme: next });
}));

router.put('/report-card-template', requirePermission('results.template'), validateBody(z.object({
  title: z.string().max(60).optional(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  showPhoto: z.boolean().optional(),
  showRank: z.boolean().optional(),
  showAttendance: z.boolean().optional(),
  showGradeLegend: z.boolean().optional(),
  showTeacherRemark: z.boolean().optional(),
  showPrincipalRemark: z.boolean().optional(),
  showSignature: z.boolean().optional(),
  showStamp: z.boolean().optional(),
  showDob: z.boolean().optional(),
  showFatherName: z.boolean().optional(),
  showSubjectRemark: z.boolean().optional(),
  footerNote: z.string().max(300).optional(),
  principalLabel: z.string().max(40).optional(),
  teacherLabel: z.string().max(40).optional(),
})), asyncHandler(async (req, res) => {
  const current = getAllSettings(req.user.school_id, 'theme').reportCard || {};
  const next = { ...current, ...req.data };
  setSetting(req.user.school_id, 'theme', 'reportCard', next, req.user.id);
  audit(req, { action: 'update', module: 'settings', entityType: 'report_template', summary: 'Updated report card template', meta: req.data });
  res.json({ template: next });
}));

router.put('/invoice-template', requirePermission('settings.customize'), validateBody(z.object({
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  footerNote: z.string().max(300).optional(),
})), asyncHandler(async (req, res) => {
  const current = getAllSettings(req.user.school_id, 'theme').invoice || {};
  const next = { ...current, ...req.data };
  setSetting(req.user.school_id, 'theme', 'invoice', next, req.user.id);
  res.json({ template: next });
}));

/* ------------------------------- integrations ----------------------------- */

router.put('/integrations/email', requirePermission('settings.integrations'), validateBody(z.object({
  enabled: z.boolean().optional(),
  host: z.string().max(200).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  user: z.string().max(200).optional(),
  pass: z.string().max(300).optional(),
  fromName: z.string().max(80).optional(),
  fromEmail: z.string().max(200).optional(),
})), asyncHandler(async (req, res) => {
  const current = getAllSettings(req.user.school_id, 'integrations').email || {};
  const next = { ...current, ...req.data };
  if (req.data.pass === '••••••••') next.pass = current.pass;
  setSetting(req.user.school_id, 'integrations', 'email', next, req.user.id);
  audit(req, { action: 'update', module: 'integrations', entityType: 'email', summary: 'Updated SMTP configuration', meta: { host: next.host, enabled: next.enabled } });
  res.json({ ok: true, configured: Boolean(next.enabled && next.host && next.user) });
}));

router.post('/integrations/email/test', requirePermission('settings.integrations'), validateBody(z.object({
  to: z.string().email(),
})), asyncHandler(async (req, res) => {
  if (!isEmailConfigured(req.user.school_id)) throw badRequest('Save the SMTP settings first');
  try {
    await verifyEmail(req.user.school_id);
  } catch (err) {
    throw badRequest(`SMTP connection failed: ${err.message}`);
  }
  await sendEmailNow(req.user.school_id, {
    to: req.data.to,
    subject: 'School ERP — SMTP test',
    html: `<p>This is a test email from your school ERP.</p><p>If you received it, email delivery is working.</p>`,
    text: 'This is a test email from your school ERP. If you received it, email delivery is working.',
  });
  audit(req, { action: 'test', module: 'integrations', entityType: 'email', summary: `Sent test email to ${req.data.to}` });
  res.json({ ok: true, message: 'Test email sent' });
}));

router.put('/integrations/sms', requirePermission('settings.integrations'), validateBody(z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(['generic_http', 'twilio']).optional(),
  apiUrl: z.string().max(400).optional(),
  apiKey: z.string().max(300).optional(),
  senderId: z.string().max(40).optional(),
  accountSid: z.string().max(120).optional(),
  method: z.enum(['GET', 'POST']).optional(),
  authHeaderName: z.string().max(60).optional(),
  authHeader: z.string().max(400).optional(),
})), asyncHandler(async (req, res) => {
  const current = getAllSettings(req.user.school_id, 'integrations').sms || {};
  const next = { ...current, ...req.data };
  if (req.data.apiKey && req.data.apiKey.includes('••')) next.apiKey = current.apiKey;
  setSetting(req.user.school_id, 'integrations', 'sms', next, req.user.id);
  audit(req, { action: 'update', module: 'integrations', entityType: 'sms', summary: 'Updated SMS configuration' });
  res.json({ ok: true });
}));

router.post('/integrations/sms/test', requirePermission('settings.integrations'), validateBody(z.object({
  to: z.string().min(6).max(20),
})), asyncHandler(async (req, res) => {
  if (!isSmsConfigured(req.user.school_id)) throw badRequest('Save the SMS provider settings first');
  const { sendSmsNow } = await import('../lib/integrations.js');
  try {
    await sendSmsNow(req.user.school_id, { to: req.data.to, message: 'School ERP test message' });
  } catch (err) {
    throw badRequest(`SMS provider error: ${err.message}`);
  }
  audit(req, { action: 'test', module: 'integrations', entityType: 'sms', summary: `Sent test SMS to ${req.data.to}` });
  res.json({ ok: true, message: 'Test SMS sent' });
}));

router.put('/payments/razorpay', requirePermission('fees.gateway'), validateBody(z.object({
  enabled: z.boolean().optional(),
  keyId: z.string().max(120).optional(),
  keySecret: z.string().max(200).optional(),
  webhookSecret: z.string().max(200).optional(),
  mode: z.enum(['test', 'live']).optional(),
})), asyncHandler(async (req, res) => {
  const current = getAllSettings(req.user.school_id, 'payments').razorpay || {};
  const next = { ...current, ...req.data };
  if (req.data.keySecret && req.data.keySecret.includes('••')) next.keySecret = current.keySecret;
  if (req.data.webhookSecret && req.data.webhookSecret.includes('••')) next.webhookSecret = current.webhookSecret;
  if (next.enabled && (!next.keyId || !next.keySecret)) throw badRequest('Key ID and Key Secret are required to enable online payments');
  setSetting(req.user.school_id, 'payments', 'razorpay', next, req.user.id);
  audit(req, {
    action: 'update', module: 'integrations', entityType: 'payment_gateway',
    summary: `Razorpay ${next.enabled ? 'enabled' : 'disabled'} (${next.mode || 'test'} mode)`,
  });
  res.json({
    ok: true,
    gateway: { enabled: Boolean(next.enabled), keyId: next.keyId, mode: next.mode, webhookConfigured: Boolean(next.webhookSecret) },
    webhookUrl: '/api/webhooks/razorpay',
  });
}));

router.get('/integrations', requirePermission('settings.integrations', 'fees.gateway'), asyncHandler(async (req, res) => {
  const email = emailConfig(req.user.school_id);
  const sms = smsConfig(req.user.school_id);
  const razorpay = getAllSettings(req.user.school_id, 'payments').razorpay || {};
  res.json({
    email: { ...email, pass: email.pass ? '••••••••' : '' },
    sms: { ...sms, apiKey: maskSecret(sms.apiKey) },
    payments: { ...razorpay, keySecret: razorpay.keySecret ? '••••••••' : '', webhookSecret: razorpay.webhookSecret ? '••••••••' : '' },
    outbox: db.prepare('SELECT status, COUNT(*) c FROM outbox WHERE school_id = ? GROUP BY status').all(req.user.school_id),
  });
}));

/* --------------------------------- security ------------------------------- */

router.put('/security/password-policy', requirePermission('settings.security'), validateBody(z.object({
  minLength: z.coerce.number().int().min(6).max(72).optional(),
  requireUpper: z.boolean().optional(),
  requireNumber: z.boolean().optional(),
  requireSymbol: z.boolean().optional(),
  maxAttempts: z.coerce.number().int().min(3).max(20).optional(),
  lockoutMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  sessionDays: z.coerce.number().int().min(1).max(90).optional(),
  twoFactorRequiredForAdmins: z.boolean().optional(),
  passwordExpiryDays: z.coerce.number().int().min(0).max(365).optional(),
})), asyncHandler(async (req, res) => {
  const current = passwordPolicy(req.user.school_id);
  const next = { ...current, ...req.data };
  setSetting(req.user.school_id, 'security', 'passwordPolicy', next, req.user.id);
  audit(req, { action: 'update', module: 'security', entityType: 'password_policy', summary: 'Updated password policy', meta: req.data });
  res.json({ policy: next });
}));

router.get('/sessions', requirePermission('settings.security'), asyncHandler(async (req, res) => {
  const rows = db.prepare(
    `SELECT s.*, u.full_name, u.email, u.role FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.school_id = ? AND s.revoked_at IS NULL AND s.expires_at > ? ORDER BY s.last_seen_at DESC LIMIT 200`,
  ).all(req.user.school_id, nowIso());
  res.json({ items: rows });
}));

router.delete('/sessions/:id', requirePermission('settings.security'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM auth_sessions WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Session not found');
  db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ?').run(nowIso(), row.id);
  audit(req, { action: 'session_revoked', module: 'security', entityType: 'session', entityId: row.id, summary: 'Revoked a user session', meta: { userId: row.user_id } });
  res.json({ ok: true });
}));

/* ---------------------------------- audit --------------------------------- */

router.get('/audit', requirePermission('settings.audit'), asyncHandler(async (req, res) => {
  const { limit, offset, page } = pagination(req, { defaultLimit: 50 });
  const where = ['school_id = ?'];
  const params = [req.user.school_id];
  if (req.query.module && req.query.module !== 'all') { where.push('module = ?'); params.push(req.query.module); }
  if (req.query.userId) { where.push('user_id = ?'); params.push(req.query.userId); }
  if (req.query.q) { where.push('(summary LIKE ? OR actor_name LIKE ? OR entity_type LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.from) { where.push('date(created_at) >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('date(created_at) <= ?'); params.push(req.query.to); }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) c FROM audit_logs ${whereSql}`).get(...params).c;
  const items = db.prepare(
    `SELECT * FROM audit_logs ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);

  if (String(req.query.format || '') === 'csv' || String(req.query.format || '') === 'xlsx') {
    return sendTable(req, res, {
      filename: 'audit-log', title: 'Activity Log',
      columns: [
        { label: 'When', key: 'created_at' }, { label: 'User', key: 'actor_name' },
        { label: 'Role', key: 'actor_role' }, { label: 'Action', key: 'action' },
        { label: 'Module', key: 'module' }, { label: 'Summary', key: 'summary' }, { label: 'IP', key: 'ip' },
      ],
      rows: db.prepare(`SELECT * FROM audit_logs ${whereSql} ORDER BY created_at DESC LIMIT 5000`).all(...params),
    });
  }
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

router.delete('/audit', requirePermission('settings.retention'), validateBody(z.object({
  before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  confirm: z.literal('PURGE'),
})), asyncHandler(async (req, res) => {
  const result = db.prepare('DELETE FROM audit_logs WHERE school_id = ? AND date(created_at) < ?').run(req.user.school_id, req.data.before);
  audit(req, { action: 'purge', module: 'settings', summary: `Purged ${result.changes} audit log rows before ${req.data.before}` });
  res.json({ deleted: Number(result.changes) });
}));

router.get('/login-history', requirePermission('settings.audit'), asyncHandler(async (req, res) => {
  const { limit, offset, page } = pagination(req, { defaultLimit: 50 });
  const where = ['l.school_id = ?'];
  const params = [req.user.school_id];
  if (req.query.status && req.query.status !== 'all') { where.push('l.status = ?'); params.push(req.query.status); }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) c FROM login_history l ${whereSql}`).get(...params).c;
  const items = db.prepare(
    `SELECT l.*, u.full_name FROM login_history l LEFT JOIN users u ON u.id = l.user_id
     ${whereSql} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

/* --------------------------------- backups -------------------------------- */

router.get('/backups', requirePermission('settings.backup'), asyncHandler(async (req, res) => {
  const items = db.prepare('SELECT * FROM backups WHERE school_id = ? OR school_id IS NULL ORDER BY created_at DESC').all(req.user.school_id)
    .map((b) => ({ ...b, exists: fs.existsSync(path.join(BACKUP_DIR, b.filename)) }));
  res.json({ items, dir: BACKUP_DIR });
}));

router.post('/backups', requirePermission('settings.backup'), validateBody(z.object({
  kind: z.enum(['manual', 'scheduled']).optional().default('manual'),
})), asyncHandler(async (req, res) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `school-erp-${stamp}.db`;
  const target = path.join(BACKUP_DIR, filename);
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  const size = fs.statSync(target).size;
  const id = newId('bak');
  db.prepare('INSERT INTO backups (id, school_id, filename, size, kind, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, req.user.school_id, filename, size, req.data.kind, req.user.id, nowIso());
  audit(req, { action: 'backup', module: 'settings', entityType: 'backup', entityId: id, summary: `Created database backup ${filename}`, meta: { size } });
  res.status(201).json({ id, filename, size });
}));

router.get('/backups/:id/download', requirePermission('settings.backup'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM backups WHERE id = ?').get(req.params.id);
  if (!row) throw notFound('Backup not found');
  const file = path.join(BACKUP_DIR, row.filename);
  if (!fs.existsSync(file)) throw notFound('Backup file is missing');
  audit(req, { action: 'download', module: 'settings', entityType: 'backup', entityId: row.id, summary: `Downloaded backup ${row.filename}` });
  res.download(file, row.filename);
}));

router.post('/backups/:id/restore', requirePermission('settings.backup'), validateBody(z.object({
  confirm: z.literal('RESTORE'),
})), asyncHandler(async (req, res) => {
  if (req.user.role !== 'principal') throw forbidden('Only the principal can restore a backup');
  const row = db.prepare('SELECT * FROM backups WHERE id = ?').get(req.params.id);
  if (!row) throw notFound('Backup not found');
  const file = path.join(BACKUP_DIR, row.filename);
  if (!fs.existsSync(file)) throw notFound('Backup file is missing');

  // Safety snapshot of the current state before replacing anything.
  const safetyName = `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`;
  db.exec(`VACUUM INTO '${path.join(BACKUP_DIR, safetyName).replace(/'/g, "''")}'`);

  db.exec(`ATTACH DATABASE '${file.replace(/'/g, "''")}' AS backup_db`);
  const tables = db.prepare("SELECT name FROM backup_db.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
  const liveTables = db.prepare("SELECT name FROM main.sqlite_master WHERE type='table'").all().map((r) => r.name);

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    for (const table of liveTables.filter((t) => t !== '_migrations')) {
      if (!tables.includes(table)) continue;
      db.exec(`DELETE FROM main.${table}`);
      db.exec(`INSERT INTO main.${table} SELECT * FROM backup_db.${table}`);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.exec('DETACH DATABASE backup_db');
    db.exec('PRAGMA foreign_keys = ON');
    throw badRequest(`Restore failed and was rolled back: ${err.message}`);
  }
  db.exec('DETACH DATABASE backup_db');
  db.exec('PRAGMA foreign_keys = ON');

  audit(req, {
    action: 'restore', module: 'settings', entityType: 'backup', entityId: row.id,
    summary: `Restored database from ${row.filename}`, meta: { safetySnapshot: safetyName },
  });
  res.json({ ok: true, restored: row.filename, safetySnapshot: safetyName, message: 'Restore complete. Sign in again if your session was affected.' });
}));

router.delete('/backups/:id', requirePermission('settings.backup'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM backups WHERE id = ?').get(req.params.id);
  if (!row) throw notFound('Backup not found');
  const file = path.join(BACKUP_DIR, row.filename);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  db.prepare('DELETE FROM backups WHERE id = ?').run(row.id);
  audit(req, { action: 'delete', module: 'settings', entityType: 'backup', entityId: row.id, summary: `Deleted backup ${row.filename}` });
  res.json({ ok: true });
}));

/* ---------------------------------- API keys ------------------------------ */

router.get('/api-keys', requirePermission('settings.api'), asyncHandler(async (req, res) => {
  const items = db.prepare('SELECT id, name, prefix, scopes, created_at, last_used_at, revoked_at FROM api_keys WHERE school_id = ? ORDER BY created_at DESC')
    .all(req.user.school_id).map((k) => ({ ...k, scopes: safeParse(k.scopes, []) }));
  res.json({ items });
}));

router.post('/api-keys', requirePermission('settings.api'), validateBody(z.object({
  name: z.string().min(2).max(60),
  scopes: z.array(z.string()).max(30).optional().default(['read']),
})), asyncHandler(async (req, res) => {
  const raw = `sk_${crypto.randomBytes(24).toString('base64url')}`;
  const prefix = raw.slice(0, 10);
  const id = newId('key');
  db.prepare('INSERT INTO api_keys (id, school_id, name, prefix, key_hash, scopes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, req.user.school_id, req.data.name, prefix, crypto.createHash('sha256').update(raw).digest('hex'),
      JSON.stringify(req.data.scopes), req.user.id, nowIso());
  audit(req, { action: 'create', module: 'security', entityType: 'api_key', entityId: id, summary: `Created API key "${req.data.name}"` });
  res.status(201).json({ id, key: raw, prefix, message: 'Copy this key now — it is never shown again.' });
}));

router.delete('/api-keys/:id', requirePermission('settings.api'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM api_keys WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('API key not found');
  db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ?').run(nowIso(), row.id);
  audit(req, { action: 'revoke', module: 'security', entityType: 'api_key', entityId: row.id, summary: `Revoked API key "${row.name}"` });
  res.json({ ok: true });
}));

/* ------------------------------- maintenance ------------------------------ */

router.post('/maintenance/retention', requirePermission('settings.retention'), asyncHandler(async (req, res) => {
  const retention = getAllSettings(req.user.school_id, 'retention');
  const auditDays = Number(retention.auditLogDays || 730);
  const loginDays = Number(retention.loginHistoryDays || 365);
  const auditCut = new Date(Date.now() - auditDays * 86_400_000).toISOString();
  const loginCut = new Date(Date.now() - loginDays * 86_400_000).toISOString();

  const a = db.prepare('DELETE FROM audit_logs WHERE school_id = ? AND created_at < ?').run(req.user.school_id, auditCut);
  const l = db.prepare('DELETE FROM login_history WHERE school_id = ? AND created_at < ?').run(req.user.school_id, loginCut);
  const s = db.prepare('DELETE FROM auth_sessions WHERE school_id = ? AND (expires_at < ? OR revoked_at IS NOT NULL)').run(req.user.school_id, nowIso());
  audit(req, {
    action: 'retention', module: 'settings',
    summary: `Retention cleanup: ${a.changes} audit rows, ${l.changes} login rows, ${s.changes} sessions removed`,
  });
  res.json({ auditLogs: Number(a.changes), loginHistory: Number(l.changes), sessions: Number(s.changes) });
}));

router.post('/maintenance/outbox', requirePermission('settings.integrations'), asyncHandler(async (req, res) => {
  const result = await processOutbox(req.user.school_id, { limit: 100 });
  res.json(result);
}));

router.get('/system', requirePermission('settings.view', 'settings.security'), asyncHandler(async (req, res) => {
  res.json(systemInfo(req.user.school_id));
}));

router.post('/principal/password', requirePermission('settings.security'), validateBody(z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
})), asyncHandler(async (req, res) => {
  if (req.user.role !== 'principal') throw forbidden('Principal only');
  const { verifyPassword } = await import('../lib/auth.js');
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(req.data.currentPassword, row.password_hash)) throw badRequest('Current password is incorrect');
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPassword(req.data.newPassword), nowIso(), req.user.id);
  audit(req, { action: 'password_change', module: 'security', entityType: 'user', entityId: req.user.id, summary: 'Principal changed password from settings' });
  res.json({ ok: true });
}));

router.get('/roles-catalog', requirePermission('settings.permissions'), asyncHandler(async (req, res) => {
  const roles = db.prepare('SELECT * FROM roles WHERE school_id = ?').all(req.user.school_id)
    .map((r) => ({ ...r, permissions: safeParse(r.permissions, []) }));
  res.json({ items: roles });
}));

function safeParse(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export default router;
