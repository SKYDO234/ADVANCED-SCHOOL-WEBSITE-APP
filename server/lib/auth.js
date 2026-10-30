import crypto from 'node:crypto';
import { db, nowIso, newId, getSetting } from '../db/index.js';
import { ALL_PERMISSIONS, expandPermissions, DEPARTMENT_PRESETS } from './permissions.js';
import { ApiError, forbidden, unauthorized } from './errors.js';

const SESSION_COOKIE = 'sm_sid';
const SESSION_DAYS = 7;

/* ------------------------------- passwords ------------------------------- */

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$16384$8$1$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const derived = crypto.scryptSync(password, salt, 64, { N: Number(N), r: Number(r), p: Number(p) });
  const expected = Buffer.from(hash, 'hex');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

export const DEFAULT_PASSWORD_POLICY = {
  minLength: 8,
  requireUpper: false,
  requireNumber: true,
  requireSymbol: false,
  maxAttempts: 8,
  lockoutMinutes: 15,
  sessionDays: SESSION_DAYS,
  twoFactorRequiredForAdmins: false,
  passwordExpiryDays: 0,
};

export function passwordPolicy(schoolId) {
  return { ...DEFAULT_PASSWORD_POLICY, ...getSetting(schoolId, 'security', 'passwordPolicy', {}) };
}

export function validatePassword(password, policy) {
  const problems = [];
  if (!password || password.length < policy.minLength) {
    problems.push(`Password must be at least ${policy.minLength} characters`);
  }
  if (policy.requireUpper && !/[A-Z]/.test(password)) problems.push('Password needs an uppercase letter');
  if (policy.requireNumber && !/[0-9]/.test(password)) problems.push('Password needs a number');
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) problems.push('Password needs a symbol');
  return problems;
}

export function generatePassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out = '';
  while (out.length < length) out += chars[crypto.randomInt(chars.length)];
  return out;
}

/* -------------------------------- sessions -------------------------------- */

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function createSession(user, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const days = passwordPolicy(user.school_id).sessionDays || SESSION_DAYS;
  const now = new Date();
  const expires = new Date(now.getTime() + days * 86400_000);
  db.prepare(
    `INSERT INTO auth_sessions (id, user_id, school_id, ip, user_agent, created_at, last_seen_at, expires_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    hashToken(token), user.id, user.school_id,
    clientIp(req), String(req.headers['user-agent'] || '').slice(0, 250),
    nowIso(), nowIso(), expires.toISOString(),
  );
  return { token, expiresAt: expires.toISOString(), days };
}

export function revokeSession(token) {
  if (!token) return;
  db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(
    nowIso(), hashToken(token),
  );
}

export function revokeAllUserSessions(userId, exceptToken = null) {
  const except = exceptToken ? hashToken(exceptToken) : null;
  db.prepare(
    'UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND (? IS NULL OR id != ?)',
  ).run(nowIso(), userId, except, except);
}

export function readSessionToken(req) {
  const cookie = req.cookies?.[SESSION_COOKIE];
  if (cookie) return cookie;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

export function setSessionCookie(res, token, days) {
  // Cookies must be SameSite=None; Secure when the SPA is served from a
  // different origin than the API (set CROSS_SITE_COOKIES=1).
  const crossSite = process.env.CROSS_SITE_COOKIES === '1' || process.env.COOKIE_SAMESITE === 'none';
  const sameSite = crossSite ? 'none' : (process.env.COOKIE_SAMESITE || 'lax');
  const secure = process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === '1'
    : (crossSite || (process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1'));
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite,
    secure,
    maxAge: days * 86400_000,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/* ------------------------------ permissions ------------------------------ */

export function effectivePermissions(user) {
  if (user.role === 'principal') return ALL_PERMISSIONS.slice();
  const base = new Set();
  const role = user.role_id
    ? db.prepare('SELECT permissions FROM roles WHERE id = ? AND school_id = ?').get(user.role_id, user.school_id)
    : null;
  if (role) {
    let list = [];
    try {
      list = JSON.parse(role.permissions || '[]');
    } catch {
      list = [];
    }
    expandPermissions(list).forEach((p) => base.add(p));
  }
  // Staff permissions are the union of the staff role and their department preset.
  if (user.role === 'staff' && user.department && DEPARTMENT_PRESETS[user.department]) {
    expandPermissions(DEPARTMENT_PRESETS[user.department]).forEach((p) => base.add(p));
  }
  const overrides = db
    .prepare('SELECT permission, allowed FROM user_permissions WHERE user_id = ?')
    .all(user.id);
  for (const o of overrides) {
    if (o.allowed) base.add(o.permission);
    else base.delete(o.permission);
  }
  return [...base];
}

export function can(user, permission) {
  if (!user) return false;
  if (user.role === 'principal') return true;
  if (!Array.isArray(user.permissions)) user.permissions = effectivePermissions(user);
  return user.permissions.includes(permission);
}

export function canAny(user, permissions) {
  return permissions.some((p) => can(user, p));
}

/* ------------------------------- middleware ------------------------------- */

export function loadUserFromRequest(req) {
  const token = readSessionToken(req);
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.expires_at, s.revoked_at, u.*
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
    )
    .get(hashToken(token));
  if (!row) return null;
  if (row.revoked_at || new Date(row.expires_at) < new Date()) return null;
  if (row.status !== 'active') return null;

  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(row.school_id);
  if (!school || !school.is_active) return null;

  // Throttled last-seen update (max once / 5 min).
  const seen = new Date(row.last_seen_at || 0).getTime();
  if (Date.now() - seen > 300_000) {
    db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?').run(nowIso(), row.session_id);
  }

  const user = {
    id: row.id,
    school_id: row.school_id,
    email: row.email,
    full_name: row.full_name,
    phone: row.phone,
    role: row.role,
    role_id: row.role_id,
    department: row.department,
    designation: row.designation,
    avatar_url: row.avatar_url,
    status: row.status,
    two_factor_enabled: row.two_factor_enabled,
    must_change_password: row.must_change_password,
    session_id: row.session_id,
    school,
  };
  user.permissions = effectivePermissions(user);
  return user;
}

export function authenticate(req, _res, next) {
  const user = loadUserFromRequest(req);
  if (user) req.user = user;
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requirePermission(...permissions) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!canAny(req.user, permissions)) {
      return next(forbidden(`Missing permission: ${permissions.join(' or ')}`));
    }
    next();
  };
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden(`Requires role: ${roles.join('/')}`));
    next();
  };
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

/* ---------------------------------- TOTP --------------------------------- */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

export function totpCode(secret, counter, digits = 6) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(bin).padStart(digits, '0');
}

export function verifyTotp(secret, token, window = 1) {
  if (!secret || !token) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  const clean = String(token).replace(/\s/g, '');
  for (let i = -window; i <= window; i += 1) {
    if (totpCode(secret, counter + i) === clean) return true;
  }
  return false;
}

export function otpAuthUrl({ secret, email, schoolName }) {
  const label = encodeURIComponent(`${schoolName}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(schoolName)}&digits=6&period=30`;
}

/* ------------------------------ login limits ----------------------------- */

export function checkLoginAllowed(user, policy) {
  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
    throw new ApiError(429, `Account temporarily locked. Try again in ${mins} minute(s).`);
  }
  if (user && user.status !== 'active') {
    throw new ApiError(403, `This account is ${user.status}. Contact your school administrator.`);
  }
  if (!user) {
    throw new ApiError(401, 'Invalid email or password');
  }
  return policy;
}

export function registerFailedLogin(user, policy) {
  if (!user) return;
  const attempts = (user.failed_attempts || 0) + 1;
  const lock = attempts >= policy.maxAttempts
    ? new Date(Date.now() + policy.lockoutMinutes * 60_000).toISOString()
    : null;
  db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(attempts, lock, user.id);
}

export { SESSION_COOKIE };
