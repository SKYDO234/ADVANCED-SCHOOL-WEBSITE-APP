import { Router } from 'express';
import { db, getAllSettings, getSetting } from '../db/index.js';
import { asyncHandler } from '../lib/errors.js';
import { PERMISSION_CATALOG } from '../lib/permissions.js';
import { isEmailConfigured, isSmsConfigured, isGatewayReady } from '../lib/integrations.js';
import { currentSession } from '../lib/defaults.js';

const router = Router();

router.get('/bootstrap', asyncHandler(async (req, res) => {
  const schoolId = req.user.school_id;
  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId);
  const sessions = db.prepare('SELECT * FROM academic_sessions WHERE school_id = ? ORDER BY start_date DESC').all(schoolId);
  const current = sessions.find((s) => s.is_current) || sessions[0] || null;

  const classes = db.prepare('SELECT * FROM classes WHERE school_id = ? ORDER BY order_index, name').all(schoolId);
  const sections = db.prepare('SELECT * FROM sections WHERE school_id = ? ORDER BY name').all(schoolId);
  const subjects = db.prepare('SELECT * FROM subjects WHERE school_id = ? ORDER BY name').all(schoolId);

  const stats = {
    students: db.prepare("SELECT COUNT(*) c FROM students WHERE school_id = ? AND status = 'active'").get(schoolId).c,
    teachers: db.prepare("SELECT COUNT(*) c FROM users WHERE school_id = ? AND role = 'teacher' AND status = 'active'").get(schoolId).c,
    staff: db.prepare("SELECT COUNT(*) c FROM users WHERE school_id = ? AND role = 'staff' AND status = 'active'").get(schoolId).c,
    classes: classes.length,
    notifications: db.prepare('SELECT COUNT(*) c FROM notifications WHERE school_id = ? AND user_id = ? AND read_at IS NULL').get(schoolId, req.user.id).c,
    unreadMessages: db.prepare(
      `SELECT COUNT(*) c FROM messages m JOIN message_threads t ON t.id = m.thread_id
       WHERE m.school_id = ? AND m.read_at IS NULL AND m.sender_id != ? AND (t.participant_a = ? OR t.participant_b = ?)`,
    ).get(schoolId, req.user.id, req.user.id, req.user.id).c,
  };

  // Teacher scope: which classes/subjects this teacher owns.
  let teachingScope = null;
  if (req.user.role === 'teacher' && current) {
    const rows = db.prepare(
      `SELECT cs.*, c.name AS class_name, s.name AS section_name, sub.name AS subject_name
       FROM class_subjects cs
       LEFT JOIN classes c ON c.id = cs.class_id
       LEFT JOIN sections s ON s.id = cs.section_id
       LEFT JOIN subjects sub ON sub.id = cs.subject_id
       WHERE cs.school_id = ? AND cs.session_id = ? AND cs.teacher_id = ?`,
    ).all(schoolId, current.id, req.user.id);
    const classIds = new Set();
    rows.forEach((r) => {
      const key = `${r.class_id}:${r.section_id || ''}`;
      if (!classIds.has(key)) classIds.add(key);
    });
    teachingScope = {
      assignments: rows,
      classes: classes.filter((c) => rows.some((r) => r.class_id === c.id)),
      sectionIds: [...new Set(rows.map((r) => r.section_id).filter(Boolean))],
      subjectIds: [...new Set(rows.map((r) => r.subject_id))],
      scopes: rows.map((r) => ({ class_id: r.class_id, section_id: r.section_id, subject_id: r.subject_id })),
    };
  }

  const employees = req.user.role === 'principal' || req.user.role === 'staff'
    ? db.prepare(
      `SELECT e.id, u.full_name AS name, u.email, e.employee_code, e.department, e.designation, u.role
       FROM employees e JOIN users e2 ON e2.id = e.user_id JOIN users u ON u.id = e.user_id
       WHERE e.school_id = ? ORDER BY u.full_name`,
    ).all(schoolId)
    : [];

  res.json({
    user: {
      id: req.user.id,
      full_name: req.user.full_name,
      email: req.user.email,
      phone: req.user.phone,
      role: req.user.role,
      department: req.user.department,
      designation: req.user.designation,
      avatar_url: req.user.avatar_url,
      permissions: req.user.permissions,
      two_factor_enabled: Boolean(req.user.two_factor_enabled),
      must_change_password: Boolean(req.user.must_change_password),
    },
    school: {
      id: school.id,
      name: school.name,
      code: school.code,
      tagline: school.tagline,
      logo_url: school.logo_url,
      favicon_url: school.favicon_url,
      address: school.address,
      city: school.city,
      state: school.state,
      pincode: school.pincode,
      phone: school.phone,
      email: school.email,
      website: school.website,
      affiliation: school.affiliation,
      principal_name: school.principal_name,
      currency: school.currency,
      currency_symbol: school.currency_symbol,
      timezone: school.timezone,
      locale: school.locale,
      working_days: (() => { try { return JSON.parse(school.working_days || '[1,2,3,4,5,6]'); } catch { return [1, 2, 3, 4, 5, 6]; } })(),
      is_demo: Boolean(school.is_demo),
    },
    theme: { ...getSetting(schoolId, 'theme', 'config', {}), reportCard: getSetting(schoolId, 'theme', 'reportCard', {}) },
    academic: {
      sessions,
      currentSession: current,
      classes,
      sections,
      subjects,
      gradingScales: db.prepare('SELECT * FROM grading_scales WHERE school_id = ?').all(schoolId)
        .map((g) => ({ ...g, ranges: safeJson(g.ranges, []) })),
      periods: db.prepare('SELECT * FROM timetable_periods WHERE school_id = ? ORDER BY sort_order').all(schoolId),
    },
    stats,
    teachingScope,
    employees,
    permissionsCatalog: PERMISSION_CATALOG,
    features: {
      emailConfigured: isEmailConfigured(schoolId),
      smsConfigured: isSmsConfigured(schoolId),
      gatewayReady: isGatewayReady(schoolId),
      razorpayKeyId: getAllSettings(schoolId, 'payments').razorpay?.keyId || null,
    },
    settings: {
      fees: getAllSettings(schoolId, 'fees'),
      attendance: getAllSettings(schoolId, 'attendance'),
      exams: getAllSettings(schoolId, 'exams'),
      security: getAllSettings(schoolId, 'security'),
    },
  });
}));

function safeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

router.get('/permissions', (_req, res) => {
  res.json({ catalog: PERMISSION_CATALOG });
});

router.get('/search', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });
  const like = `%${q}%`;
  const schoolId = req.user.school_id;
  const results = [];
  const isPortal = ['student', 'parent'].includes(req.user.role);
  const can = (p) => req.user.role === 'principal' || req.user.permissions.includes(p);

  if (!isPortal && can('students.view')) {
    db.prepare(
      `SELECT id, full_name, admission_no, roll_no FROM students
       WHERE school_id = ? AND (full_name LIKE ? OR admission_no LIKE ?) LIMIT 6`,
    ).all(schoolId, like, like).forEach((s) => results.push({
      type: 'student', id: s.id, title: s.full_name, subtitle: `Adm. ${s.admission_no}`,
      to: `/app/students/${s.id}`,
    }));
  }
  if (!isPortal && can('employees.view')) {
    db.prepare(
      `SELECT u.id, u.full_name, u.role, e.employee_code FROM employees e JOIN users u ON u.id = e.user_id
       WHERE e.school_id = ? AND (u.full_name LIKE ? OR e.employee_code LIKE ?) LIMIT 4`,
    ).all(schoolId, like, like).forEach((e) => results.push({
      type: 'employee', id: e.id, title: e.full_name, subtitle: `${e.role} • ${e.employee_code || ''}`,
      to: `/app/employees/${e.id}`,
    }));
  }
  if (!isPortal && can('fees.view')) {
    db.prepare(
      `SELECT i.id, i.invoice_no, i.balance, s.full_name FROM invoices i JOIN students s ON s.id = i.student_id
       WHERE i.school_id = ? AND (i.invoice_no LIKE ? OR s.full_name LIKE ?) LIMIT 4`,
    ).all(schoolId, like, like).forEach((i) => results.push({
      type: 'invoice', id: i.id, title: i.invoice_no, subtitle: `${i.full_name} • balance ${i.balance}`,
      to: `/app/fees/invoices/${i.id}`,
    }));
  }
  if (!isPortal && can('library.view')) {
    db.prepare('SELECT id, title, author FROM books WHERE school_id = ? AND (title LIKE ? OR author LIKE ? OR isbn LIKE ?) LIMIT 3')
      .all(schoolId, like, like, like).forEach((b) => results.push({
        type: 'book', id: b.id, title: b.title, subtitle: b.author || 'Book', to: '/app/library/books',
      }));
  }
  res.json({ results });
}));

export default router;
