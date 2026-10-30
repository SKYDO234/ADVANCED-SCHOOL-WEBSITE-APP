/**
 * Permission catalogue. Every permission is `<module>.<action>`.
 * `module` doubles as the navigation group in the client.
 */
export const PERMISSION_CATALOG = [
  { module: 'dashboard', label: 'Dashboard', perms: [['view', 'View dashboard']] },

  { module: 'students', label: 'Students', perms: [
    ['view', 'View students & profiles'], ['create', 'Admit new students'], ['edit', 'Edit student records'],
    ['delete', 'Delete students'], ['import', 'Bulk import students'], ['export', 'Export student data'],
    ['documents', 'Manage student documents'], ['history', 'Manage academic history'],
  ] },

  { module: 'employees', label: 'Teachers & Staff', perms: [
    ['view', 'View employees'], ['create', 'Add employees'], ['edit', 'Edit employees'],
    ['delete', 'Remove employees'], ['export', 'Export employee data'], ['documents', 'Manage employee documents'],
  ] },

  { module: 'classes', label: 'Classes & Subjects', perms: [
    ['view', 'View classes'], ['create', 'Create classes/sections'], ['edit', 'Edit classes'],
    ['delete', 'Delete classes'], ['assign', 'Assign teachers to subjects'],
  ] },

  { module: 'attendance', label: 'Attendance', perms: [
    ['view', 'View attendance'], ['mark', 'Mark attendance'], ['correct', 'Correct attendance'],
    ['export', 'Export attendance'], ['staff', 'Employee attendance'], ['report', 'Attendance reports'],
  ] },

  { module: 'exams', label: 'Examinations', perms: [
    ['view', 'View examinations'], ['create', 'Create examinations'], ['edit', 'Edit examinations'],
    ['delete', 'Delete examinations'], ['marks_view', 'View marks'], ['marks_entry', 'Enter marks'],
    ['marks_bulk', 'Bulk marks entry'], ['marks_correct', 'Correct submitted marks'],
    ['assign_teacher', 'Assign subject teachers'],
  ] },

  { module: 'results', label: 'Results & Report Cards', perms: [
    ['view', 'View results'], ['finalize', 'Finalize results'], ['publish', 'Publish / unpublish results'],
    ['correct', 'Correct published results'], ['template', 'Edit report card template'],
    ['export', 'Download report cards'], ['recalculate', 'Recalculate ranks'],
  ] },

  { module: 'fees', label: 'Fees & Billing', perms: [
    ['view', 'View fees & invoices'], ['structure', 'Manage fee structures'], ['invoice_create', 'Generate invoices'],
    ['invoice_edit', 'Edit invoices'], ['invoice_delete', 'Cancel invoices'], ['collect', 'Collect payments'],
    ['discount', 'Apply discounts & scholarships'], ['refund', 'Process refunds'], ['expense', 'Manage expenses'],
    ['export', 'Export finance data'], ['gateway', 'Configure payment gateway'],
  ] },

  { module: 'library', label: 'Library', perms: [
    ['view', 'View library'], ['manage', 'Manage books & categories'], ['issue', 'Issue / return books'],
    ['fine', 'Collect fines'], ['export', 'Export library data'],
  ] },

  { module: 'transport', label: 'Transport', perms: [
    ['view', 'View transport'], ['manage', 'Manage vehicles & routes'], ['allocate', 'Allocate students'],
    ['maintenance', 'Vehicle maintenance'], ['attendance', 'Transport attendance'],
  ] },

  { module: 'timetable', label: 'Timetable', perms: [
    ['view', 'View timetable'], ['manage', 'Build timetable'], ['periods', 'Configure periods'],
  ] },

  { module: 'homework', label: 'Homework & Learning', perms: [
    ['view', 'View homework'], ['create', 'Create assignments'], ['edit', 'Edit assignments'],
    ['grade', 'Grade submissions'], ['materials', 'Manage study materials'], ['submit', 'Submit homework'],
  ] },

  { module: 'communication', label: 'Communication', perms: [
    ['view', 'View announcements'], ['create', 'Create announcements'], ['delete', 'Delete announcements'],
    ['message', 'Send messages'], ['templates', 'Notification templates'], ['send_emergency', 'Emergency alerts'],
  ] },

  { module: 'reports', label: 'Reports & Analytics', perms: [
    ['view', 'View academic reports'], ['finance', 'Financial reports'], ['attendance', 'Attendance reports'],
    ['admin', 'Administrative reports'], ['export', 'Export reports'],
  ] },

  { module: 'payroll', label: 'Payroll & HR', perms: [
    ['view', 'View payroll'], ['manage', 'Run payroll'], ['approve_leave', 'Approve leave'],
    ['performance', 'Staff performance'],
  ] },

  { module: 'website', label: 'Website & CMS', perms: [
    ['view', 'View website settings'], ['manage', 'Edit website content'], ['admissions', 'Admission inquiries'],
  ] },

  { module: 'settings', label: 'Settings', perms: [
    ['view', 'View settings'], ['school', 'School configuration'], ['customize', 'Customization studio'],
    ['permissions', 'Permission manager'], ['users', 'User accounts'], ['session', 'Academic sessions'],
    ['integrations', 'Integrations'], ['backup', 'Backups & restore'], ['security', 'Security & policies'],
    ['audit', 'Activity & login logs'], ['api', 'API keys'], ['retention', 'Data retention'],
  ] },
];

export const ALL_PERMISSIONS = PERMISSION_CATALOG.flatMap((m) =>
  m.perms.map(([action]) => `${m.module}.${action}`),
);

export const PERMISSION_LABELS = Object.fromEntries(
  PERMISSION_CATALOG.flatMap((m) => m.perms.map(([action, label]) => [`${m.module}.${action}`, label])),
);

/** Expand `module.*` wildcards and drop unknown keys. */
export function expandPermissions(list = []) {
  const out = new Set();
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    if (raw === '*') {
      ALL_PERMISSIONS.forEach((p) => out.add(p));
      continue;
    }
    if (raw.endsWith('.*')) {
      const mod = raw.slice(0, -2);
      ALL_PERMISSIONS.filter((p) => p.startsWith(`${mod}.`)).forEach((p) => out.add(p));
      continue;
    }
    if (ALL_PERMISSIONS.includes(raw)) out.add(raw);
  }
  return [...out];
}

export const DEPARTMENT_PRESETS = {
  accounts: ['dashboard.view', 'students.view', 'fees.*', 'reports.finance', 'reports.export', 'communication.view', 'communication.create'],
  reception: ['dashboard.view', 'students.view', 'students.create', 'students.edit', 'employees.view', 'attendance.view', 'communication.view', 'communication.create', 'website.admissions', 'fees.view'],
  examination: ['dashboard.view', 'students.view', 'exams.*', 'results.view', 'results.export', 'attendance.view', 'reports.view'],
  library: ['dashboard.view', 'students.view', 'employees.view', 'library.*'],
  transport: ['dashboard.view', 'students.view', 'transport.*'],
  office: ['dashboard.view', 'students.view', 'employees.view', 'communication.*', 'website.*', 'reports.admin', 'timetable.view'],
  hr: ['dashboard.view', 'employees.*', 'payroll.*', 'attendance.*', 'reports.admin', 'reports.export'],
};

export const DEFAULT_ROLE_PERMISSIONS = {
  principal: ['*'],
  teacher: [
    'dashboard.view', 'students.view', 'students.history', 'classes.view',
    'attendance.view', 'attendance.mark', 'attendance.report',
    'exams.view', 'exams.marks_view', 'exams.marks_entry', 'exams.marks_bulk',
    'results.view', 'results.export',
    'timetable.view', 'homework.view', 'homework.create', 'homework.edit', 'homework.grade', 'homework.materials',
    'communication.view', 'communication.create', 'communication.message',
    'reports.view', 'library.view', 'payroll.view',
  ],
  staff: DEPARTMENT_PRESETS.office,
  student: [
    'dashboard.view', 'attendance.view', 'results.view', 'fees.view', 'homework.view', 'homework.submit',
    'timetable.view', 'communication.view', 'communication.message', 'library.view',
  ],
  parent: [
    'dashboard.view', 'attendance.view', 'results.view', 'fees.view', 'homework.view',
    'timetable.view', 'communication.view', 'communication.message', 'library.view',
  ],
};
