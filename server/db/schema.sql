-- ============================================================
--  Advanced School Management ERP — Database Schema (SQLite)
--  Multi-tenant: every operational table carries school_id.
--  All timestamps are ISO-8601 UTC strings.
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------- Tenant ----------
CREATE TABLE IF NOT EXISTS schools (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  code            TEXT NOT NULL UNIQUE,
  tagline         TEXT,
  address         TEXT,
  city            TEXT,
  state           TEXT,
  pincode         TEXT,
  country         TEXT DEFAULT 'India',
  phone           TEXT,
  email           TEXT,
  website         TEXT,
  logo_url        TEXT,
  favicon_url     TEXT,
  affiliation     TEXT,
  principal_name  TEXT,
  currency        TEXT DEFAULT 'INR',
  currency_symbol TEXT DEFAULT '₹',
  timezone        TEXT DEFAULT 'Asia/Kolkata',
  locale          TEXT DEFAULT 'en-IN',
  working_days    TEXT DEFAULT '[1,2,3,4,5,6]',
  is_demo         INTEGER DEFAULT 0,
  is_active       INTEGER DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id         TEXT PRIMARY KEY,
  school_id  TEXT NOT NULL,
  category   TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (school_id, category, key)
);
CREATE INDEX IF NOT EXISTS idx_settings_school ON settings (school_id, category);

CREATE TABLE IF NOT EXISTS academic_sessions (
  id         TEXT PRIMARY KEY,
  school_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  is_current INTEGER DEFAULT 0,
  status     TEXT DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS holidays (
  id          TEXT PRIMARY KEY,
  school_id   TEXT NOT NULL,
  session_id  TEXT,
  name        TEXT NOT NULL,
  date        TEXT NOT NULL,
  end_date    TEXT,
  type        TEXT DEFAULT 'holiday',
  description TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_holidays_school_date ON holidays (school_id, date);

-- ---------- Identity & access ----------
CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  school_id   TEXT NOT NULL,
  key         TEXT NOT NULL,
  name        TEXT NOT NULL,
  base_role   TEXT NOT NULL,
  description TEXT,
  is_system   INTEGER DEFAULT 0,
  permissions TEXT DEFAULT '[]',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (school_id, key)
);

CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,
  school_id            TEXT NOT NULL,
  email                TEXT NOT NULL,
  username             TEXT,
  password_hash        TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  phone                TEXT,
  role                 TEXT NOT NULL CHECK (role IN ('principal','teacher','staff','student','parent')),
  role_id              TEXT,
  department           TEXT,
  designation          TEXT,
  avatar_url           TEXT,
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','invited','disabled')),
  two_factor_secret    TEXT,
  two_factor_enabled   INTEGER DEFAULT 0,
  must_change_password INTEGER DEFAULT 0,
  last_login_at        TEXT,
  failed_attempts      INTEGER DEFAULT 0,
  locked_until         TEXT,
  created_by           TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON users (school_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_users_role ON users (school_id, role);

CREATE TABLE IF NOT EXISTS user_permissions (
  id         TEXT PRIMARY KEY,
  school_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  permission TEXT NOT NULL,
  allowed    INTEGER NOT NULL DEFAULT 1,
  UNIQUE (user_id, permission)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id           TEXT PRIMARY KEY,           -- sha256 of the session token
  user_id      TEXT NOT NULL,
  school_id    TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id, revoked_at);

CREATE TABLE IF NOT EXISTS login_history (
  id         TEXT PRIMARY KEY,
  school_id  TEXT NOT NULL,
  user_id    TEXT,
  email      TEXT,
  ip         TEXT,
  user_agent TEXT,
  status     TEXT NOT NULL,
  reason     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_history_school ON login_history (school_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  school_id   TEXT NOT NULL,
  user_id     TEXT,
  actor_name  TEXT,
  actor_role  TEXT,
  action      TEXT NOT NULL,
  module      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  summary     TEXT,
  meta        TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_school ON audit_logs (school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  school_id    TEXT NOT NULL,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  key_hash     TEXT NOT NULL,
  scopes       TEXT DEFAULT '[]',
  created_by   TEXT,
  last_used_at TEXT,
  revoked_at   TEXT,
  created_at   TEXT NOT NULL
);

-- ---------- Academic structure ----------
CREATE TABLE IF NOT EXISTS classes (
  id         TEXT PRIMARY KEY,
  school_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  code       TEXT,
  order_index INTEGER DEFAULT 0,
  stream     TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS sections (
  id               TEXT PRIMARY KEY,
  school_id        TEXT NOT NULL,
  class_id         TEXT NOT NULL,
  name             TEXT NOT NULL,
  room             TEXT,
  capacity         INTEGER DEFAULT 40,
  class_teacher_id TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (class_id, name)
);

CREATE TABLE IF NOT EXISTS subjects (
  id         TEXT PRIMARY KEY,
  school_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  code       TEXT,
  type       TEXT DEFAULT 'theory' CHECK (type IN ('theory','practical','both')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS class_subjects (
  id           TEXT PRIMARY KEY,
  school_id    TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  class_id     TEXT NOT NULL,
  section_id   TEXT,
  subject_id   TEXT NOT NULL,
  teacher_id   TEXT,
  periods_week INTEGER DEFAULT 5,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_class_subjects ON class_subjects (school_id, session_id, class_id, section_id);

CREATE TABLE IF NOT EXISTS employees (
  id                TEXT PRIMARY KEY,
  school_id         TEXT NOT NULL,
  user_id           TEXT NOT NULL UNIQUE,
  employee_code     TEXT NOT NULL,
  department        TEXT,
  designation       TEXT,
  employment_type   TEXT DEFAULT 'full_time',
  joining_date      TEXT,
  qualification     TEXT,
  specialization    TEXT,
  salary_amount     REAL DEFAULT 0,
  bank_account      TEXT,
  address           TEXT,
  emergency_contact TEXT,
  dob               TEXT,
  gender            TEXT,
  photo_url         TEXT,
  documents         TEXT DEFAULT '[]',
  status            TEXT DEFAULT 'active' CHECK (status IN ('active','on_leave','resigned','terminated')),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (school_id, employee_code)
);

CREATE TABLE IF NOT EXISTS students (
  id                TEXT PRIMARY KEY,
  school_id         TEXT NOT NULL,
  user_id           TEXT,
  admission_no      TEXT NOT NULL,
  roll_no           TEXT,
  full_name         TEXT NOT NULL,
  dob               TEXT,
  gender            TEXT,
  blood_group       TEXT,
  class_id          TEXT,
  section_id        TEXT,
  session_id        TEXT,
  admission_date    TEXT,
  status            TEXT DEFAULT 'active' CHECK (status IN ('active','withdrawn','alumni','suspended')),
  father_name       TEXT,
  mother_name       TEXT,
  guardian_name     TEXT,
  guardian_relation TEXT,
  phone             TEXT,
  email             TEXT,
  address           TEXT,
  city              TEXT,
  pincode           TEXT,
  emergency_contact TEXT,
  photo_url         TEXT,
  previous_school   TEXT,
  category          TEXT,
  religion          TEXT,
  nationality       TEXT DEFAULT 'Indian',
  aadhaar_last4     TEXT,
  transport_route_id TEXT,
  transport_stop_id  TEXT,
  notes             TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (school_id, admission_no)
);
CREATE INDEX IF NOT EXISTS idx_students_class ON students (school_id, session_id, class_id, section_id);
CREATE INDEX IF NOT EXISTS idx_students_name ON students (school_id, full_name);

CREATE TABLE IF NOT EXISTS parent_students (
  id              TEXT PRIMARY KEY,
  school_id       TEXT NOT NULL,
  parent_user_id  TEXT NOT NULL,
  student_id      TEXT NOT NULL,
  relation        TEXT DEFAULT 'parent',
  is_primary      INTEGER DEFAULT 1,
  created_at      TEXT NOT NULL,
  UNIQUE (parent_user_id, student_id)
);

CREATE TABLE IF NOT EXISTS student_history (
  id          TEXT PRIMARY KEY,
  school_id   TEXT NOT NULL,
  student_id  TEXT NOT NULL,
  session_name TEXT,
  class_name  TEXT,
  result      TEXT,
  percentage  REAL,
  remarks     TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  school_id   TEXT NOT NULL,
  owner_type  TEXT NOT NULL,
  owner_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  category    TEXT DEFAULT 'general',
  file_url    TEXT NOT NULL,
  mime        TEXT,
  size        INTEGER,
  uploaded_by TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents (owner_type, owner_id);

-- ---------- Attendance ----------
CREATE TABLE IF NOT EXISTS attendance (
  id          TEXT PRIMARY KEY,
  school_id   TEXT NOT NULL,
  session_id  TEXT,
  date        TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('student','employee')),
  entity_id   TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('present','absent','late','leave','half_day')),
  class_id    TEXT,
  section_id  TEXT,
  remark      TEXT,
  marked_by   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (school_id, date, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (school_id, date, class_id, section_id);
CREATE INDEX IF NOT EXISTS idx_attendance_entity ON attendance (entity_type, entity_id, date);

CREATE TABLE IF NOT EXISTS leave_applications (
  id          TEXT PRIMARY KEY,
  school_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  employee_id TEXT,
  from_date   TEXT NOT NULL,
  to_date     TEXT NOT NULL,
  type        TEXT DEFAULT 'casual',
  reason      TEXT,
  status      TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by  TEXT,
  decided_at  TEXT,
  decision_note TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payroll (
  id         TEXT PRIMARY KEY,
  school_id  TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  month      TEXT NOT NULL,            -- YYYY-MM
  basic      REAL DEFAULT 0,
  allowances REAL DEFAULT 0,
  deductions REAL DEFAULT 0,
  net        REAL DEFAULT 0,
  status     TEXT DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')),
  paid_on    TEXT,
  method     TEXT,
  remarks    TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (employee_id, month)
);

CREATE TABLE IF NOT EXISTS staff_performance (
  id          TEXT PRIMARY KEY,
  school_id   TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  period      TEXT,
  rating      REAL,
  strengths   TEXT,
  improvements TEXT,
  reviewer_id TEXT,
  created_at  TEXT NOT NULL
);

-- ---------- Examinations ----------
CREATE TABLE IF NOT EXISTS grading_scales (
  id         TEXT PRIMARY KEY,
  school_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  is_default INTEGER DEFAULT 0,
  ranges     TEXT NOT NULL,   -- [{min,max,grade,points,remark}]
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exams (
  id                 TEXT PRIMARY KEY,
  school_id          TEXT NOT NULL,
  session_id         TEXT NOT NULL,
  name               TEXT NOT NULL,
  type               TEXT DEFAULT 'term',
  description        TEXT,
  start_date         TEXT,
  end_date           TEXT,
  status             TEXT DEFAULT 'draft' CHECK (status IN ('draft','marks_entry','marks_complete','finalized','published','archived')),
  grading_scale_id   TEXT,
  pass_percentage    REAL DEFAULT 33,
  tie_break          TEXT DEFAULT 'total_desc',
  weightage          REAL DEFAULT 100,
  show_rank          INTEGER DEFAULT 1,
  result_published_at TEXT,
  finalized_at       TEXT,
  finalized_by       TEXT,
  instructions       TEXT,
  created_by         TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exams_school ON exams (school_id, session_id, status);

CREATE TABLE IF NOT EXISTS exam_classes (
  id         TEXT PRIMARY KEY,
  school_id  TEXT NOT NULL,
  exam_id    TEXT NOT NULL,
  class_id   TEXT NOT NULL,
  section_id TEXT,
  status     TEXT DEFAULT 'pending' CHECK (status IN ('pending','marks_entry','marks_complete','finalized','published'))
);
CREATE INDEX IF NOT EXISTS idx_exam_classes ON exam_classes (exam_id);

CREATE TABLE IF NOT EXISTS exam_subjects (
  id              TEXT PRIMARY KEY,
  school_id       TEXT NOT NULL,
  exam_id         TEXT NOT NULL,
  exam_class_id   TEXT NOT NULL,
  class_id        TEXT NOT NULL,
  section_id      TEXT,
  subject_id      TEXT NOT NULL,
  teacher_id      TEXT,
  max_marks       REAL NOT NULL DEFAULT 100,
  pass_marks      REAL DEFAULT 33,
  theory_max      REAL,
  practical_max   REAL,
  weightage       REAL DEFAULT 100,
  exam_date       TEXT,
  is_optional     INTEGER DEFAULT 0,
  sort_order      INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_exam_subjects_exam ON exam_subjects (exam_id, exam_class_id);

CREATE TABLE IF NOT EXISTS exam_marks (
  id              TEXT PRIMARY KEY,
  school_id       TEXT NOT NULL,
  exam_subject_id TEXT NOT NULL,
  student_id      TEXT NOT NULL,
  theory_marks    REAL,
  practical_marks REAL,
  marks_obtained  REAL,
  is_absent       INTEGER DEFAULT 0,
  is_exempt       INTEGER DEFAULT 0,
  entered_by      TEXT,
  entered_at      TEXT,
  updated_at      TEXT,
  UNIQUE (exam_subject_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_exam_marks_student ON exam_marks (student_id);

CREATE TABLE IF NOT EXISTS exam_results (
  id                TEXT PRIMARY KEY,
  school_id         TEXT NOT NULL,
  exam_id           TEXT NOT NULL,
  student_id        TEXT NOT NULL,
  class_id          TEXT,
  section_id        TEXT,
  session_id        TEXT,
  total_obtained    REAL DEFAULT 0,
  total_max         REAL DEFAULT 0,
  percentage        REAL DEFAULT 0,
  grade             TEXT,
  gpa               REAL,
  rank              INTEGER,
  section_rank      INTEGER,
  result_status     TEXT DEFAULT 'pending',
  failed_subjects   INTEGER DEFAULT 0,
  subjects_data     TEXT DEFAULT '[]',
  attendance_present INTEGER DEFAULT 0,
  attendance_total   INTEGER DEFAULT 0,
  teacher_remark    TEXT,
  principal_remark  TEXT,
  is_published      INTEGER DEFAULT 0,
  computed_at       TEXT,
  remarks_locked    INTEGER DEFAULT 0,
  UNIQUE (exam_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_exam_results_exam ON exam_results (exam_id, class_id, section_id);

CREATE TABLE IF NOT EXISTS result_revisions (
  id          TEXT PRIMARY KEY,
  school_id   TEXT NOT NULL,
  result_id   TEXT NOT NULL,
  exam_id     TEXT NOT NULL,
  changed_by  TEXT,
  reason      TEXT NOT NULL,
  before_json TEXT,
  after_json  TEXT,
  created_at  TEXT NOT NULL
);

-- ---------- Fees ----------
CREATE TABLE IF NOT EXISTS fee_heads (
  id          TEXT PRIMARY KEY,
  school_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  code        TEXT,
  type        TEXT DEFAULT 'annual' CHECK (type IN ('one_time','monthly','quarterly','annual','custom')),
  description TEXT,
  is_active   INTEGER DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fee_structures (
  id          TEXT PRIMARY KEY,
  school_id   TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  class_id    TEXT,
  description TEXT,
  is_active   INTEGER DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fee_structure_items (
  id                TEXT PRIMARY KEY,
  school_id         TEXT NOT NULL,
  fee_structure_id  TEXT NOT NULL,
  fee_head_id       TEXT NOT NULL,
  amount            REAL NOT NULL DEFAULT 0,
  frequency         TEXT DEFAULT 'annual',
  due_day           INTEGER DEFAULT 10,
  is_optional       INTEGER DEFAULT 0,
  sort_order        INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS student_fees (
  id               TEXT PRIMARY KEY,
  school_id        TEXT NOT NULL,
  session_id       TEXT NOT NULL,
  student_id       TEXT NOT NULL,
  fee_structure_id TEXT,
  gross_amount     REAL DEFAULT 0,
  discount_amount  REAL DEFAULT 0,
  net_amount       REAL DEFAULT 0,
  paid_amount      REAL DEFAULT 0,
  due_amount       REAL DEFAULT 0,
  status           TEXT DEFAULT 'pending' CHECK (status IN ('pending','partial','paid','waived')),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (session_id, student_id)
);

CREATE TABLE IF NOT EXISTS student_discounts (
  id           TEXT PRIMARY KEY,
  school_id    TEXT NOT NULL,
  student_id   TEXT NOT NULL,
  session_id   TEXT,
  kind         TEXT DEFAULT 'discount' CHECK (kind IN ('discount','scholarship','concession','waiver')),
  name         TEXT NOT NULL,
  calc_type    TEXT DEFAULT 'fixed' CHECK (calc_type IN ('fixed','percent')),
  value        REAL NOT NULL DEFAULT 0,
  amount       REAL DEFAULT 0,
  reason       TEXT,
  approved_by  TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id           TEXT PRIMARY KEY,
  school_id    TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  student_id   TEXT NOT NULL,
  invoice_no   TEXT NOT NULL,
  issue_date   TEXT NOT NULL,
  due_date     TEXT NOT NULL,
  period       TEXT,
  subtotal     REAL DEFAULT 0,
  discount     REAL DEFAULT 0,
  late_fee     REAL DEFAULT 0,
  total        REAL DEFAULT 0,
  amount_paid  REAL DEFAULT 0,
  balance      REAL DEFAULT 0,
  status       TEXT DEFAULT 'unpaid' CHECK (status IN ('draft','unpaid','partial','paid','overdue','cancelled')),
  notes        TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (school_id, invoice_no)
);
CREATE INDEX IF NOT EXISTS idx_invoices_student ON invoices (school_id, student_id, status);

CREATE TABLE IF NOT EXISTS invoice_items (
  id          TEXT PRIMARY KEY,
  school_id   TEXT NOT NULL,
  invoice_id  TEXT NOT NULL,
  fee_head_id TEXT,
  description TEXT NOT NULL,
  amount      REAL NOT NULL DEFAULT 0,
  quantity    REAL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS payments (
  id                  TEXT PRIMARY KEY,
  school_id           TEXT NOT NULL,
  invoice_id          TEXT,
  student_id          TEXT,
  amount              REAL NOT NULL,
  currency            TEXT DEFAULT 'INR',
  method              TEXT NOT NULL,
  status              TEXT DEFAULT 'pending' CHECK (status IN ('pending','success','failed','refunded','partially_refunded')),
  gateway             TEXT,
  gateway_order_id    TEXT,
  gateway_payment_id  TEXT,
  gateway_signature   TEXT,
  txn_ref             TEXT,
  receipt_no          TEXT,
  paid_at             TEXT,
  recorded_by         TEXT,
  notes               TEXT,
  failure_reason      TEXT,
  idempotency_key     TEXT,
  raw                 TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_idem ON payments (school_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments (school_id, student_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments (school_id, paid_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_receipt ON payments (school_id, receipt_no) WHERE receipt_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS refunds (
  id           TEXT PRIMARY KEY,
  school_id    TEXT NOT NULL,
  payment_id   TEXT NOT NULL,
  student_id   TEXT,
  amount       REAL NOT NULL,
  reason       TEXT,
  status       TEXT DEFAULT 'processed' CHECK (status IN ('pending','processed','failed')),
  ref          TEXT,
  processed_by TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id           TEXT PRIMARY KEY,
  school_id    TEXT NOT NULL,
  session_id   TEXT,
  category     TEXT NOT NULL,
  description  TEXT,
  amount       REAL NOT NULL,
  expense_date TEXT NOT NULL,
  paid_to      TEXT,
  method       TEXT DEFAULT 'cash',
  voucher_no   TEXT,
  attachment_url TEXT,
  recorded_by  TEXT,
  created_at   TEXT NOT NULL
);

-- ---------- Library ----------
CREATE TABLE IF NOT EXISTS book_categories (
  id        TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  name      TEXT NOT NULL,
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS books (
  id               TEXT PRIMARY KEY,
  school_id        TEXT NOT NULL,
  title            TEXT NOT NULL,
  author           TEXT,
  isbn             TEXT,
  publisher        TEXT,
  category_id      TEXT,
  edition          TEXT,
  rack             TEXT,
  total_copies     INTEGER DEFAULT 1,
  available_copies INTEGER DEFAULT 1,
  price            REAL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS book_issues (
  id             TEXT PRIMARY KEY,
  school_id      TEXT NOT NULL,
  book_id        TEXT NOT NULL,
  borrower_type  TEXT NOT NULL CHECK (borrower_type IN ('student','employee')),
  borrower_id    TEXT NOT NULL,
  issue_date     TEXT NOT NULL,
  due_date       TEXT NOT NULL,
  return_date    TEXT,
  status         TEXT DEFAULT 'issued' CHECK (status IN ('issued','returned','overdue','lost')),
  fine           REAL DEFAULT 0,
  fine_paid      INTEGER DEFAULT 0,
  issued_by      TEXT,
  returned_to    TEXT,
  remarks        TEXT
);
CREATE INDEX IF NOT EXISTS idx_book_issues_borrower ON book_issues (borrower_type, borrower_id, status);

-- ---------- Transport ----------
CREATE TABLE IF NOT EXISTS vehicles (
  id                 TEXT PRIMARY KEY,
  school_id          TEXT NOT NULL,
  registration_no    TEXT NOT NULL,
  model              TEXT,
  capacity           INTEGER DEFAULT 40,
  driver_name        TEXT,
  driver_phone       TEXT,
  driver_license     TEXT,
  driver_employee_id TEXT,
  insurance_expiry   TEXT,
  fitness_expiry     TEXT,
  status             TEXT DEFAULT 'active' CHECK (status IN ('active','maintenance','inactive')),
  notes              TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (school_id, registration_no)
);

CREATE TABLE IF NOT EXISTS transport_routes (
  id              TEXT PRIMARY KEY,
  school_id       TEXT NOT NULL,
  name            TEXT NOT NULL,
  code            TEXT,
  vehicle_id      TEXT,
  driver_employee_id TEXT,
  start_point     TEXT,
  end_point       TEXT,
  distance_km     REAL,
  fee_amount      REAL DEFAULT 0,
  status          TEXT DEFAULT 'active',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transport_stops (
  id          TEXT PRIMARY KEY,
  school_id   TEXT NOT NULL,
  route_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  pickup_time TEXT,
  drop_time   TEXT,
  landmark    TEXT,
  fee_amount  REAL DEFAULT 0,
  sort_order  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vehicle_maintenance (
  id          TEXT PRIMARY KEY,
  school_id   TEXT NOT NULL,
  vehicle_id  TEXT NOT NULL,
  service_date TEXT NOT NULL,
  type        TEXT,
  cost        REAL DEFAULT 0,
  garage      TEXT,
  notes       TEXT,
  next_service_date TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transport_attendance (
  id         TEXT PRIMARY KEY,
  school_id  TEXT NOT NULL,
  route_id   TEXT NOT NULL,
  student_id TEXT NOT NULL,
  date       TEXT NOT NULL,
  direction  TEXT DEFAULT 'pickup',
  status     TEXT DEFAULT 'present' CHECK (status IN ('present','absent')),
  boarded_at TEXT,
  UNIQUE (route_id, student_id, date, direction)
);

-- ---------- Learning ----------
CREATE TABLE IF NOT EXISTS assignments (
  id            TEXT PRIMARY KEY,
  school_id     TEXT NOT NULL,
  session_id    TEXT,
  class_id      TEXT NOT NULL,
  section_id    TEXT,
  subject_id    TEXT,
  teacher_id    TEXT,
  title         TEXT NOT NULL,
  description   TEXT,
  instructions  TEXT,
  due_date      TEXT,
  max_marks     REAL,
  attachment_url TEXT,
  status        TEXT DEFAULT 'published' CHECK (status IN ('draft','published','closed')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignment_submissions (
  id            TEXT PRIMARY KEY,
  school_id     TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  student_id    TEXT NOT NULL,
  content       TEXT,
  attachment_url TEXT,
  submitted_at  TEXT NOT NULL,
  status        TEXT DEFAULT 'submitted' CHECK (status IN ('submitted','graded','returned','late')),
  marks         REAL,
  feedback      TEXT,
  graded_by     TEXT,
  graded_at     TEXT,
  UNIQUE (assignment_id, student_id)
);

CREATE TABLE IF NOT EXISTS study_materials (
  id           TEXT PRIMARY KEY,
  school_id    TEXT NOT NULL,
  class_id     TEXT,
  section_id   TEXT,
  subject_id   TEXT,
  teacher_id   TEXT,
  title        TEXT NOT NULL,
  description  TEXT,
  type         TEXT DEFAULT 'document',
  file_url     TEXT,
  external_url TEXT,
  visible_to   TEXT DEFAULT 'students',
  created_at   TEXT NOT NULL
);

-- ---------- Communication ----------
CREATE TABLE IF NOT EXISTS announcements (
  id            TEXT PRIMARY KEY,
  school_id     TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  audience      TEXT DEFAULT 'all',
  role_target   TEXT,
  class_id      TEXT,
  section_id    TEXT,
  priority      TEXT DEFAULT 'normal' CHECK (priority IN ('normal','high','emergency')),
  attachment_url TEXT,
  publish_at    TEXT NOT NULL,
  expires_at    TEXT,
  send_email    INTEGER DEFAULT 0,
  send_sms      INTEGER DEFAULT 0,
  send_push     INTEGER DEFAULT 1,
  created_by    TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS message_threads (
  id              TEXT PRIMARY KEY,
  school_id       TEXT NOT NULL,
  subject         TEXT,
  student_id      TEXT,
  participant_a   TEXT NOT NULL,
  participant_b   TEXT NOT NULL,
  last_message_at TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_threads_a ON message_threads (school_id, participant_a);
CREATE INDEX IF NOT EXISTS idx_threads_b ON message_threads (school_id, participant_b);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  school_id  TEXT NOT NULL,
  thread_id  TEXT NOT NULL,
  sender_id  TEXT NOT NULL,
  body       TEXT NOT NULL,
  read_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (thread_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  school_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  type       TEXT DEFAULT 'info',
  link       TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (school_id, user_id, read_at);

CREATE TABLE IF NOT EXISTS notification_templates (
  id         TEXT PRIMARY KEY,
  school_id  TEXT NOT NULL,
  key        TEXT NOT NULL,
  name       TEXT NOT NULL,
  channel    TEXT DEFAULT 'in_app',
  subject    TEXT,
  body       TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (school_id, key, channel)
);

CREATE TABLE IF NOT EXISTS outbox (
  id         TEXT PRIMARY KEY,
  school_id  TEXT NOT NULL,
  channel    TEXT NOT NULL CHECK (channel IN ('email','sms','push')),
  recipient  TEXT NOT NULL,
  subject    TEXT,
  body       TEXT,
  status     TEXT DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped')),
  error      TEXT,
  attempts   INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  sent_at    TEXT
);

-- ---------- Timetable ----------
CREATE TABLE IF NOT EXISTS timetable_periods (
  id         TEXT PRIMARY KEY,
  school_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  is_break   INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS timetable_entries (
  id         TEXT PRIMARY KEY,
  school_id  TEXT NOT NULL,
  session_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  period_id  TEXT NOT NULL,
  day        INTEGER NOT NULL CHECK (day BETWEEN 1 AND 7),
  subject_id TEXT,
  teacher_id TEXT,
  room       TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (section_id, day, period_id)
);
CREATE INDEX IF NOT EXISTS idx_timetable_teacher ON timetable_entries (school_id, teacher_id, day);

-- ---------- Website / public ----------
CREATE TABLE IF NOT EXISTS website_pages (
  id         TEXT PRIMARY KEY,
  school_id  TEXT NOT NULL,
  slug       TEXT NOT NULL,
  title      TEXT NOT NULL,
  content    TEXT,
  blocks     TEXT DEFAULT '[]',
  is_published INTEGER DEFAULT 1,
  show_in_nav INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE (school_id, slug)
);

CREATE TABLE IF NOT EXISTS news_posts (
  id          TEXT PRIMARY KEY,
  school_id   TEXT NOT NULL,
  title       TEXT NOT NULL,
  excerpt     TEXT,
  body        TEXT,
  cover_url   TEXT,
  category    TEXT DEFAULT 'news',
  author      TEXT,
  is_published INTEGER DEFAULT 1,
  published_at TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admission_inquiries (
  id            TEXT PRIMARY KEY,
  school_id     TEXT NOT NULL,
  student_name  TEXT NOT NULL,
  parent_name   TEXT,
  email         TEXT,
  phone         TEXT,
  class_applied TEXT,
  message       TEXT,
  status        TEXT DEFAULT 'new' CHECK (status IN ('new','contacted','enrolled','rejected')),
  notes         TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id         TEXT PRIMARY KEY,
  school_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  email      TEXT,
  phone      TEXT,
  subject    TEXT,
  message    TEXT,
  status     TEXT DEFAULT 'new',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backups (
  id          TEXT PRIMARY KEY,
  school_id   TEXT,
  filename    TEXT NOT NULL,
  size        INTEGER,
  kind        TEXT DEFAULT 'manual',
  created_by  TEXT,
  created_at  TEXT NOT NULL
);
