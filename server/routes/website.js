import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso, newId, getAllSettings, setSetting, getSetting } from '../db/index.js';
import { validateBody, pagination } from '../lib/validate.js';
import { requirePermission } from '../lib/auth.js';
import { badRequest, notFound, asyncHandler } from '../lib/errors.js';
import { audit } from '../lib/audit.js';

export const publicRouter = Router();

/** Public payload used by the marketing website and the login screen. */
publicRouter.get('/site', asyncHandler(async (req, res) => {
  const school = db.prepare('SELECT * FROM schools ORDER BY created_at LIMIT 1').get();
  if (!school) return res.json({ needsSetup: true });
  const website = getAllSettings(school.id, 'website');
  const pages = db.prepare('SELECT slug, title, sort_order FROM website_pages WHERE school_id = ? AND is_published = 1 AND show_in_nav = 1 ORDER BY sort_order')
    .all(school.id);
  const news = db.prepare('SELECT id, title, excerpt, cover_url, category, published_at FROM news_posts WHERE school_id = ? AND is_published = 1 ORDER BY published_at DESC LIMIT 6')
    .all(school.id);
  res.json({
    school: {
      id: school.id, name: school.name, tagline: school.tagline, logo_url: school.logo_url, favicon_url: school.favicon_url,
      address: school.address, city: school.city, state: school.state, pincode: school.pincode, phone: school.phone,
      email: school.email, website: school.website, affiliation: school.affiliation, principal_name: school.principal_name,
      currency_symbol: school.currency_symbol, is_demo: Boolean(school.is_demo),
    },
    website,
    pages,
    news,
  });
}));

publicRouter.get('/pages/:slug', asyncHandler(async (req, res) => {
  const school = db.prepare('SELECT * FROM schools ORDER BY created_at LIMIT 1').get();
  if (!school) throw notFound('No school configured');
  const page = db.prepare('SELECT * FROM website_pages WHERE school_id = ? AND slug = ? AND is_published = 1').get(school.id, req.params.slug);
  if (!page) throw notFound('Page not found');
  res.json({ ...page, blocks: safeParse(page.blocks, []) });
}));

publicRouter.get('/news', asyncHandler(async (req, res) => {
  const school = db.prepare('SELECT * FROM schools ORDER BY created_at LIMIT 1').get();
  if (!school) return res.json({ items: [] });
  const items = db.prepare('SELECT * FROM news_posts WHERE school_id = ? AND is_published = 1 ORDER BY published_at DESC LIMIT 50')
    .all(school.id);
  res.json({ items });
}));

publicRouter.get('/news/:id', asyncHandler(async (req, res) => {
  const school = db.prepare('SELECT * FROM schools ORDER BY created_at LIMIT 1').get();
  const post = db.prepare('SELECT * FROM news_posts WHERE id = ? AND school_id = ? AND is_published = 1').get(req.params.id, school?.id);
  if (!post) throw notFound('Post not found');
  res.json(post);
}));

publicRouter.post('/admissions/inquiry', validateBody(z.object({
  student_name: z.string().min(2).max(120),
  parent_name: z.string().max(120).optional().default(''),
  email: z.string().email().optional().or(z.literal('')).default(''),
  phone: z.string().min(6).max(20),
  class_applied: z.string().max(40).optional().default(''),
  message: z.string().max(2000).optional().default(''),
})), asyncHandler(async (req, res) => {
  const school = db.prepare('SELECT * FROM schools ORDER BY created_at LIMIT 1').get();
  if (!school) throw badRequest('School is not configured yet');
  if (getSetting(school.id, 'website', 'admissionsOpen', true) === false) {
    throw badRequest('Admissions are currently closed. Please contact the school office.');
  }
  const id = newId('inq');
  db.prepare(
    `INSERT INTO admission_inquiries (id, school_id, student_name, parent_name, email, phone, class_applied, message, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, school.id, req.data.student_name, req.data.parent_name, req.data.email, req.data.phone,
    req.data.class_applied, req.data.message, 'new', nowIso());
  db.prepare(
    'INSERT INTO audit_logs (id, school_id, user_id, actor_name, actor_role, action, module, entity_type, entity_id, summary, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(newId('aud'), school.id, null, req.data.parent_name || req.data.student_name, 'public', 'inquiry', 'website',
    'admission_inquiry', id, `Admission inquiry for ${req.data.student_name}`, nowIso());
  res.status(201).json({ ok: true, message: 'Thank you! Our admissions team will contact you shortly.' });
}));

publicRouter.post('/contact', validateBody(z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().optional().or(z.literal('')).default(''),
  phone: z.string().max(20).optional().default(''),
  subject: z.string().max(160).optional().default(''),
  message: z.string().min(5).max(2000),
})), asyncHandler(async (req, res) => {
  const school = db.prepare('SELECT * FROM schools ORDER BY created_at LIMIT 1').get();
  if (!school) throw badRequest('School is not configured yet');
  const id = newId('msg');
  db.prepare('INSERT INTO contact_messages (id, school_id, name, email, phone, subject, message, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, school.id, req.data.name, req.data.email, req.data.phone, req.data.subject, req.data.message, 'new', nowIso());
  res.status(201).json({ ok: true, message: 'Message sent. We will get back to you soon.' });
}));

function safeParse(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

/* ------------------------------- admin router ------------------------------ */

const router = Router();

router.get('/pages', requirePermission('website.view', 'settings.customize'), asyncHandler(async (req, res) => {
  const items = db.prepare('SELECT * FROM website_pages WHERE school_id = ? ORDER BY sort_order').all(req.user.school_id)
    .map((p) => ({ ...p, blocks: safeParse(p.blocks, []) }));
  res.json({ items, settings: getAllSettings(req.user.school_id, 'website') });
}));

router.post('/pages', requirePermission('website.manage'), validateBody(z.object({
  slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and dashes'),
  title: z.string().min(2).max(120),
})), asyncHandler(async (req, res) => {
  const exists = db.prepare('SELECT id FROM website_pages WHERE school_id = ? AND slug = ?').get(req.user.school_id, req.data.slug);
  if (exists) throw badRequest('A page with this slug already exists');
  const order = db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 n FROM website_pages WHERE school_id = ?').get(req.user.school_id).n;
  const id = newId('pg');
  db.prepare('INSERT INTO website_pages (id, school_id, slug, title, content, blocks, is_published, show_in_nav, sort_order, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.user.school_id, req.data.slug, req.data.title, '', JSON.stringify([{ type: 'richText' }]), 1, 1, order, nowIso());
  audit(req, { action: 'create', module: 'website', entityType: 'page', entityId: id, summary: `Created page ${req.data.title}` });
  res.status(201).json({ id });
}));

router.patch('/pages/:id', requirePermission('website.manage'), validateBody(z.object({
  title: z.string().max(120).optional(),
  content: z.string().max(20000).optional(),
  blocks: z.array(z.any()).max(40).optional(),
  is_published: z.boolean().optional(),
  show_in_nav: z.boolean().optional(),
  sort_order: z.coerce.number().int().min(0).max(99).optional(),
})), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM website_pages WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Page not found');
  const d = req.data;
  db.prepare('UPDATE website_pages SET title = ?, content = ?, blocks = ?, is_published = ?, show_in_nav = ?, sort_order = ?, updated_at = ? WHERE id = ?')
    .run(d.title ?? row.title, d.content ?? row.content,
      d.blocks ? JSON.stringify(d.blocks) : row.blocks,
      d.is_published === undefined ? row.is_published : (d.is_published ? 1 : 0),
      d.show_in_nav === undefined ? row.show_in_nav : (d.show_in_nav ? 1 : 0),
      d.sort_order ?? row.sort_order, nowIso(), row.id);
  audit(req, { action: 'update', module: 'website', entityType: 'page', entityId: row.id, summary: `Updated page ${d.title || row.title}` });
  res.json({ ok: true });
}));

router.delete('/pages/:id', requirePermission('website.manage'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM website_pages WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Page not found');
  if (row.slug === 'home') throw badRequest('The home page cannot be deleted');
  db.prepare('DELETE FROM website_pages WHERE id = ?').run(row.id);
  audit(req, { action: 'delete', module: 'website', entityType: 'page', entityId: row.id, summary: `Deleted page ${row.title}` });
  res.json({ ok: true });
}));

router.post('/news', requirePermission('website.manage'), validateBody(z.object({
  title: z.string().min(3).max(200),
  excerpt: z.string().max(400).optional().default(''),
  body: z.string().max(20000).optional().default(''),
  cover_url: z.string().max(300).nullish(),
  category: z.enum(['news', 'event', 'notice', 'achievement']).optional().default('news'),
  is_published: z.boolean().optional().default(true),
})), asyncHandler(async (req, res) => {
  const id = newId('nws');
  db.prepare(
    `INSERT INTO news_posts (id, school_id, title, excerpt, body, cover_url, category, author, is_published, published_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, req.user.school_id, req.data.title, req.data.excerpt, req.data.body, req.data.cover_url || null,
    req.data.category, req.user.full_name, req.data.is_published ? 1 : 0, nowIso(), nowIso());
  audit(req, { action: 'create', module: 'website', entityType: 'news', entityId: id, summary: `Published news "${req.data.title}"` });
  res.status(201).json({ id });
}));

router.patch('/news/:id', requirePermission('website.manage'), validateBody(z.object({
  title: z.string().max(200).optional(),
  excerpt: z.string().max(400).optional(),
  body: z.string().max(20000).optional(),
  cover_url: z.string().max(300).nullish(),
  category: z.string().max(30).optional(),
  is_published: z.boolean().optional(),
})), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM news_posts WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Post not found');
  const d = req.data;
  db.prepare('UPDATE news_posts SET title = ?, excerpt = ?, body = ?, cover_url = ?, category = ?, is_published = ? WHERE id = ?')
    .run(d.title ?? row.title, d.excerpt ?? row.excerpt, d.body ?? row.body,
      d.cover_url === undefined ? row.cover_url : d.cover_url, d.category ?? row.category,
      d.is_published === undefined ? row.is_published : (d.is_published ? 1 : 0), row.id);
  res.json({ ok: true });
}));

router.delete('/news/:id', requirePermission('website.manage'), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM news_posts WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Post not found');
  db.prepare('DELETE FROM news_posts WHERE id = ?').run(row.id);
  audit(req, { action: 'delete', module: 'website', entityType: 'news', entityId: row.id, summary: `Deleted post "${row.title}"` });
  res.json({ ok: true });
}));

router.put('/settings', requirePermission('website.manage', 'settings.customize'), validateBody(z.object({
  heroTitle: z.string().max(160).optional(),
  heroSubtitle: z.string().max(300).optional(),
  heroImage: z.string().max(400).optional(),
  aboutText: z.string().max(4000).optional(),
  stats: z.array(z.object({ label: z.string().max(40), value: z.string().max(20) })).max(6).optional(),
  contactPhone: z.string().max(30).optional(),
  contactEmail: z.string().max(120).optional(),
  admissionsOpen: z.boolean().optional(),
})), asyncHandler(async (req, res) => {
  for (const [key, value] of Object.entries(req.data)) {
    if (value !== undefined) setSetting(req.user.school_id, 'website', key, value, req.user.id);
  }
  audit(req, { action: 'update', module: 'website', summary: 'Updated website content', meta: { keys: Object.keys(req.data) } });
  res.json({ ok: true, settings: getAllSettings(req.user.school_id, 'website') });
}));

/* --------------------------- admissions pipeline -------------------------- */

router.get('/inquiries', requirePermission('website.admissions'), asyncHandler(async (req, res) => {
  const { limit, offset, page } = pagination(req, { defaultLimit: 50 });
  const where = ['school_id = ?'];
  const params = [req.user.school_id];
  if (req.query.status && req.query.status !== 'all') { where.push('status = ?'); params.push(req.query.status); }
  if (req.query.q) { where.push('(student_name LIKE ? OR phone LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) c FROM admission_inquiries ${whereSql}`).get(...params).c;
  const items = db.prepare(`SELECT * FROM admission_inquiries ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  const counts = db.prepare('SELECT status, COUNT(*) c FROM admission_inquiries WHERE school_id = ? GROUP BY status').all(req.user.school_id);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1, counts });
}));

router.patch('/inquiries/:id', requirePermission('website.admissions'), validateBody(z.object({
  status: z.enum(['new', 'contacted', 'enrolled', 'rejected']).optional(),
  notes: z.string().max(1000).optional(),
})), asyncHandler(async (req, res) => {
  const row = db.prepare('SELECT * FROM admission_inquiries WHERE id = ? AND school_id = ?').get(req.params.id, req.user.school_id);
  if (!row) throw notFound('Inquiry not found');
  db.prepare('UPDATE admission_inquiries SET status = ?, notes = ? WHERE id = ?')
    .run(req.data.status ?? row.status, req.data.notes ?? row.notes, row.id);
  audit(req, { action: 'update', module: 'website', entityType: 'admission_inquiry', entityId: row.id, summary: `Inquiry for ${row.student_name} set to ${req.data.status || row.status}` });
  res.json({ ok: true });
}));

router.get('/contact-messages', requirePermission('website.admissions'), asyncHandler(async (req, res) => {
  const items = db.prepare('SELECT * FROM contact_messages WHERE school_id = ? ORDER BY created_at DESC LIMIT 200').all(req.user.school_id);
  res.json({ items });
}));

router.patch('/contact-messages/:id', requirePermission('website.admissions'), validateBody(z.object({
  status: z.enum(['new', 'read', 'replied', 'archived']),
})), asyncHandler(async (req, res) => {
  db.prepare('UPDATE contact_messages SET status = ? WHERE id = ? AND school_id = ?').run(req.data.status, req.params.id, req.user.school_id);
  res.json({ ok: true });
}));

export default router;
