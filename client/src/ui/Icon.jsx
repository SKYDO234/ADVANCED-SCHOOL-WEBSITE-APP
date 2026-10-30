/**
 * Icon set — single consistent 24px stroke geometry (Lucide-style).
 * Usage: <Icon name="students" />
 */
const PATHS = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="11" width="7" height="10" rx="1.5" /><rect x="3" y="15" width="7" height="6" rx="1.5" /></>,
  students: <><path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20" /><circle cx="9.5" cy="7" r="3.2" /><path d="M21 20v-1.4a3.6 3.6 0 0 0-2.8-3.5" /><path d="M15.5 4.2a3.2 3.2 0 0 1 0 6" /></>,
  teachers: <><path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" /><path d="M6 10v5.5c0 1.9 2.7 3.5 6 3.5s6-1.6 6-3.5V10" /><path d="M21 8v6" /></>,
  staff: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /><path d="M3 12h18" /></>,
  classes: <><path d="M4 5h16v14H4z" /><path d="M4 9h16" /><path d="M9 9v10" /></>,
  subjects: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21V5.5Z" /><path d="M8 7h8" /><path d="M8 11h6" /></>,
  attendance: <><rect x="3" y="4.5" width="18" height="16.5" rx="2" /><path d="M8 3v3M16 3v3M3 10h18" /><path d="m8.5 15 2 2 4-4" /></>,
  exams: <><path d="M8 3h8l4 4v14H8z" /><path d="M16 3v4h4" /><path d="M11 12h6M11 16h4" /></>,
  results: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  fees: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.6" /><path d="M6 9.5v5M18 9.5v5" /></>,
  invoices: <><path d="M6 2.5h9l4 4V21H6z" /><path d="M15 2.5v4h4" /><path d="M9 11h7M9 15h5M9 8h3" /></>,
  payments: <><rect x="2" y="5" width="20" height="14" rx="2.5" /><path d="M2 10h20" /><path d="M6 15h4" /></>,
  expenses: <><path d="M12 3v18" /><path d="M17 7.5c0-2-2.2-3.5-5-3.5S7 5.5 7 7.5s2.2 2.8 5 3.2 5 1.3 5 3.3-2.2 3.5-5 3.5-5-1.5-5-3.5" /></>,
  library: <><path d="M4 4h5v16H4zM9 4h5v16H9z" /><path d="m15.5 5 4 1-3 14-4-1z" /></>,
  transport: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M3 11h18" /><circle cx="7.5" cy="18.5" r="1.8" /><circle cx="16.5" cy="18.5" r="1.8" /><path d="M6 4v7M18 4v7" /></>,
  homework: <><path d="M5 4h11l3 3v13H5z" /><path d="M8 9h8M8 13h8M8 17h5" /><path d="M15 4v4h4" /></>,
  materials: <><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H20v13.5H6.5A2.5 2.5 0 0 0 4 20V6.5Z" /><path d="m9 9 3 3 3-3" /></>,
  communication: <><path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12Z" /><path d="M8.5 11h7M8.5 14.5h4.5" /></>,
  messages: <><path d="M4 5h16v11H9l-5 4V5Z" /><path d="M8 9h8M8 12.5h5" /></>,
  notifications: <><path d="M18 8a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" /><path d="M10.5 20a2 2 0 0 0 3 0" /></>,
  reports: <><path d="M3 3v18h18" /><path d="m7 15 3.5-4 3 2.5L19 7" /></>,
  analytics: <><circle cx="12" cy="12" r="9" /><path d="M12 12V3M12 12l7.5 4.5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></>,
  users: <><circle cx="9" cy="8" r="3.4" /><path d="M2.5 20v-1.2A4.8 4.8 0 0 1 7.3 14h3.4a4.8 4.8 0 0 1 4.8 4.8V20" /><path d="M17 5.2a3.4 3.4 0 0 1 0 6.6M18.5 14h.7a4.8 4.8 0 0 1 4.3 4.8V20" /></>,
  shield: <><path d="M12 3 5 6v6c0 4.5 3 8 7 9 4-1 7-4.5 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
  lock: <><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /><path d="M12 15v2.5" /></>,
  key: <><circle cx="8" cy="15" r="4.2" /><path d="m11 12 8-8 2.5 2.5-1.7 1.7 1.7 1.7-2.5 2.5-1.8-1.8-1.7 1.7" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 11h18" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5.2l3.2 2" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4.2-4.2" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  minus: <><path d="M5 12h14" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z" /></>,
  trash: <><path d="M3.5 6.5h17" /><path d="M8.5 6.5V4.2c0-.7.6-1.2 1.2-1.2h4.6c.7 0 1.2.5 1.2 1.2v2.3" /><path d="M6 6.5 7 21h10l1-14.5" /><path d="M10 11v6M14 11v6" /></>,
  close: <><path d="M6 6l12 12M18 6 6 18" /></>,
  check: <><path d="m4 12.5 5 5L20 6.5" /></>,
  chevronDown: <><path d="m6 9 6 6 6-6" /></>,
  chevronRight: <><path d="m9 6 6 6-6 6" /></>,
  chevronLeft: <><path d="m15 6-6 6 6 6" /></>,
  arrowLeft: <><path d="M19 12H5M11 6l-6 6 6 6" /></>,
  arrowRight: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
  download: <><path d="M12 4v12" /><path d="m7 11 5 5 5-5" /><path d="M4 20h16" /></>,
  print: <><path d="M7 8V3h10v5" /><rect x="4" y="8" width="16" height="8" rx="2" /><path d="M7 16h10v5H7z" /></>,
  filter: <><path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" /></>,
  more: <><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
  menu: <><path d="M3 6h18M3 12h18M3 18h18" /></>,
  moon: <><path d="M21 13.5A8.5 8.5 0 1 1 10.5 3a7 7 0 0 0 10.5 10.5Z" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  bell: <><path d="M18 8a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" /><path d="M10.5 20a2 2 0 0 0 3 0" /></>,
  alert: <><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 9v5M12 17.2v.1" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.6v.1" /></>,
  success: <><circle cx="12" cy="12" r="9" /><path d="m8 12.4 2.6 2.6L16 9.6" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M3 3l18 18" /><path d="M10.6 6.1A9.4 9.4 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.4 3.1M6.3 7.9A17 17 0 0 0 2.5 12S6 18 12 18a9.7 9.7 0 0 0 3-.5" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H5.5A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-13.7-4.7L3 9" /><path d="M3 4v5h5" /><path d="M4 13a8 8 0 0 0 13.7 4.7L21 15" /><path d="M21 20v-5h-5" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z" /></>,
  school: <><path d="M3 21h18" /><path d="M5 21V9l7-4 7 4v12" /><path d="M9.5 21v-5h5v5" /><path d="M9.5 11h.1M14.5 11h.1" /></>,
  file: <><path d="M6 2.5h9l4 4V21H6z" /><path d="M15 2.5v4h4" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="m4 17 4.5-4.5L13 17l3-3 4 4" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" /></>,
  money: <><circle cx="12" cy="12" r="9" /><path d="M15 9.2c0-1.2-1.3-2.2-3-2.2s-3 1-3 2.2 1.3 1.8 3 2.1 3 .9 3 2.1-1.3 2.2-3 2.2-3-1-3-2.2" /><path d="M12 6v12" /></>,
  card: <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19" /><path d="M6 14.5h4" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9.5 8h5M9.5 12h5" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  presentation: <><path d="M3 4h18v11H3z" /><path d="m12 15 0 6M9 21h6" /><path d="M8 11V8M12 11V6M16 11V9" /></>,
  award: <><circle cx="12" cy="9" r="5.5" /><path d="m8.5 13.5-1.5 8 5-3 5 3-1.5-8" /></>,
  trendUp: <><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  trendDown: <><path d="m3 7 6 6 4-4 8 8" /><path d="M15 17h6v-6" /></>,
  sparkles: <><path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Z" /><path d="M18 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" /></>,
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21V5.5Z" /><path d="M4 18.5c0-1.4 1.1-2.5 2.5-2.5H20" /></>,
  bus: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M3 11h18" /><circle cx="7.5" cy="18.5" r="1.8" /><circle cx="16.5" cy="18.5" r="1.8" /></>,
  idCard: <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><circle cx="8.5" cy="11" r="2.2" /><path d="M5 16.2a3.8 3.8 0 0 1 7 0" /><path d="M14.5 10h4M14.5 13.5h3" /></>,
  database: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
  plug: <><path d="M9 3v5M15 3v5" /><path d="M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8Z" /><path d="M12 17v4" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.7 0 2-1.6 1-2.6-1.2-1.2-.3-3.4 1.6-3.4H18a3 3 0 0 0 3-3c0-5-4-9-9-9Z" /><circle cx="8" cy="10" r="1.2" /><circle cx="12" cy="7.5" r="1.2" /><circle cx="15.8" cy="10" r="1.2" /></>,
  layout: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 9v12" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3.5 6h.1M3.5 12h.1M3.5 18h.1" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.4" /><rect x="14" y="3" width="7" height="7" rx="1.4" /><rect x="3" y="14" width="7" height="7" rx="1.4" /><rect x="14" y="14" width="7" height="7" rx="1.4" /></>,
  send: <><path d="m22 2-7 20-4-9-9-4 20-7Z" /><path d="M22 2 11 13" /></>,
  star: <><path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.7l6.2-.9L12 3Z" /></>,
  map: <><path d="m9 3 6 2 6-2v16l-6 2-6-2-6 2V5l6-2Z" /><path d="M9 3v16M15 5v16" /></>,
  pin: <><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></>,
  device: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  restore: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></>,
  security: <><path d="M12 3 5 6v5.5c0 4.4 3 7.9 7 9.5 4-1.6 7-5.1 7-9.5V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
  backup: <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>,
  play: <><path d="M7 4.5v15l13-7.5-13-7.5Z" /></>,
  userCheck: <><circle cx="9" cy="8" r="3.4" /><path d="M2.5 20v-1.2A4.8 4.8 0 0 1 7.3 14h3.4a4.8 4.8 0 0 1 4.4 2.6" /><path d="m16 17 2 2 4-4" /></>,
  spark: <><path d="M13 2 4.5 13.5H11l-1 8.5L19 10h-6.5L13 2Z" /></>,
};

export default function Icon({ name, size, className = '', strokeWidth = 1.8, ...rest }) {
  const path = PATHS[name] || PATHS.info;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      width={size}
      height={size}
      aria-hidden="true"
      {...rest}
    >
      {path}
    </svg>
  );
}

export const ICON_NAMES = Object.keys(PATHS);
