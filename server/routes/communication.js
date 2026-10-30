import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso, newId } from '../db/index.js';
import { validateBody, pagination } from '../lib/validate.js';
import { requirePermission } from '../lib/auth.js';
import { badRequest, forbidden, notFound, asyncHandler } from '../lib/errors.js';
import { audit, notifyUsers, notifyRole } from '../lib/audit.js';
import { enqueueMessage, processOutbox, isEmailConfigured, isSmsConfigured } from '../lib/integrations.js';
import { notifyClass, notifyRoles } from '../lib/notify.js';
import { currentSession } from '../lib/defaults.js';

const router = Router();

/* ------------------------------- announcements ---------------------------- */

router.get('/announcements', requirePermission('communication.view'), asyncHandler(async (req, res) => {
  const { limit, offset, page } = pagination(req);
  const where = ['a.school_id = ?'];
  const params = [req.user.school_id];

  if (['student', 'parent'].includes(req.user.role)) {
    const ids = req.user.role === 'student'
      ? [db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.user.id)?.id].filter(Boolean)
      : db.prepare('SELECT student_id id FROM parent_students WHERE parent_user_id = ?').all(req.user.id).map((r) => r.id);
    const students = ids.length
      ? db.prepare(`SELECT class_id, section_id FROM students WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
      : [];
    const roleTarget = req.user.role;
    const audienceSql = `(a.audience = 'all' OR a.audience = '${roleTarget}s' OR a.audience = '${roleTarget}' OR (a.audience = 'class' AND ${students.length ? students.map(() => '(a.class_id = ? AND (a.section_id IS NULL OR a.section_id = ?))').join(' OR ') : '0'}))`;
    where.push(audienceSql);
    students.forEach((s) => params.push(s.class_id, s.section_id));
  } else {
    if (req.query.audience && req.query.audience !== 'all') { where.push('a.audience = ?'); params.push(req.query.audience); }
  }
  if (req.query.priority && req.query.priority !== 'all') { where.push('a.priority = ?'); params.push(req.query.priority); }
  if (req.query.q) { where.push('(a.title LIKE ? OR a.body LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  where.push('a.publish_at <= ?');
  params.push(new Date().toISOString());

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) c FROM announcements a ${whereSql}`).get(...params).c;
  const items = db.prepare(
    `SELECT a.*, u.full_name AS author_name, c.name AS class_name, sec.name AS section_name
     FROM announcements a LEFT JOIN users u ON u.id = a.created_by
     LEFT JOIN classes c ON c.id = a.class_id LEFT JOIN sections sec ON sec.id = a.section_id
     ${whereSql} ORDER BY a.publish_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

const announcementSchema = z.object({
  title: z.string().min(3).max(160),
  body: z.string().min(3).max(6000),
  audience: z.enum(['all', 'students', 'parents', 'teachers', 'staff', 'class', 'role']).default('all'),
  role_target: z.string().max(30).nullish(),
  class_id: z.string().nullish(),
  section_id: z.string().nullish(),
  priority: z.enum(['normal', 'high', 'emergency']).default('normal'),
  attachment_url: z.string().max(300).nullish(),
  publish_at: z.string().max(40).optional(),
  expires_at: z.string().max(40).nullish(),
  send_email: z.boolean().optional().default(false),
  send_sms: z.boolean().optional().default(false),
});

function announcementRecipients(schoolId, ann) {
  let users = [];
  if (ann.audience === 'all') {
    users = db.prepare("SELECT id, email, phone FROM users WHERE school_id = ? AND status = 'active'").all(schoolId);
  } else if (ann.audience === 'class') {
    const students = db.prepare(
      `SELECT id, user_id FROM students WHERE school_id = ? AND class_id = ?
       AND (? IS NULL OR section_id = ?) AND status = 'active'`,
    ).all(schoolId, ann.class_id, ann.section_id, ann.section_id);
    const ids = students.map((s) => s.user_id).filter(Boolean);
    if (students.length) {
      const parents = db.prepare(
        `SELECT parent_user_id FROM parent_students WHERE student_id IN (${students.map(() => '?').join(',')})`,
      ).all(...students.map((s) => s.id));
      ids.push(...parents.map((p) => p.parent_user_id));
    }
    users = ids.length ? db.prepare(`SELECT id, email, phone FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
  } else if (ann.audience === 'role' && ann.role_target) {
    users = db.prepare("SELECT id, email, phone FROM users WHERE school_id = ? AND role = ? AND status = 'active'").all(schoolId, ann.role_target);
  } else {
    const roleMap = { students: 'student', parents: 'parent', teachers: 'teacher', staff: 'staff' };
    users = db.prepare("SELECT id, email, phone FROM users WHERE school_id = ? AND role = ? AND status = 'active'")
      .all(schoolId, roleMap[ann.audience] || 'student');
  }
  return users;
}

router.post('/announcements', requirePermission('communication.create'), validateBody(announcementSchema), asyncHandler(async (req, res) => {
  const d = req.data;
  if (d.audience === 'class' && !d.class_id) throw badRequest('Select a class for a class announcement');
  if (d.priority === 'emergency' && req.user.role !== 'principal' && !req.user.permissions.includes('communication.send_emergency')) {
    throw forbidden('Only the principal can send emergency alerts');
  }
  if (req.user.role === 'teacher') {
    const session = currentSession(req.user.school_id);
    const owns = db.prepare(
      'SELECT 1 FROM class_subjects WHERE school_id = ? AND session_id = ? AND teacher_id = ? AND class_id = ? LIMIT 1',
    ).get(req.user.school_id, session?.id, req.user.id, d.class_id);
    if (d.audience !== 'class' || !owns) throw forbidden('Teachers can post announcements to their own classes only');
  }

  const id = newId('ann');
  const publishAt = d.publish_at || new Date().toISOString();
  db.prepare(
    `INSERT INTO announcements (id, school_id, title, body, audience, role_target, class_id, section_id, priority,
      attachment_url, publish_at, expires_at, send_email, send_sms, send_push, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, req.user.school_id, d.title, d.body, d.audience, d.role_target || null, d.class_id || null,
    d.section_id || null, d.priority, d.attachment_url || null, publishAt, d.expires_at || null,
    d.send_email ? 1 : 0, d.send_sms ? 1 : 0, 1, req.user.id, nowIso());

  const recipients = announcementRecipients(req.user.school_id, { ...d, section_id: d.section_id || null });
  const notificationType = d.priority === 'emergency' ? 'emergency' : d.priority === 'high' ? 'warning' : 'info';
  notifyUsers(req.user.school_id, recipients.map((r) => r.id), {
    title: d.title, body: d.body.slice(0, 300), type: notificationType, link: '/app/announcements',
  });

  let queued = 0;
  if (d.send_email || d.send_sms) {
    for (const user of recipients) {
      if (d.send_email && user.email) { enqueueMessage(req.user.school_id, { channel: 'email', recipient: user.email, subject: d.title, body: d.body }); queued += 1; }
      if (d.send_sms && user.phone) { enqueueMessage(req.user.school_id, { channel: 'sms', recipient: user.phone, subject: d.title, body: `${d.title}: ${d.body.slice(0, 140)}` }); queued += 1; }
    }
    await processOutbox(req.user.school_id, { limit: 25 });
  }

  audit(req, {
    action: 'create', module: 'communication', entityType: 'announcement', entityId: id,
    summary: `Announcement "${d.title}" to ${d.audience}`, meta: { recipients: recipients.length, queued },
  });
  res.status(201).json({ id, recipients: recipients.length, queued });
}));

router.patch('/announcements/:id', requirePermission('communication.create'), validateBody(announcementSchema.partial()), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM announcements WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Announcement not found');
  if (req.user.role === 'teacher' && row.created_by !== req.user.id) throw forbidden();
  const d = req.data;
  db.prepare(
    `UPDATE announcements SET title = ?, body = ?, priority = ?, expires_at = ?, attachment_url = ? WHERE id = ?`,
  ).run(d.title ?? row.title, d.body ?? row.body, d.priority ?? row.priority,
    d.expires_at === undefined ? row.expires_at : d.expires_at, d.attachment_url === undefined ? row.attachment_url : d.attachment_url, row.id);
  audit(req, { action: 'update', module: 'communication', entityType: 'announcement', entityId: row.id, summary: `Updated announcement "${d.title || row.title}"` });
  res.json({ ok: true });
}));

router.delete('/announcements/:id', requirePermission('communication.delete', 'communication.create'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM announcements WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Announcement not found');
  if (req.user.role === 'teacher' && row.created_by !== req.user.id) throw forbidden('You can only delete your own announcements');
  db.prepare('DELETE FROM announcements WHERE id = ?').run(row.id);
  audit(req, { action: 'delete', module: 'communication', entityType: 'announcement', entityId: row.id, summary: `Deleted announcement "${row.title}"` });
  res.json({ ok: true });
}));

/* --------------------------------- messages ------------------------------- */

router.get('/contacts', requirePermission('communication.message'), asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const role = req.query.role;
  const where = ['school_id = ?', "status = 'active'", 'id != ?'];
  const params = [req.user.school_id, req.user.id];
  if (q) { where.push('(full_name LIKE ? OR email LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (role && role !== 'all') { where.push('role = ?'); params.push(role); }
  else if (req.user.role === 'parent' || req.user.role === 'student') where.push("role IN ('teacher','principal')");
  const items = db.prepare(
    `SELECT id, full_name, email, role, department, designation, avatar_url FROM users
     WHERE ${where.join(' AND ')} ORDER BY full_name LIMIT 30`,
  ).all(...params);
  res.json({ items });
}));

router.get('/threads', requirePermission('communication.message', 'communication.view'), asyncHandler(async (req, res) => {
  const rows = db.prepare(
    `SELECT t.*,
       CASE WHEN t.participant_a = ? THEN ub.full_name ELSE ua.full_name END AS other_name,
       CASE WHEN t.participant_a = ? THEN ub.role ELSE ua.role END AS other_role,
       CASE WHEN t.participant_a = ? THEN t.participant_b ELSE t.participant_a END AS other_id,
       (SELECT body FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
       (SELECT created_at FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_at,
       (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id AND m.read_at IS NULL AND m.sender_id != ?) AS unread,
       s.full_name AS student_name
     FROM message_threads t
     LEFT JOIN users ua ON ua.id = t.participant_a
     LEFT JOIN users ub ON ub.id = t.participant_b
     LEFT JOIN students s ON s.id = t.student_id
     WHERE t.school_id = ? AND (t.participant_a = ? OR t.participant_b = ?)
     ORDER BY COALESCE(t.last_message_at, t.created_at) DESC LIMIT 100`,
  ).all(req.user.id, req.user.id, req.user.id, req.user.id, req.user.school_id, req.user.id, req.user.id);
  res.json({ items: rows });
}));

router.get('/threads/:id', requirePermission('communication.message', 'communication.view'), asyncHandler(async (req, res) => {
  const thread = db.prepare('SELECT * FROM message_threads WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!thread) throw notFound('Conversation not found');
  if (thread.participant_a !== req.user.id && thread.participant_b !== req.user.id && req.user.role !== 'principal') {
    throw forbidden('You are not part of this conversation');
  }
  const messages = db.prepare(
    `SELECT m.*, u.full_name AS sender_name, u.role AS sender_role, u.avatar_url
     FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.thread_id = ? ORDER BY m.created_at`,
  ).all(thread.id);
  db.prepare('UPDATE messages SET read_at = ? WHERE thread_id = ? AND sender_id != ? AND read_at IS NULL')
    .run(nowIso(), thread.id, req.user.id);

  const otherId = thread.participant_a === req.user.id ? thread.participant_b : thread.participant_a;
  const other = db.prepare('SELECT id, full_name, email, role, department, designation FROM users WHERE id = ?').get(otherId);
  res.json({ thread, messages, other });
}));

router.post('/threads', requirePermission('communication.message'), validateBody(z.object({
  participant_id: z.string().min(1),
  subject: z.string().max(160).optional().default(''),
  student_id: z.string().nullish(),
  body: z.string().min(1).max(4000),
})), asyncHandler(async (req, res) => {
  const recipient = db.prepare('SELECT * FROM users WHERE id = ? AND school_id = ?').get(req.data.participant_id, req.user.school_id);
  if (!recipient) throw notFound('Recipient not found');
  if (recipient.id === req.user.id) throw badRequest('You cannot message yourself');

  let thread = db.prepare(
    `SELECT * FROM message_threads WHERE school_id = ? AND ((participant_a = ? AND participant_b = ?) OR (participant_a = ? AND participant_b = ?))
     AND ifnull(student_id,'') = ifnull(?,'') LIMIT 1`,
  ).get(req.user.school_id, req.user.id, recipient.id, recipient.id, req.user.id, req.data.student_id || null);

  if (!thread) {
    const id = newId('thr');
    db.prepare('INSERT INTO message_threads (id, school_id, subject, student_id, participant_a, participant_b, last_message_at, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, req.user.school_id, req.data.subject || null, req.data.student_id || null, req.user.id, recipient.id, nowIso(), nowIso());
    thread = db.prepare('SELECT * FROM message_threads WHERE id = ?').get(id);
  }

  const msgId = newId('msg');
  db.prepare('INSERT INTO messages (id, school_id, thread_id, sender_id, body, created_at) VALUES (?,?,?,?,?,?)')
    .run(msgId, req.user.school_id, thread.id, req.user.id, req.data.body, nowIso());
  db.prepare('UPDATE message_threads SET last_message_at = ?, subject = COALESCE(subject, ?) WHERE id = ?')
    .run(nowIso(), req.data.subject || null, thread.id);

  notifyUsers(req.user.school_id, [recipient.id], {
    title: `New message from ${req.user.full_name}`,
    body: req.data.body.slice(0, 200),
    type: 'info', link: `/app/messages/${thread.id}`,
  });
  audit(req, { action: 'message', module: 'communication', entityType: 'thread', entityId: thread.id, summary: `Messaged ${recipient.full_name}` });
  res.status(201).json({ threadId: thread.id, messageId: msgId });
}));

router.post('/threads/:id/messages', requirePermission('communication.message'), validateBody(z.object({
  body: z.string().min(1).max(4000),
})), asyncHandler(async (req, res) => {
  const thread = db.prepare('SELECT * FROM message_threads WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!thread) throw notFound('Conversation not found');
  if (thread.participant_a !== req.user.id && thread.participant_b !== req.user.id) throw forbidden('You are not part of this conversation');
  const id = newId('msg');
  db.prepare('INSERT INTO messages (id, school_id, thread_id, sender_id, body, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, req.user.school_id, thread.id, req.user.id, req.data.body, nowIso());
  db.prepare('UPDATE message_threads SET last_message_at = ? WHERE id = ?').run(nowIso(), thread.id);
  const otherId = thread.participant_a === req.user.id ? thread.participant_b : thread.participant_a;
  notifyUsers(req.user.school_id, [otherId], {
    title: `New message from ${req.user.full_name}`, body: req.data.body.slice(0, 200), type: 'info', link: `/app/messages/${thread.id}`,
  });
  res.status(201).json({ id });
}));

/* ------------------------------- notifications ---------------------------- */

router.get('/notifications', asyncHandler(async (req, res) => {
  const { limit } = pagination(req, { defaultLimit: 30 });
  const items = db.prepare('SELECT * FROM notifications WHERE school_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(req.user.school_id, req.user.id, limit);
  const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE school_id = ? AND user_id = ? AND read_at IS NULL')
    .get(req.user.school_id, req.user.id).c;
  res.json({ items, unread });
}));

router.post('/notifications/:id/read', asyncHandler(async (req, res) => {
  db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?').run(nowIso(), req.params.id, req.user.id);
  res.json({ ok: true });
}));

router.post('/notifications/read-all', asyncHandler(async (req, res) => {
  db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(nowIso(), req.user.id);
  res.json({ ok: true });
}));

router.delete('/notifications/:id', asyncHandler(async (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
}));

/* -------------------------------- templates ------------------------------- */

router.get('/templates', requirePermission('communication.templates'), asyncHandler(async (req, res) => {
  res.json({
    items: db.prepare('SELECT * FROM notification_templates WHERE school_id = ? ORDER BY name').all(req.user.school_id),
    integrations: { email: isEmailConfigured(req.user.school_id), sms: isSmsConfigured(req.user.school_id) },
  });
}));

router.patch('/templates/:id', requirePermission('communication.templates'), validateBody(z.object({
  subject: z.string().max(200).optional(),
  body: z.string().max(4000).optional(),
  name: z.string().max(80).optional(),
})), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM notification_templates WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Template not found');
  db.prepare('UPDATE notification_templates SET name = ?, subject = ?, body = ?, updated_at = ? WHERE id = ?')
    .run(req.data.name ?? row.name, req.data.subject ?? row.subject, req.data.body ?? row.body, nowIso(), row.id);
  audit(req, { action: 'update', module: 'communication', entityType: 'template', entityId: row.id, summary: `Updated template ${row.name}` });
  res.json({ ok: true });
}));

/* ---------------------------------- outbox -------------------------------- */

router.get('/outbox', requirePermission('communication.templates'), asyncHandler(async (req, res) => {
  const items = db.prepare('SELECT * FROM outbox WHERE school_id = ? ORDER BY created_at DESC LIMIT 200').all(req.user.school_id);
  const stats = db.prepare('SELECT status, COUNT(*) c FROM outbox WHERE school_id = ? GROUP BY status').all(req.user.school_id);
  res.json({ items, stats });
}));

router.post('/outbox/process', requirePermission('communication.templates'), asyncHandler(async (req, res) => {
  const result = await processOutbox(req.user.school_id, { limit: 50 });
  audit(req, { action: 'dispatch', module: 'communication', summary: `Outbox processed: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped` });
  res.json(result);
}));

router.delete('/outbox/:id', requirePermission('communication.templates'), asyncHandler(async (req, res) => {
  db.prepare("DELETE FROM outbox WHERE id = ? AND school_id = ? AND status != 'sent'").run(req.params.id, req.user.school_id);
  res.json({ ok: true });
}));

/* --------------------------------- digest --------------------------------- */

router.get('/summary', asyncHandler(async (req, res) => {
  const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE school_id = ? AND user_id = ? AND read_at IS NULL')
    .get(req.user.school_id, req.user.id).c;
  const threads = db.prepare(
    'SELECT COUNT(*) c FROM message_threads WHERE school_id = ? AND (participant_a = ? OR participant_b = ?)',
  ).get(req.user.school_id, req.user.id, req.user.id).c;
  const announcements = db.prepare(
    'SELECT COUNT(*) c FROM announcements WHERE school_id = ? AND publish_at <= ?',
  ).get(req.user.school_id, new Date().toISOString()).c;
  res.json({ unread, threads, announcements });
}));

export default router;
