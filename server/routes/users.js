import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso, newId } from '../db/index.js';
import { validateBody, pagination, searchTerm, sorting } from '../lib/validate.js';
import { requirePermission } from '../lib/auth.js';
import { badRequest, conflict, notFound, asyncHandler, forbidden } from '../lib/errors.js';
import { hashPassword, generatePassword, passwordPolicy, validatePassword, revokeAllUserSessions, effectivePermissions } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { ALL_PERMISSIONS, PERMISSION_CATALOG } from '../lib/permissions.js';

const router = Router();

const USER_FIELDS = `u.id, u.email, u.full_name, u.phone, u.role, u.role_id, u.department, u.designation,
  u.avatar_url, u.status, u.two_factor_enabled, u.last_login_at, u.created_at, u.must_change_password,
  r.name AS role_name`;

router.get('/', requirePermission('settings.users', 'employees.view', 'settings.permissions'), asyncHandler(async (req, res) => {
  const { limit, offset, page } = pagination(req);
  const q = searchTerm(req);
  const { clause } = sorting(req, ['full_name', 'email', 'role', 'created_at', 'last_login_at'], 'full_name');
  const where = ['u.school_id = ?'];
  const params = [req.user.school_id];
  if (q) {
    where.push('(u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (req.query.role && req.query.role !== 'all') {
    where.push('u.role = ?');
    params.push(req.query.role);
  }
  if (req.query.status && req.query.status !== 'all') {
    where.push('u.status = ?');
    params.push(req.query.status);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) c FROM users u ${whereSql}`).get(...params).c;
  const items = db.prepare(
    `SELECT ${USER_FIELDS} FROM users u LEFT JOIN roles r ON r.id = u.role_id
     ${whereSql} ORDER BY ${clause} LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

router.get('/:id', requirePermission('settings.users', 'employees.view'), asyncHandler(async (req, res) => {
  const row = db.prepare(
    `SELECT ${USER_FIELDS} FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.school_id = ?`,
  ).get(req.params.id, req.user.school_id);
  if (!row) throw notFound('User not found');
  const overrides = db.prepare('SELECT permission, allowed FROM user_permissions WHERE user_id = ?').all(row.id);
  res.json({ ...row, permissions: effectivePermissions(row), overrides });
}));

const createSchema = z.object({
  full_name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(6).max(200).optional(),
  phone: z.string().max(30).optional().default(''),
  role: z.enum(['principal', 'teacher', 'staff', 'student', 'parent']),
  role_id: z.string().max(64).nullish(),
  department: z.string().max(40).nullish(),
  designation: z.string().max(80).nullish(),
  sendCredentials: z.boolean().optional().default(false),
});

router.post('/', requirePermission('settings.users'), validateBody(createSchema), asyncHandler(async (req, res) => {
  const data = req.data;
  if (data.role === 'principal' && req.user.role !== 'principal') throw forbidden('Only the principal can create principal accounts');
  const exists = db.prepare('SELECT id FROM users WHERE school_id = ? AND lower(email) = lower(?)').get(req.user.school_id, data.email);
  if (exists) throw conflict('A user with this email already exists');

  const policy = passwordPolicy(req.user.school_id);
  const password = data.password || generatePassword(12);
  const problems = validatePassword(password, { ...policy, minLength: 8 });
  if (problems.length) throw badRequest(problems.join('. '));

  let roleId = data.role_id || null;
  if (!roleId) {
    const defaultRole = db.prepare('SELECT id FROM roles WHERE school_id = ? AND base_role = ? AND is_system = 1').get(req.user.school_id, data.role);
    roleId = defaultRole?.id || null;
  }

  const id = newId('usr');
  const at = nowIso();
  db.prepare(
    `INSERT INTO users (id, school_id, email, password_hash, full_name, phone, role, role_id, department, designation,
      status, must_change_password, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, req.user.school_id, data.email.toLowerCase(), hashPassword(password), data.full_name, data.phone,
    data.role, roleId, data.department || null, data.designation || null, 'active', data.password ? 0 : 1,
    req.user.id, at, at,
  );

  audit(req, {
    action: 'create', module: 'users', entityType: 'user', entityId: id,
    summary: `Created ${data.role} account for ${data.full_name}`,
  });
  res.status(201).json({
    id, email: data.email, role: data.role,
    temporaryPassword: data.password ? undefined : password,
    message: 'User account created',
  });
}));

const patchSchema = createSchema.partial().omit({ password: true }).extend({
  status: z.enum(['active', 'suspended', 'disabled', 'invited']).optional(),
});

router.patch('/:id', requirePermission('settings.users'), validateBody(patchSchema), asyncHandler(async (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!existing) throw notFound('User not found');
  if (existing.role === 'principal' && existing.id !== req.user.id && req.user.role !== 'principal') throw forbidden();
  if (req.data.role === 'principal' && existing.role !== 'principal' && req.user.role !== 'principal') throw forbidden();

  const map = {
    full_name: 'full_name', phone: 'phone', email: 'email', role: 'role', role_id: 'role_id',
    department: 'department', designation: 'designation', status: 'status',
  };
  const fields = [];
  const values = [];
  for (const [key, col] of Object.entries(map)) {
    if (req.data[key] !== undefined) {
      fields.push(`${col} = ?`);
      values.push(key === 'email' ? String(req.data[key]).toLowerCase() : req.data[key]);
    }
  }
  if (!fields.length) throw badRequest('Nothing to update');
  values.push(nowIso(), req.params.id, req.user.school_id);
  db.prepare(`UPDATE users SET ${fields.join(', ')}, updated_at = ? WHERE id = ? AND school_id = ?`).run(...values);

  if (req.data.status && req.data.status !== 'active') revokeAllUserSessions(req.params.id);
  audit(req, {
    action: 'update', module: 'users', entityType: 'user', entityId: req.params.id,
    summary: `Updated account ${existing.full_name}`, meta: { changes: req.data },
  });
  res.json({ ok: true });
}));

router.post('/:id/status', requirePermission('settings.users'), validateBody(z.object({
  status: z.enum(['active', 'suspended', 'disabled']),
  reason: z.string().max(300).optional(),
})), asyncHandler(async (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!existing) throw notFound('User not found');
  if (existing.id === req.user.id) throw badRequest('You cannot change the status of your own account');
  if (existing.role === 'principal') throw forbidden('Principal accounts cannot be suspended');

  db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(req.data.status, nowIso(), req.params.id);
  if (req.data.status !== 'active') revokeAllUserSessions(req.params.id);
  audit(req, {
    action: 'status_change', module: 'users', entityType: 'user', entityId: req.params.id,
    summary: `${existing.full_name} set to ${req.data.status}`, meta: { reason: req.data.reason },
  });
  res.json({ ok: true });
}));

router.post('/:id/reset-password', requirePermission('settings.users'), asyncHandler(async (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!existing) throw notFound('User not found');
  if (existing.role === 'principal' && existing.id !== req.user.id) throw forbidden('Principal passwords can only be changed by the principal');
  const password = generatePassword(12);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
    .run(hashPassword(password), nowIso(), req.params.id);
  revokeAllUserSessions(req.params.id);
  audit(req, { action: 'password_reset', module: 'users', entityType: 'user', entityId: req.params.id, summary: `Reset password for ${existing.full_name}` });
  res.json({ temporaryPassword: password, message: 'Share this temporary password securely. The user must change it at next sign in.' });
}));

router.delete('/:id', requirePermission('settings.users'), asyncHandler(async (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!existing) throw notFound('User not found');
  if (existing.id === req.user.id) throw badRequest('You cannot delete your own account');
  if (existing.role === 'principal') throw forbidden('Principal accounts cannot be deleted');

  const linkedStudent = db.prepare('SELECT id FROM students WHERE user_id = ?').get(existing.id);
  if (linkedStudent) throw conflict('This account is linked to a student profile. Suspend it instead.');
  const linkedEmployee = db.prepare('SELECT id FROM employees WHERE user_id = ?').get(existing.id);
  if (linkedEmployee) throw conflict('This account is linked to an employee record. Suspend it instead.');

  db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(existing.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(existing.id);
  audit(req, { action: 'delete', module: 'users', entityType: 'user', entityId: existing.id, summary: `Deleted account ${existing.full_name}` });
  res.json({ ok: true });
}));

/* ------------------------------ per-user grants ---------------------------- */

router.put('/:id/permissions', requirePermission('settings.permissions'), validateBody(z.object({
  overrides: z.array(z.object({ permission: z.string(), allowed: z.boolean() })).max(500),
})), asyncHandler(async (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!existing) throw notFound('User not found');
  if (existing.role === 'principal') throw badRequest('The principal always has full access');

  const invalid = req.data.overrides.filter((o) => !ALL_PERMISSIONS.includes(o.permission));
  if (invalid.length) throw badRequest(`Unknown permissions: ${invalid.map((i) => i.permission).join(', ')}`);

  const run = db.transaction(() => {
    db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(existing.id);
    const stmt = db.prepare('INSERT INTO user_permissions (id, school_id, user_id, permission, allowed) VALUES (?,?,?,?,?)');
    req.data.overrides.forEach((o) => stmt.run(newId('upm'), req.user.school_id, existing.id, o.permission, o.allowed ? 1 : 0));
  });
  run();
  audit(req, {
    action: 'permissions_update', module: 'users', entityType: 'user', entityId: existing.id,
    summary: `Updated permission overrides for ${existing.full_name}`, meta: { count: req.data.overrides.length },
  });
  res.json({ ok: true });
}));

/* ---------------------------------- roles --------------------------------- */

router.get('/meta/roles', requirePermission('settings.permissions', 'settings.users'), asyncHandler(async (req, res) => {
  const roles = db.prepare('SELECT * FROM roles WHERE school_id = ? ORDER BY is_system DESC, name').all(req.user.school_id)
    .map((r) => ({ ...r, permissions: safeJson(r.permissions, []) }));
  const counts = db.prepare('SELECT role_id, COUNT(*) c FROM users WHERE school_id = ? GROUP BY role_id').all(req.user.school_id);
  res.json({ items: roles.map((r) => ({ ...r, userCount: counts.find((c) => c.role_id === r.id)?.c || 0 })), catalog: PERMISSION_CATALOG });
}));

router.post('/meta/roles', requirePermission('settings.permissions'), validateBody(z.object({
  name: z.string().min(2).max(60),
  key: z.string().min(2).max(40).regex(/^[a-z0-9_-]+$/, 'Use lowercase letters, numbers, dashes or underscores'),
  base_role: z.enum(['teacher', 'staff', 'student', 'parent']).default('staff'),
  description: z.string().max(200).optional().default(''),
  permissions: z.array(z.string()).default([]),
})), asyncHandler(async (req, res) => {
  const data = req.data;
  const exists = db.prepare('SELECT id FROM roles WHERE school_id = ? AND key = ?').get(req.user.school_id, data.key);
  if (exists) throw conflict('A role with this key already exists');
  const invalid = data.permissions.filter((p) => !ALL_PERMISSIONS.includes(p) && !p.endsWith('.*'));
  if (invalid.length) throw badRequest(`Unknown permissions: ${invalid.join(', ')}`);

  const id = newId('rol');
  const at = nowIso();
  db.prepare(
    `INSERT INTO roles (id, school_id, key, name, base_role, description, is_system, permissions, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, req.user.school_id, data.key, data.name, data.base_role, data.description, 0, JSON.stringify(data.permissions), at, at);
  audit(req, { action: 'create', module: 'roles', entityType: 'role', entityId: id, summary: `Created custom role ${data.name}` });
  res.status(201).json({ id });
}));

router.patch('/meta/roles/:id', requirePermission('settings.permissions'), validateBody(z.object({
  name: z.string().min(2).max(60).optional(),
  description: z.string().max(200).optional(),
  permissions: z.array(z.string()).optional(),
})), asyncHandler(async (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!role) throw notFound('Role not found');
  if (role.key === 'principal') throw badRequest('The principal role cannot be modified');
  if (role.is_system && req.data.permissions) {
    throw badRequest('Default roles keep their baseline permissions — create a custom role or use per-user overrides');
  }
  if (req.data.permissions) {
    const invalid = req.data.permissions.filter((p) => !ALL_PERMISSIONS.includes(p) && !p.endsWith('.*'));
    if (invalid.length) throw badRequest(`Unknown permissions: ${invalid.join(', ')}`);
  }
  db.prepare('UPDATE roles SET name = ?, description = ?, permissions = COALESCE(?, permissions), updated_at = ? WHERE id = ?')
    .run(req.data.name || role.name, req.data.description ?? role.description,
      req.data.permissions ? JSON.stringify(req.data.permissions) : null, nowIso(), role.id);
  audit(req, { action: 'update', module: 'roles', entityType: 'role', entityId: role.id, summary: `Updated role ${role.name}`, meta: { permissions: req.data.permissions } });
  res.json({ ok: true });
}));

router.delete('/meta/roles/:id', requirePermission('settings.permissions'), asyncHandler(async (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!role) throw notFound('Role not found');
  if (role.is_system) throw badRequest('Default roles cannot be deleted');
  const inUse = db.prepare('SELECT COUNT(*) c FROM users WHERE role_id = ?').get(role.id).c;
  if (inUse) throw conflict(`This role is assigned to ${inUse} user(s). Reassign them first.`);
  db.prepare('DELETE FROM roles WHERE id = ?').run(role.id);
  audit(req, { action: 'delete', module: 'roles', entityType: 'role', entityId: role.id, summary: `Deleted role ${role.name}` });
  res.json({ ok: true });
}));

function safeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export default router;
