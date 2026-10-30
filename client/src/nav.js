/** Sidebar structure. `perm` accepts one permission or an array (any match). */
export const NAV = [
  {
    heading: 'Overview',
    items: [
      { to: '/app', label: 'Dashboard', icon: 'dashboard', perm: 'dashboard.view', end: true },
    ],
  },
  {
    heading: 'Academics',
    items: [
      { to: '/app/students', label: 'Students', icon: 'students', perm: ['students.view', 'students.create'] },
      { to: '/app/attendance', label: 'Attendance', icon: 'attendance', perm: 'attendance.view' },
      { to: '/app/exams', label: 'Examinations', icon: 'exams', perm: ['exams.view', 'exams.marks_entry'] },
      { to: '/app/results', label: 'Results', icon: 'results', perm: ['results.view', 'results.publish'] },
      { to: '/app/timetable', label: 'Timetable', icon: 'calendar', perm: 'timetable.view' },
      { to: '/app/homework', label: 'Homework', icon: 'homework', perm: 'homework.view' },
      { to: '/app/academics', label: 'Classes & Subjects', icon: 'classes', perm: 'classes.view' },
    ],
  },
  {
    heading: 'People',
    items: [
      { to: '/app/employees', label: 'Teachers & Staff', icon: 'teachers', perm: 'employees.view' },
      { to: '/app/users', label: 'Users & Roles', icon: 'users', perm: ['settings.users', 'users.view'] },
    ],
  },
  {
    heading: 'Finance',
    items: [
      { to: '/app/fees', label: 'Fees & Billing', icon: 'fees', perm: 'fees.view' },
      { to: '/app/payroll', label: 'Payroll', icon: 'money', perm: 'payroll.view' },
    ],
  },
  {
    heading: 'Operations',
    items: [
      { to: '/app/library', label: 'Library', icon: 'library', perm: 'library.view' },
      { to: '/app/transport', label: 'Transport', icon: 'transport', perm: 'transport.view' },
      { to: '/app/communication', label: 'Communication', icon: 'communication', perm: 'communication.view' },
      { to: '/app/reports', label: 'Reports', icon: 'reports', perm: ['reports.view', 'reports.finance', 'reports.attendance', 'reports.admin'] },
    ],
  },
  {
    heading: 'Website',
    items: [
      { to: '/app/website', label: 'Website & CMS', icon: 'globe', perm: ['website.view', 'website.manage', 'website.admissions'] },
    ],
  },
  {
    heading: 'Administration',
    items: [
      { to: '/app/settings', label: 'Settings', icon: 'settings', perm: 'settings.view' },
    ],
  },
];

export function visibleNav(user) {
  const allow = (perm) => {
    if (!perm) return true;
    if (!user) return false;
    if (user.role === 'principal') return true;
    const list = Array.isArray(perm) ? perm : [perm];
    return list.some((p) => (user.permissions || []).includes(p));
  };
  return NAV
    .map((group) => ({ ...group, items: group.items.filter((item) => allow(item.perm)) }))
    .filter((group) => group.items.length > 0);
}

export const SETTINGS_TABS = [
  { value: 'school', label: 'School profile', perm: 'settings.school' },
  { value: 'branding', label: 'Branding', perm: 'settings.customize' },
  { value: 'academic', label: 'Academic setup', perm: 'settings.session' },
  { value: 'security', label: 'Security', perm: 'settings.security' },
  { value: 'integrations', label: 'Integrations', perm: 'settings.integrations' },
  { value: 'backup', label: 'Backups', perm: 'settings.backup' },
  { value: 'audit', label: 'Activity log', perm: 'settings.audit' },
  { value: 'api', label: 'API keys', perm: 'settings.api' },
  { value: 'system', label: 'System', perm: 'settings.view' },
];
