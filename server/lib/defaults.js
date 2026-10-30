import { db, newId, nowIso, setSetting, tx } from '../db/index.js';
import { DEFAULT_ROLE_PERMISSIONS } from './permissions.js';

export const DEFAULT_THEME = {
  mode: 'light',
  accent: '#1f3b73',
  accentSoft: '#e8eefb',
  radius: '14px',
  font: 'Inter',
  sidebarStyle: 'dark',
  density: 'comfortable',
  loginTitle: 'Welcome back',
  loginSubtitle: 'Sign in to your school workspace',
  showPublicWebsite: true,
};

export const DEFAULT_GRADE_RANGES = [
  { min: 91, max: 100, grade: 'A1', points: 10, remark: 'Outstanding' },
  { min: 81, max: 90.99, grade: 'A2', points: 9, remark: 'Excellent' },
  { min: 71, max: 80.99, grade: 'B1', points: 8, remark: 'Very good' },
  { min: 61, max: 70.99, grade: 'B2', points: 7, remark: 'Good' },
  { min: 51, max: 60.99, grade: 'C1', points: 6, remark: 'Above average' },
  { min: 41, max: 50.99, grade: 'C2', points: 5, remark: 'Average' },
  { min: 33, max: 40.99, grade: 'D', points: 4, remark: 'Needs improvement' },
  { min: 0, max: 32.99, grade: 'E', points: 0, remark: 'Unsatisfactory' },
];

export const DEFAULT_PERIODS = [
  { name: 'Period 1', start_time: '08:00', end_time: '08:45', is_break: 0 },
  { name: 'Period 2', start_time: '08:45', end_time: '09:30', is_break: 0 },
  { name: 'Short Break', start_time: '09:30', end_time: '09:45', is_break: 1 },
  { name: 'Period 3', start_time: '09:45', end_time: '10:30', is_break: 0 },
  { name: 'Period 4', start_time: '10:30', end_time: '11:15', is_break: 0 },
  { name: 'Lunch', start_time: '11:15', end_time: '11:45', is_break: 1 },
  { name: 'Period 5', start_time: '11:45', end_time: '12:30', is_break: 0 },
  { name: 'Period 6', start_time: '12:30', end_time: '13:15', is_break: 0 },
  { name: 'Period 7', start_time: '13:15', end_time: '14:00', is_break: 0 },
];

export const DEFAULT_FEE_HEADS = [
  { name: 'Admission Fee', code: 'ADM', type: 'one_time' },
  { name: 'Tuition Fee', code: 'TUI', type: 'monthly' },
  { name: 'Examination Fee', code: 'EXM', type: 'annual' },
  { name: 'Laboratory Fee', code: 'LAB', type: 'annual' },
  { name: 'Library Fee', code: 'LIB', type: 'annual' },
  { name: 'Transport Fee', code: 'TRN', type: 'monthly' },
  { name: 'Sports Fee', code: 'SPT', type: 'annual' },
  { name: 'Annual Charges', code: 'ANN', type: 'annual' },
  { name: 'Development Fee', code: 'DEV', type: 'annual' },
];

export const DEFAULT_TEMPLATES = [
  { key: 'result_published', channel: 'in_app', name: 'Results published', subject: '{{exam}} results are published', body: 'Dear {{name}}, your result for {{exam}} is now available in your portal.' },
  { key: 'fee_invoice', channel: 'in_app', name: 'Fee invoice generated', subject: 'New fee invoice {{invoice}}', body: 'Invoice {{invoice}} of {{amount}} is due on {{due_date}}.' },
  { key: 'fee_receipt', channel: 'in_app', name: 'Payment receipt', subject: 'Payment received - {{amount}}', body: 'We received {{amount}} on {{date}}. Receipt {{receipt}}.' },
  { key: 'absence_alert', channel: 'in_app', name: 'Student absent', subject: 'Absence alert for {{name}}', body: '{{name}} was marked absent on {{date}}.' },
  { key: 'announcement', channel: 'in_app', name: 'Announcement', subject: '{{title}}', body: '{{body}}' },
];

export const DEFAULT_SETTINGS = [
  ['academic', 'sessionStartMonth', 4],
  ['academic', 'gradingStyle', 'percentage'],
  ['academic', 'attendanceLockDays', 7],
  ['attendance', 'lateAfterMinutes', 10],
  ['attendance', 'notifyParentsOnAbsence', true],
  ['attendance', 'workingDays', [1, 2, 3, 4, 5, 6]],
  ['fees', 'invoicePrefix', 'INV'],
  ['fees', 'receiptPrefix', 'RCP'],
  ['fees', 'lateFeeFixed', 100],
  ['fees', 'lateFeePercent', 0],
  ['fees', 'graceDays', 5],
  ['fees', 'partialPaymentsAllowed', true],
  ['payments', 'razorpay', { enabled: false, keyId: '', keySecret: '', webhookSecret: '', mode: 'test' }],
  ['exams', 'defaultPassPercentage', 33],
  ['exams', 'tieBreak', 'total_desc'],
  ['exams', 'rankScope', 'section'],
  ['exams', 'weightageEnabled', false],
  ['security', 'passwordPolicy', { minLength: 8, requireUpper: false, requireNumber: true, requireSymbol: false, maxAttempts: 8, lockoutMinutes: 15, sessionDays: 7, twoFactorRequiredForAdmins: false, passwordExpiryDays: 0 }],
  ['security', 'forceHttps', false],
  ['security', 'ipAllowlist', []],
  ['security', 'twoFactorPolicy', 'optional'],
  ['retention', 'auditLogDays', 730],
  ['retention', 'loginHistoryDays', 365],
  ['retention', 'backupEveryHours', 24],
  ['retention', 'autoBackupEnabled', true],
  ['integrations', 'email', { enabled: false, host: '', port: 587, secure: false, user: '', pass: '', fromName: '', fromEmail: '' }],
  ['integrations', 'sms', { enabled: false, provider: 'generic_http', apiUrl: '', apiKey: '', senderId: '', accountSid: '', method: 'GET' }],
  ['integrations', 'push', { enabled: false }],
  ['notifications', 'emailOnResult', true],
  ['notifications', 'emailOnInvoice', true],
  ['notifications', 'smsOnAbsence', false],
  ['notifications', 'digestTime', '18:00'],
  ['dashboard', 'widgets', null],
  ['website', 'heroTitle', 'A future-ready school for curious minds'],
  ['website', 'heroSubtitle', 'Academic excellence, modern facilities and a caring community — from early years to senior school.'],
  ['website', 'heroImage', ''],
  ['website', 'aboutText', ''],
  ['website', 'stats', [
    { label: 'Students', value: '1,200+' },
    { label: 'Expert teachers', value: '85' },
    { label: 'Pass rate', value: '99%' },
    { label: 'Years of excellence', value: '25+' },
  ]],
  ['website', 'contactPhone', ''],
  ['website', 'contactEmail', ''],
  ['website', 'admissionsOpen', true],
];

export function createRoleRows(schoolId) {
  const at = nowIso();
  const defaults = [
    ['principal', 'Principal', 'principal', 'Full control of the school workspace'],
    ['teacher', 'Teacher', 'teacher', 'Academic administration for assigned classes'],
    ['staff', 'Staff', 'staff', 'Department scoped operations'],
    ['student', 'Student', 'student', 'Student self-service portal'],
    ['parent', 'Parent', 'parent', 'Parent portal for linked children'],
  ];
  const ids = {};
  for (const [key, name, baseRole, description] of defaults) {
    const id = newId('rol');
    db.prepare(
      `INSERT INTO roles (id, school_id, key, name, base_role, description, is_system, permissions, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, schoolId, key, name, baseRole, description, 1, JSON.stringify(DEFAULT_ROLE_PERMISSIONS[key] || []), at, at);
    ids[key] = id;
  }
  return ids;
}

/** Everything a brand-new school needs to be usable. */
export function bootstrapSchool(schoolId, { gradeRanges = DEFAULT_GRADE_RANGES } = {}) {
  const at = nowIso();
  const roleIds = createRoleRows(schoolId);

  for (const [category, key, value] of DEFAULT_SETTINGS) {
    setSetting(schoolId, category, key, value);
  }
  setSetting(schoolId, 'theme', 'config', DEFAULT_THEME);
  setSetting(schoolId, 'theme', 'reportCard', {
    title: 'REPORT CARD',
    accent: '#1F3B73',
    showPhoto: true,
    showRank: true,
    showAttendance: true,
    showGradeLegend: true,
    showTeacherRemark: true,
    showPrincipalRemark: true,
    showSignature: true,
    showStamp: true,
    showDob: true,
    showFatherName: true,
    showSubjectRemark: true,
    footerNote: 'This is a computer generated report card. Any correction must be authorised by the Principal.',
  });
  setSetting(schoolId, 'theme', 'invoice', {
    accent: '#1F3B73',
    footerNote: 'Please pay before the due date to avoid late fees.',
  });

  db.prepare(
    'INSERT INTO grading_scales (id, school_id, name, is_default, ranges, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
  ).run(newId('grd'), schoolId, 'Standard Grading (CBSE style)', 1, JSON.stringify(gradeRanges), at, at);

  DEFAULT_PERIODS.forEach((p, idx) => {
    db.prepare(
      'INSERT INTO timetable_periods (id, school_id, name, start_time, end_time, is_break, sort_order) VALUES (?,?,?,?,?,?,?)',
    ).run(newId('per'), schoolId, p.name, p.start_time, p.end_time, p.is_break, idx);
  });

  DEFAULT_FEE_HEADS.forEach((h) => {
    db.prepare(
      'INSERT INTO fee_heads (id, school_id, name, code, type, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run(newId('fh'), schoolId, h.name, h.code, h.type, 1, at, at);
  });

  DEFAULT_TEMPLATES.forEach((t) => {
    db.prepare(
      `INSERT INTO notification_templates (id, school_id, key, name, channel, subject, body, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(newId('tpl'), schoolId, t.key, t.name, t.channel, t.subject, t.body, at);
  });

  const pages = [
    ['home', 'Home', 0], ['about', 'About Us', 1], ['academics', 'Academics', 2],
    ['admissions', 'Admissions', 3], ['contact', 'Contact', 4],
  ];
  pages.forEach(([slug, title, order]) => {
    db.prepare(
      `INSERT INTO website_pages (id, school_id, slug, title, content, blocks, is_published, show_in_nav, sort_order, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      newId('pg'), schoolId, slug, title,
      slug === 'about' ? 'We are a community of learners committed to academic excellence and character.' : '',
      slug === 'home'
        ? JSON.stringify([
          { type: 'hero', title: 'Welcome to our school', subtitle: 'Learning with purpose' },
          { type: 'stats' }, { type: 'news', title: 'Latest updates' }, { type: 'cta' },
        ])
        : JSON.stringify([{ type: 'richText' }]),
      1, 1, order, at,
    );
  });

  return { roleIds };
}

export function createAcademicSession(schoolId, { name, start_date, end_date, is_current = 0 }) {
  const at = nowIso();
  const id = newId('ses');
  if (is_current) {
    db.prepare('UPDATE academic_sessions SET is_current = 0 WHERE school_id = ?').run(schoolId);
  }
  db.prepare(
    `INSERT INTO academic_sessions (id, school_id, name, start_date, end_date, is_current, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(id, schoolId, name, start_date, end_date, is_current ? 1 : 0, 'active', at, at);
  return id;
}

export const currentSession = (schoolId) => db
  .prepare("SELECT * FROM academic_sessions WHERE school_id = ? ORDER BY is_current DESC, start_date DESC LIMIT 1")
  .get(schoolId);

export const bootstrapSchoolTx = tx(bootstrapSchool);
export { db, newId, nowIso };
