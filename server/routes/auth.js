import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso, newId, getSetting } from '../db/index.js';
import { validateBody } from '../lib/validate.js';
import {
  authenticate, hashPassword, verifyPassword, createSession, revokeSession, revokeAllUserSessions,
  setSessionCookie, clearSessionCookie, readSessionToken, passwordPolicy, validatePassword,
  checkLoginAllowed, registerFailedLogin, generatePassword, effectivePermissions,
  verifyTotp, generateTotpSecret, otpAuthUrl, clientIp, requireAuth,
} from '../lib/auth.js';
import { ApiError, badRequest, unauthorized, asyncHandler } from '../lib/errors.js';
import { audit, notifyUsers } from '../lib/audit.js';

const router = Router();

function publicUser(user) {
  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(user.school_id);
  return {
    id: user.id,
    email: user.email,
    username: user.username || null,
    full_name: user.full_name,
    phone: user.phone,
    role: user.role,
    department: user.department,
    designation: user.designation,
    avatar_url: user.avatar_url,
    must_change_password: Boolean(user.must_change_password),
    two_factor_enabled: Boolean(user.two_factor_enabled),
    permissions: effectivePermissions(user),
    school: school ? {
      id: school.id, name: school.name, logo_url: school.logo_url, tagline: school.tagline,
      currency: school.currency, currency_symbol: school.currency_symbol, timezone: school.timezone,
      address: school.address, city: school.city, phone: school.phone, email: school.email,
      website: school.website, principal_name: school.principal_name, is_demo: Boolean(school.is_demo),
      working_days: school.working_days,
    } : null,
  };
}

const loginSchema = z.object({
  email: z.string().max(160).optional(),
  identifier: z.string().max(160).optional(),
  username: z.string().max(60).optional(),
  password: z.string().min(1, 'Password is required'),
  totp: z.string().max(10).optional(),
  schoolCode: z.string().max(24).optional(),
}).refine((value) => Boolean(value.email || value.identifier || value.username), {
  message: 'Enter your email or username',
  path: ['email'],
});

router.post('/login', validateBody(loginSchema), asyncHandler(async (req, res) => {
  const { password, totp, schoolCode } = req.data;
  // Accept `identifier` (preferred), or `email`, or `username` — all may hold
  // either an email address or a short login name such as `admin`.
  const email = String(req.data.identifier || req.data.email || req.data.username || '').trim();
  const isEmail = email.includes('@');
  const candidates = isEmail
    ? db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').all(email)
    : db.prepare('SELECT * FROM users WHERE lower(username) = lower(?) AND username IS NOT NULL').all(email);

  let user = candidates[0];
  if (schoolCode) {
    const school = db.prepare('SELECT id FROM schools WHERE lower(code) = lower(?)').get(schoolCode);
    user = candidates.find((c) => c.school_id === school?.id) || null;
  } else if (candidates.length > 1) {
    user = candidates[0];
  }

  const recordAttempt = (status, reason) => {
    db.prepare(
      'INSERT INTO login_history (id, school_id, user_id, email, ip, user_agent, status, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    ).run(newId('log'), user?.school_id || candidates[0]?.school_id || 'unknown', user?.id || null, email,
      clientIp(req), String(req.headers['user-agent'] || '').slice(0, 200), status, reason, nowIso());
  };

  if (!user) {
    recordAttempt('failed', 'unknown_account');
    throw new ApiError(401, 'Invalid email, username or password');
  }

  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(user.school_id);
  if (!school?.is_active) {
    recordAttempt('failed', 'school_inactive');
    throw new ApiError(403, 'This school workspace is not active');
  }

  const policy = passwordPolicy(user.school_id);
  try {
    checkLoginAllowed(user, policy);
  } catch (err) {
    recordAttempt('blocked', err.message);
    throw err;
  }

  if (!verifyPassword(password, user.password_hash)) {
    registerFailedLogin(user, policy);
    recordAttempt('failed', 'bad_password');
    throw new ApiError(401, 'Invalid email, username or password');
  }

  if (user.two_factor_enabled) {
    if (!totp) {
      recordAttempt('pending_2fa', 'totp_required');
      return res.status(401).json({ error: 'Two-factor code required', code: 'two_factor_required' });
    }
    if (!verifyTotp(user.two_factor_secret, totp)) {
      registerFailedLogin(user, policy);
      recordAttempt('failed', 'bad_totp');
      throw new ApiError(401, 'Invalid two-factor code');
    }
  }

  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?')
    .run(nowIso(), user.id);

  const session = createSession(user, req);
  setSessionCookie(res, session.token, session.days);
  recordAttempt('success', 'password');

  res.json({ user: publicUser(user), expiresAt: session.expiresAt });
}));

router.post('/logout', (req, res) => {
  revokeSession(readSessionToken(req));
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', authenticate, requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: publicUser(req.user) });
}));

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(200),
});

router.post('/change-password', authenticate, requireAuth, validateBody(passwordSchema), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(req.data.currentPassword, row.password_hash)) {
    throw badRequest('Current password is incorrect');
  }
  const policy = passwordPolicy(req.user.school_id);
  const problems = validatePassword(req.data.newPassword, policy);
  if (problems.length) throw badRequest(problems.join('. '));
  if (req.data.newPassword === req.data.currentPassword) throw badRequest('New password must be different from the current password');

  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
    .run(hashPassword(req.data.newPassword), nowIso(), req.user.id);
  revokeAllUserSessions(req.user.id, readSessionToken(req));
  audit(req, { action: 'password_change', module: 'security', entityType: 'user', entityId: req.user.id, summary: 'Changed own password' });
  res.json({ ok: true, message: 'Password updated. Other devices have been signed out.' });
}));

/* ----------------------------------- 2FA ---------------------------------- */

router.post('/2fa/setup', authenticate, requireAuth, asyncHandler(async (req, res) => {
  const secret = generateTotpSecret();
  db.prepare('UPDATE users SET two_factor_secret = ? WHERE id = ?').run(secret, req.user.id);
  res.json({
    secret,
    otpauth: otpAuthUrl({ secret, email: req.user.email, schoolName: req.user.school.name }),
    hint: 'Scan the URI in an authenticator app, or enter the secret manually, then confirm with a 6-digit code.',
  });
}));

router.post('/2fa/enable', authenticate, requireAuth, validateBody(z.object({ code: z.string().min(6).max(8) })), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT two_factor_secret FROM users WHERE id = ?').get(req.user.id);
  if (!row?.two_factor_secret) throw badRequest('Start two-factor setup first');
  if (!verifyTotp(row.two_factor_secret, req.data.code)) throw badRequest('Invalid code. Check your authenticator app time sync.');
  db.prepare('UPDATE users SET two_factor_enabled = 1, updated_at = ? WHERE id = ?').run(nowIso(), req.user.id);
  audit(req, { action: '2fa_enabled', module: 'security', entityType: 'user', entityId: req.user.id, summary: 'Enabled two-factor authentication' });
  res.json({ ok: true, message: 'Two-factor authentication enabled' });
}));

router.post('/2fa/disable', authenticate, requireAuth, validateBody(z.object({ password: z.string().min(1) })), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(req.data.password, row.password_hash)) throw badRequest('Password is incorrect');
  const policy = passwordPolicy(req.user.school_id);
  if (policy.twoFactorRequiredForAdmins && req.user.role === 'principal') {
    throw badRequest('School policy requires two-factor authentication for principal accounts');
  }
  db.prepare('UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL, updated_at = ? WHERE id = ?').run(nowIso(), req.user.id);
  audit(req, { action: '2fa_disabled', module: 'security', entityType: 'user', entityId: req.user.id, summary: 'Disabled two-factor authentication' });
  res.json({ ok: true, message: 'Two-factor authentication disabled' });
}));

/* -------------------------------- sessions -------------------------------- */

router.get('/sessions', authenticate, requireAuth, asyncHandler(async (req, res) => {
  const rows = db.prepare(
    'SELECT id, ip, user_agent, created_at, last_seen_at, expires_at, revoked_at FROM auth_sessions WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT 50',
  ).all(req.user.id);
  const currentId = req.user.session_id;
  res.json({
    items: rows.map((r) => ({
      ...r,
      current: r.id === currentId,
      device: /mobile/i.test(r.user_agent || '') ? 'Mobile browser' : /Mac|Win|Linux/i.test(r.user_agent || '') ? 'Desktop browser' : 'Unknown device',
    })),
  });
}));

router.delete('/sessions/:id', authenticate, requireAuth, asyncHandler(async (req, res) => {
  db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND user_id = ?').run(nowIso(), req.params.id, req.user.id);
  audit(req, { action: 'session_revoked', module: 'security', entityType: 'session', entityId: req.params.id, summary: 'Revoked a device session' });
  res.json({ ok: true });
}));

router.delete('/sessions', authenticate, requireAuth, asyncHandler(async (req, res) => {
  revokeAllUserSessions(req.user.id, readSessionToken(req));
  audit(req, { action: 'sessions_revoked', module: 'security', summary: 'Signed out all other devices' });
  res.json({ ok: true, message: 'All other sessions signed out' });
}));

router.get('/login-history', authenticate, requireAuth, asyncHandler(async (req, res) => {
  const scope = req.user.role === 'principal' ? req.query.all === '1' : false;
  const rows = scope
    ? db.prepare(
      `SELECT l.*, u.full_name FROM login_history l LEFT JOIN users u ON u.id = l.user_id
       WHERE l.school_id = ? ORDER BY l.created_at DESC LIMIT 200`,
    ).all(req.user.school_id)
    : db.prepare(
      'SELECT * FROM login_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
    ).all(req.user.id);
  res.json({ items: rows });
}));

/* ------------------------------ account tools ----------------------------- */

router.patch('/profile', authenticate, requireAuth, asyncHandler(async (req, res) => {
  const schema = z.object({
    full_name: z.string().min(2).max(120).optional(),
    phone: z.string().max(30).optional(),
    avatar_url: z.string().max(300).nullish(),
  });
  const data = schema.parse(req.body);
  const fields = [];
  const values = [];
  for (const key of ['full_name', 'phone', 'avatar_url']) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(data[key]);
    }
  }
  if (!fields.length) throw badRequest('Nothing to update');
  values.push(nowIso(), req.user.id);
  db.prepare(`UPDATE users SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`).run(...values);
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(fresh) });
}));

export { publicUser, generatePassword };
export default router;
