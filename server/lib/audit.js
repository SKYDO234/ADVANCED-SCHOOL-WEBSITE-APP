import { db, nowIso, newId } from '../db/index.js';

/** Record a sensitive action. Never throws — auditing must not break the request. */
export function audit(req, { action, module, entityType, entityId, summary, meta }) {
  try {
    const user = req?.user;
    if (!user) return;
    db.prepare(
      `INSERT INTO audit_logs (id, school_id, user_id, actor_name, actor_role, action, module, entity_type, entity_id, summary, meta, ip, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      newId('aud'), user.school_id, user.id, user.full_name, `${user.role}${user.department ? `:${user.department}` : ''}`,
      action, module, entityType || null, entityId || null, summary || null,
      meta ? JSON.stringify(meta) : null,
      req.ip || null, nowIso(),
    );
  } catch (err) {
    console.error('[audit] failed', err.message);
  }
}

export function systemAudit({ schoolId, userId, actorName, action, module, summary, meta }) {
  try {
    db.prepare(
      `INSERT INTO audit_logs (id, school_id, user_id, actor_name, actor_role, action, module, summary, meta, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(newId('aud'), schoolId, userId || null, actorName || 'system', 'system', action, module, summary || null,
      meta ? JSON.stringify(meta) : null, nowIso());
  } catch (err) {
    console.error('[audit] failed', err.message);
  }
}

/** Create in-app notifications for a set of user ids. */
export function notifyUsers(schoolId, userIds, { title, body, type = 'info', link = null }) {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return 0;
  const stmt = db.prepare(
    'INSERT INTO notifications (id, school_id, user_id, title, body, type, link, created_at) VALUES (?,?,?,?,?,?,?,?)',
  );
  const at = nowIso();
  const run = db.transaction((ids) => ids.forEach((uid) =>
    stmt.run(newId('ntf'), schoolId, uid, title, body || null, type, link, at)));
  run(unique);
  return unique.length;
}

export function notifyRole(schoolId, role, payload) {
  const ids = db.prepare('SELECT id FROM users WHERE school_id = ? AND role = ? AND status = ?').all(schoolId, role, 'active');
  return notifyUsers(schoolId, ids.map((r) => r.id), payload);
}
