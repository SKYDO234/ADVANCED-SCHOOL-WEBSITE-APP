/**
 * Demo data generator.
 *
 *   npm run seed:demo            # seeds only if the database is empty
 *   npm run seed:demo -- --force # wipes existing data first (DESTRUCTIVE)
 *
 * The generated school is flagged is_demo = 1 so the UI can label it clearly.
 * Real deployments use the first-run setup wizard and never run this script.
 */
import { db, newId, nowIso, setSetting, DB_FILE } from './index.js';
import { bootstrapSchool, createAcademicSession, DEFAULT_PERIODS } from '../lib/defaults.js';
import { hashPassword } from '../lib/auth.js';
import { computeExamResults } from '../routes/exams.js';
import { nextReceiptNo, nextInvoiceNo, recomputeInvoice } from '../lib/fees.js';

const args = process.argv.slice(2);
const FORCE = args.includes('--force');

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];
const chance = (p) => Math.random() < p;
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (days) => iso(new Date(Date.now() + days * 86_400_000));
const at = (d = new Date()) => d.toISOString();

/* ----------------------------------- data ---------------------------------- */

const FIRST_NAMES = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan',
  'Ananya', 'Diya', 'Aadhya', 'Saanvi', 'Pari', 'Anika', 'Navya', 'Myra', 'Sara', 'Aarohi',
  'Kabir', 'Rudra', 'Dhruv', 'Yash', 'Rohan', 'Neha', 'Priya', 'Riya', 'Tara', 'Meera',
  'Advait', 'Atharv', 'Shaurya', 'Pranav', 'Nikhil', 'Sneha', 'Kavya', 'Isha', 'Trisha', 'Ritika'];
const LAST_NAMES = ['Sharma', 'Verma', 'Gupta', 'Banerjee', 'Chatterjee', 'Mukherjee', 'Das', 'Sen', 'Roy', 'Iyer',
  'Nair', 'Reddy', 'Patel', 'Mehta', 'Joshi', 'Kapoor', 'Malhotra', 'Bose', 'Dutta', 'Ghosh'];
const STAFF_FIRST = ['Rakesh', 'Sunita', 'Mahesh', 'Lakshmi', 'Arvind', 'Pooja', 'Sandeep', 'Ritu', 'Vikram', 'Anjali',
  'Deepak', 'Shalini', 'Manoj', 'Kiran', 'Sanjay', 'Reena', 'Alok', 'Meenakshi'];

const SUBJECTS = [
  ['English', 'ENG', 'theory'], ['Hindi', 'HIN', 'theory'], ['Mathematics', 'MAT', 'theory'],
  ['Science', 'SCI', 'both'], ['Social Science', 'SST', 'theory'], ['Computer Science', 'CSC', 'both'],
  ['Art & Craft', 'ART', 'practical'], ['Physical Education', 'PED', 'practical'],
];

const CLASS_NAMES = ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10'];

const FEE_PLAN = {
  'Class 1': { tuition: 2200, annual: 6000 }, 'Class 2': { tuition: 2300, annual: 6000 },
  'Class 3': { tuition: 2400, annual: 6500 }, 'Class 4': { tuition: 2500, annual: 6500 },
  'Class 5': { tuition: 2600, annual: 7000 }, 'Class 6': { tuition: 2900, annual: 7500 },
  'Class 7': { tuition: 3100, annual: 7500 }, 'Class 8': { tuition: 3300, annual: 8000 },
  'Class 9': { tuition: 3600, annual: 9000 }, 'Class 10': { tuition: 3900, annual: 9500 },
};

/* --------------------------------- helpers -------------------------------- */

function wipe() {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
  db.exec('PRAGMA foreign_keys = OFF');
  for (const t of tables) db.exec(`DELETE FROM ${t}`);
  db.exec('PRAGMA foreign_keys = ON');
}

function insert(table, row) {
  const cols = Object.keys(row);
  const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
  stmt.run(...Object.values(row));
}

function createUser({ schoolId, email, username, password, full_name, role, role_id, phone, department, designation }) {
  const id = newId('usr');
  insert('users', {
    id, school_id: schoolId, email: email.toLowerCase(), username: username || null,
    password_hash: hashPassword(password), full_name,
    phone: phone || null, role, role_id: role_id || null, department: department || null,
    designation: designation || null, status: 'active', must_change_password: 0,
    created_at: at(), updated_at: at(),
  });
  return id;
}

/* ---------------------------------- seed ----------------------------------- */

function seed() {
  const existing = db.prepare('SELECT COUNT(*) c FROM schools').get().c;
  if (existing && !FORCE) {
    console.log('[seed] A school already exists. Re-run with --force to wipe and reseed.');
    process.exit(0);
  }
  if (FORCE) {
    console.log('[seed] wiping existing data…');
    wipe();
  }

  const schoolId = newId('sch');
  const now = new Date();
  insert('schools', {
    id: schoolId, name: 'Sunrise International School', code: 'SIS',
    tagline: 'Learning with purpose, growing with character',
    address: '12 Park Street, Near Allen Park', city: 'Kolkata', state: 'West Bengal', pincode: '700016',
    country: 'India', phone: '+91 33 4000 1234', email: 'office@sunrise.edu.in',
    website: 'https://sunrise.edu.in', affiliation: 'CBSE Affiliation No. 1234567',
    principal_name: 'Dr. Ananya Sen', currency: 'INR', currency_symbol: '₹', timezone: 'Asia/Kolkata',
    locale: 'en-IN', working_days: '[1,2,3,4,5,6]', is_demo: 1, is_active: 1, created_at: at(), updated_at: at(),
  });

  const { roleIds } = bootstrapSchool(schoolId);
  console.log('[seed] school + roles + defaults created');

  // Academic sessions
  const oldSession = createAcademicSession(schoolId, { name: '2025-2026', start_date: '2025-04-01', end_date: '2026-03-31', is_current: 0 });
  const session = createAcademicSession(schoolId, { name: '2026-2027', start_date: '2026-04-01', end_date: '2027-03-31', is_current: 1 });
  setSetting(schoolId, 'academic', 'currentSessionId', session);

  // Principal
  const principalId = createUser({
    schoolId, email: 'principal@sunrise.edu.in', password: 'Principal@123', full_name: 'Dr. Ananya Sen',
    role: 'principal', role_id: roleIds.principal, phone: '+91 98300 11111', designation: 'Principal',
  });

  // Built-in super administrator — signs in with `admin` / `admin123`.
  createUser({
    schoolId, email: 'admin@sunrise.edu.in', username: 'admin', password: 'admin123', full_name: 'Super Admin',
    role: 'principal', role_id: roleIds.principal, phone: '+91 98300 00000', designation: 'System Administrator',
  });

  // Classes & sections
  const classes = [];
  const sections = [];
  CLASS_NAMES.forEach((name, idx) => {
    const classId = newId('cls');
    insert('classes', { id: classId, school_id: schoolId, name, code: `C${idx + 1}`, order_index: idx + 1, created_at: at(), updated_at: at() });
    classes.push({ id: classId, name, index: idx + 1 });
    const sectionNames = idx < 5 ? ['A', 'B'] : ['A'];
    sectionNames.forEach((secName, sIdx) => {
      const sectionId = newId('sec');
      insert('sections', {
        id: sectionId, school_id: schoolId, class_id: classId, name: secName,
        room: `${idx + 1}${secName}${sIdx + 1}`, capacity: 40, created_at: at(), updated_at: at(),
      });
      sections.push({ id: sectionId, class_id: classId, name: secName, classIndex: idx + 1 });
    });
  });

  // Subjects
  const subjects = SUBJECTS.map(([name, code, type]) => {
    const id = newId('sub');
    insert('subjects', { id, school_id: schoolId, name, code, type, created_at: at(), updated_at: at() });
    return { id, name };
  });

  // Teachers
  const teacherSpecs = [
    ['Rekha Banerjee', 'English', 'Senior English Teacher'], ['Sourav Das', 'Mathematics', 'Head of Mathematics'],
    ['Priyanka Ghosh', 'Science', 'Science Teacher'], ['Amitava Roy', 'Social Science', 'History Teacher'],
    ['Nandita Sen', 'Hindi', 'Hindi Teacher'], ['Rahul Bose', 'Computer Science', 'IT Coordinator'],
    ['Shreya Dutta', 'Art & Craft', 'Art Teacher'], ['Vivek Nair', 'Physical Education', 'Sports Coach'],
    ['Kavita Menon', 'English', 'English Teacher'], ['Anil Kapoor', 'Mathematics', 'Mathematics Teacher'],
    ['Suman Mukherjee', 'Science', 'Physics Teacher'], ['Rupa Iyer', 'Social Science', 'Geography Teacher'],
    ['Deepa Patel', 'Hindi', 'Hindi Teacher'], ['Sanjoy Chatterjee', 'Computer Science', 'Computer Teacher'],
    ['Mitali Joshi', 'Art & Craft', 'Craft Teacher'], ['Ramesh Reddy', 'Physical Education', 'PE Teacher'],
    ['Tanuja Verma', 'English', 'Primary Teacher'], ['Prasenjit Malhotra', 'Mathematics', 'Primary Teacher'],
    ['Ipsita Guha', 'Science', 'Biology Teacher'], ['Kunal Mehta', 'Social Science', 'Civics Teacher'],
  ];
  const teachers = teacherSpecs.map(([name, subject, designation], idx) => {
    const userId = createUser({
      schoolId, email: `teacher${idx + 1}@sunrise.edu.in`, password: 'Teacher@123', full_name: name,
      role: 'teacher', role_id: roleIds.teacher, phone: `+91 98300 2${String(idx).padStart(4, '0')}`,
      department: 'academics', designation,
    });
    const employeeId = newId('emp');
    insert('employees', {
      id: employeeId, school_id: schoolId, user_id: userId, employee_code: `EMP${String(idx + 1).padStart(4, '0')}`,
      department: 'academics', designation, employment_type: 'full_time',
      joining_date: addDays(-400 - idx * 30), qualification: pick(['M.A., B.Ed.', 'M.Sc., B.Ed.', 'B.Ed.', 'M.Com., B.Ed.']),
      specialization: subject, salary_amount: 38000 + idx * 1200, status: 'active', created_at: at(), updated_at: at(),
    });
    return { userId, employeeId, name, subject };
  });

  // Non-teaching staff
  const staffSpecs = [
    ['accounts@sunrise.edu.in', 'Rakesh Agarwal', 'accounts', 'Accounts Officer'],
    ['reception@sunrise.edu.in', 'Sunita Rao', 'reception', 'Front Desk Executive'],
    ['exams@sunrise.edu.in', 'Mahesh Pillai', 'examination', 'Examination Coordinator'],
    ['library@sunrise.edu.in', 'Lakshmi Iyer', 'library', 'Librarian'],
    ['transport@sunrise.edu.in', 'Arvind Yadav', 'transport', 'Transport Manager'],
    ['hr@sunrise.edu.in', 'Pooja Deshmukh', 'hr', 'HR Executive'],
    ['office@sunrise.edu.in', 'Sandeep Kulkarni', 'office', 'Office Administrator'],
    ['accounts2@sunrise.edu.in', 'Ritu Chawla', 'accounts', 'Accounts Assistant'],
  ];
  const staff = staffSpecs.map(([email, name, department, designation], idx) => {
    const userId = createUser({
      schoolId, email, password: 'Staff@123', full_name: name, role: 'staff', role_id: roleIds.staff,
      phone: `+91 98310 3${String(idx).padStart(4, '0')}`, department, designation,
    });
    const employeeId = newId('emp');
    insert('employees', {
      id: employeeId, school_id: schoolId, user_id: userId, employee_code: `EMP${String(100 + idx).padStart(4, '0')}`,
      department, designation, employment_type: 'full_time', joining_date: addDays(-500 - idx * 40),
      salary_amount: 26000 + idx * 1500, status: 'active', created_at: at(), updated_at: at(),
    });
    return { userId, employeeId, department };
  });

  // Class teacher assignment (section -> first teacher)
  sections.forEach((sec, idx) => {
    db.prepare('UPDATE sections SET class_teacher_id = ? WHERE id = ?').run(teachers[idx % teachers.length].userId, sec.id);
  });

  // Class subject assignments: every subject taught in every section
  const assignments = [];
  sections.forEach((sec) => {
    subjects.forEach((subject, idx) => {
      const candidates = teachers.filter((t) => t.subject === subject.name);
      const teacher = candidates.length ? candidates[Math.floor(sec.classIndex / 2) % candidates.length] : teachers[idx % teachers.length];
      const id = newId('cs');
      insert('class_subjects', {
        id, school_id: schoolId, session_id: session, class_id: sec.class_id, section_id: sec.id,
        subject_id: subject.id, teacher_id: teacher.userId, periods_week: 5, created_at: at(), updated_at: at(),
      });
      assignments.push({ sectionId: sec.id, classId: sec.class_id, subjectId: subject.id, teacherId: teacher.userId });
    });
  });

  // Students + parents
  const students = [];
  let admissionCounter = 0;
  sections.forEach((sec, secIdx) => {
    const count = 12 + (secIdx % 3);
    for (let i = 0; i < count; i += 1) {
      admissionCounter += 1;
      const first = pick(FIRST_NAMES);
      const last = pick(LAST_NAMES);
      const fullName = `${first} ${last}`;
      const gender = chance(0.5) ? 'male' : 'female';
      const year = 2027 - (sec.classIndex + 5);
      const dob = `${year}-${String(1 + rnd(12)).padStart(2, '0')}-${String(1 + rnd(28)).padStart(2, '0')}`;
      const admissionNo = `ADM2026${String(admissionCounter).padStart(4, '0')}`;
      const studentId = newId('stu');
      const parentFirst = pick(STAFF_FIRST.slice(0, 8));
      const fatherName = `${chance(0.8) ? 'Mr.' : 'Dr.'} ${parentFirst} ${last}`;
      const motherName = `${pick(FIRST_NAMES.slice(10, 20))} ${last}`;
      const phone = `+91 9${String(800000000 + rnd(99999999)).slice(0, 9)}`;
      insert('students', {
        id: studentId, school_id: schoolId, admission_no: admissionNo, roll_no: String(i + 1).padStart(2, '0'),
        full_name: fullName, dob, gender, blood_group: pick(['A+', 'B+', 'O+', 'AB+', 'O-']),
        class_id: sec.class_id, section_id: sec.id, session_id: session,
        admission_date: addDays(-200 - rnd(400)), status: 'active', father_name: fatherName, mother_name: motherName,
        guardian_name: fatherName, guardian_relation: 'father', phone, email: `${first.toLowerCase()}.${last.toLowerCase()}${admissionCounter}@student.sunrise.edu.in`,
        address: `${1 + rnd(120)} ${pick(['Lake Road', 'Salt Lake Sector 2', 'Ballygunge Place', 'New Town', 'Behala Chowrasta'])}`,
        city: 'Kolkata', pincode: '7000' + String(10 + rnd(89)), emergency_contact: phone,
        category: pick(['General', 'OBC', 'SC', 'ST']), religion: pick(['Hindu', 'Muslim', 'Christian', 'Sikh']),
        nationality: 'Indian', created_at: at(), updated_at: at(),
      });

      const parentUserId = createUser({
        schoolId, email: `parent${admissionCounter}@example.com`, password: 'Parent@123',
        full_name: fatherName, role: 'parent', role_id: roleIds.parent, phone,
      });
      insert('parent_students', {
        id: newId('ps'), school_id: schoolId, parent_user_id: parentUserId, student_id: studentId,
        relation: 'father', is_primary: 1, created_at: at(),
      });

      // A few students also get their own login
      let studentUserId = null;
      if (admissionCounter % 25 === 0) {
        studentUserId = createUser({
          schoolId, email: `student${admissionCounter}@example.com`, password: 'Student@123',
          full_name: fullName, role: 'student', role_id: roleIds.student, phone,
        });
        db.prepare('UPDATE students SET user_id = ? WHERE id = ?').run(studentUserId, studentId);
      }

      students.push({
        id: studentId, name: fullName, classId: sec.class_id, sectionId: sec.id, classIndex: sec.classIndex,
        admissionNo, parentUserId, studentUserId,
      });
    }
  });
  console.log(`[seed] ${students.length} students, ${teachers.length} teachers, ${staff.length} staff`);

  // Timetable (greedy, conflict-free)
  const periods = db.prepare('SELECT * FROM timetable_periods WHERE school_id = ? ORDER BY sort_order').all(schoolId);
  const teachingPeriods = periods.filter((p) => !p.is_break);
  const busy = new Set();
  sections.forEach((sec) => {
    const secAssignments = assignments.filter((a) => a.sectionId === sec.id);
    for (let day = 1; day <= 6; day += 1) {
      teachingPeriods.forEach((period, pIdx) => {
        const candidates = secAssignments.filter((a) => !busy.has(`${a.teacherId}:${day}:${period.id}`));
        if (!candidates.length) return;
        const choice = candidates[(pIdx + day) % candidates.length];
        busy.add(`${choice.teacherId}:${day}:${period.id}`);
        insert('timetable_entries', {
          id: newId('tte'), school_id: schoolId, session_id: session, section_id: sec.id, period_id: period.id,
          day, subject_id: choice.subjectId, teacher_id: choice.teacherId, room: null, created_at: at(), updated_at: at(),
        });
      });
    }
  });

  // Fee heads & structures
  const heads = db.prepare('SELECT * FROM fee_heads WHERE school_id = ?').all(schoolId);
  const headId = (code) => heads.find((h) => h.code === code)?.id;
  classes.forEach((cls) => {
    const plan = FEE_PLAN[cls.name];
    const structureId = newId('fst');
    insert('fee_structures', {
      id: structureId, school_id: schoolId, session_id: session, name: `${cls.name} — Annual Fee Plan`,
      class_id: cls.id, description: 'Standard fee plan for the academic session', is_active: 1, created_at: at(), updated_at: at(),
    });
    const items = [
      [headId('TUI'), plan.tuition, 'monthly', 10],
      [headId('ANN'), plan.annual, 'annual', 10],
      [headId('EXM'), 1200, 'annual', 10],
      [headId('LIB'), 600, 'annual', 10],
      [headId('SPT'), 800, 'annual', 10],
      [headId('LAB'), cls.index >= 6 ? 1500 : 0, 'annual', 10],
    ].filter((i) => i[1] > 0);
    items.forEach(([feeHeadId, amount, frequency, dueDay], idx) => {
      insert('fee_structure_items', {
        id: newId('fsi'), school_id: schoolId, fee_structure_id: structureId, fee_head_id: feeHeadId,
        amount, frequency, due_day: dueDay, is_optional: 0, sort_order: idx,
      });
    });
    cls.structureId = structureId;
    cls.gross = items.reduce((s, i) => s + i[1] * (i[2] === 'monthly' ? 12 : 1), 0);
  });

  // Student fee ledgers
  const classById = Object.fromEntries(classes.map((c) => [c.id, c]));
  students.forEach((student, idx) => {
    const cls = classById[student.classId];
    let discount = 0;
    if (idx % 23 === 0) discount = Math.round(cls.gross * 0.1);
    else if (idx % 17 === 0) discount = 5000;
    const net = cls.gross - discount;
    insert('student_fees', {
      id: newId('sf'), school_id: schoolId, session_id: session, student_id: student.id,
      fee_structure_id: cls.structureId, gross_amount: cls.gross, discount_amount: discount,
      net_amount: net, paid_amount: 0, due_amount: net, status: 'pending', created_at: at(), updated_at: at(),
    });
    if (discount) {
      insert('student_discounts', {
        id: newId('dis'), school_id: schoolId, student_id: student.id, session_id: session,
        kind: idx % 46 === 0 ? 'scholarship' : 'concession', name: idx % 46 === 0 ? 'Merit scholarship' : 'Sibling concession',
        calc_type: 'fixed', value: discount, amount: discount, reason: 'Approved by principal', approved_by: principalId, created_at: at(),
      });
    }
  });

  // Invoices for April → current month, with payments
  const currentMonth = now.getMonth() + 1;
  const months = [];
  for (let m = 4; m <= 12 && m <= Math.max(4, currentMonth); m += 1) months.push(`2026-${String(m).padStart(2, '0')}`);
  if (currentMonth <= 3) months.push(`2027-0${currentMonth}`);

  let paymentCount = 0;
  students.forEach((student, sIdx) => {
    const cls = classById[student.classId];
    const plan = FEE_PLAN[cls.name];
    const behaviour = sIdx % 10; // 0-6 fully paid, 7-8 partial, 9 unpaid
    months.forEach((month, mIdx) => {
      const subtotal = plan.tuition + (mIdx === 0 ? plan.annual + 1200 + 600 + 800 + (cls.index >= 6 ? 1500 : 0) : 0);
      const discount = sIdx % 23 === 0 ? Math.round(subtotal * 0.1) : 0;
      const total = subtotal - discount;
      const invoiceId = newId('inv');
      const dueDate = `${month}-10`;
      const issueDate = `${month}-01`;
      insert('invoices', {
        id: invoiceId, school_id: schoolId, session_id: session, student_id: student.id,
        invoice_no: `INV-2026-${String(sIdx * 12 + mIdx + 1).padStart(5, '0')}`, issue_date: issueDate, due_date: dueDate,
        period: month, subtotal, discount, late_fee: 0, total, amount_paid: 0, balance: total,
        status: 'unpaid', notes: null, created_by: principalId, created_at: at(), updated_at: at(),
      });
      insert('invoice_items', {
        id: newId('ivi'), school_id: schoolId, invoice_id: invoiceId, fee_head_id: headId('TUI'),
        description: `Tuition Fee — ${month}`, amount: plan.tuition, quantity: 1,
      });
      if (mIdx === 0) {
        [['ANN', plan.annual, 'Annual Charges'], ['EXM', 1200, 'Examination Fee'], ['LIB', 600, 'Library Fee'], ['SPT', 800, 'Sports Fee']]
          .concat(cls.index >= 6 ? [['LAB', 1500, 'Laboratory Fee']] : [])
          .forEach(([code, amount, label]) => {
            insert('invoice_items', {
              id: newId('ivi'), school_id: schoolId, invoice_id: invoiceId, fee_head_id: headId(code),
              description: label, amount, quantity: 1,
            });
          });
      }

      const isPastMonth = mIdx < months.length - 1;
      if (behaviour <= 6 || (behaviour <= 8 && isPastMonth)) {
        const payFull = behaviour <= 6;
        const amount = payFull ? total : Math.round(total * 0.5);
        const method = pick(['cash', 'upi', 'card', 'netbanking', 'razorpay']);
        const paidAt = `${month}-${String(5 + rnd(20)).padStart(2, '0')}T${String(9 + rnd(8)).padStart(2, '0')}:${String(rnd(60)).padStart(2, '0')}:00.000Z`;
        const paymentId = newId('pmy');
        insert('payments', {
          id: paymentId, school_id: schoolId, invoice_id: invoiceId, student_id: student.id, amount,
          currency: 'INR', method, status: 'success', gateway: method === 'razorpay' ? 'razorpay' : null,
          gateway_payment_id: method === 'razorpay' ? `pay_${Math.random().toString(36).slice(2, 16)}` : null,
          txn_ref: method === 'upi' ? `UPI${rnd(999999999)}` : null,
          receipt_no: `RCP-2026-${String(paymentCount + 1).padStart(5, '0')}`,
          paid_at: paidAt, recorded_by: principalId, created_at: paidAt, updated_at: paidAt,
        });
        paymentCount += 1;
        db.prepare('UPDATE invoices SET amount_paid = ?, balance = ?, status = ? WHERE id = ?')
          .run(amount, total - amount, total - amount <= 0 ? 'paid' : 'partial', invoiceId);
      }
    });
  });
  // Mark old unpaid invoices overdue
  db.prepare("UPDATE invoices SET status = 'overdue' WHERE balance > 0 AND date(due_date) < date('now')").run();
  console.log(`[seed] ${paymentCount} payments, ${students.length * months.length} invoices`);

  // Sync ledgers from invoices
  students.forEach((student) => {
    const agg = db.prepare("SELECT COALESCE(SUM(total),0) billed, COALESCE(SUM(amount_paid),0) paid FROM invoices WHERE student_id = ?").get(student.id);
    const ledger = db.prepare('SELECT * FROM student_fees WHERE student_id = ?').get(student.id);
    const due = Math.max(0, Number(ledger.net_amount) - Number(agg.paid));
    db.prepare('UPDATE student_fees SET paid_amount = ?, due_amount = ?, status = ? WHERE id = ?')
      .run(Number(agg.paid), due.toFixed(2), due <= 0 ? 'paid' : Number(agg.paid) > 0 ? 'partial' : 'pending', ledger.id);
  });

  // Expenses
  const expenseCategories = ['Salaries', 'Maintenance', 'Utilities', 'Stationery', 'Transport', 'Events', 'IT & Software'];
  for (let m = 0; m < 6; m += 1) {
    for (let i = 0; i < 4; i += 1) {
      const category = pick(expenseCategories);
      insert('expenses', {
        id: newId('exp'), school_id: schoolId, session_id: session, category,
        description: `${category} expense`, amount: 5000 + rnd(60000), expense_date: addDays(-m * 30 - rnd(20)),
        paid_to: pick(['Kolkata Power Supply', 'Aqua Pure', 'Stationery Mart', 'Tech Solutions Pvt Ltd', 'City Maintenance Co.']),
        method: pick(['cash', 'bank_transfer', 'cheque']), voucher_no: `V${1000 + rnd(8999)}`, recorded_by: principalId, created_at: at(),
      });
    }
  }

  // Attendance (last 60 days)
  const workingDays = [];
  for (let i = 60; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 86_400_000);
    if (d.getDay() !== 0) workingDays.push(iso(d));
  }
  let attendanceRows = 0;
  workingDays.forEach((date) => {
    students.forEach((student) => {
      const roll = Math.random();
      const status = roll > 0.94 ? 'absent' : roll > 0.915 ? 'late' : roll > 0.9 ? 'leave' : 'present';
      insert('attendance', {
        id: newId('att'), school_id: schoolId, session_id: session, date, entity_type: 'student',
        entity_id: student.id, status, class_id: student.classId, section_id: student.sectionId,
        remark: status === 'absent' ? 'Informed by parent' : null, marked_by: principalId, created_at: at(), updated_at: at(),
      });
      attendanceRows += 1;
    });
  });
  const employees = db.prepare('SELECT id FROM employees WHERE school_id = ?').all(schoolId);
  workingDays.slice(-30).forEach((date) => {
    employees.forEach((emp) => {
      const status = Math.random() > 0.96 ? 'absent' : Math.random() > 0.94 ? 'leave' : 'present';
      insert('attendance', {
        id: newId('att'), school_id: schoolId, session_id: session, date, entity_type: 'employee',
        entity_id: emp.id, status, marked_by: principalId, created_at: at(), updated_at: at(),
      });
      attendanceRows += 1;
    });
  });
  console.log(`[seed] ${attendanceRows} attendance records`);

  // Holidays
  [
    ['Independence Day', '2026-08-15', 'holiday'], ['Teachers Day', '2026-09-05', 'event'],
    ['Durga Puja Break', '2026-10-18', 'vacation'], ['Diwali', '2026-11-08', 'holiday'],
    ['Christmas Break', '2026-12-24', 'vacation'], ['Republic Day', '2027-01-26', 'holiday'],
    ['Annual Sports Day', '2026-12-12', 'event'], ['Parent-Teacher Meeting', '2026-11-21', 'meeting'],
  ].forEach(([name, date, type]) => {
    insert('holidays', { id: newId('hol'), school_id: schoolId, session_id: session, name, date, type, created_at: at() });
  });

  // ---------------- Examinations ----------------
  function createExam({ name, type, status, startDate, endDate, selectedSections, marksMode }) {
    const scale = db.prepare('SELECT * FROM grading_scales WHERE school_id = ? ORDER BY is_default DESC LIMIT 1').get(schoolId);
    const examId = newId('exm');
    insert('exams', {
      id: examId, school_id: schoolId, session_id: session, name, type, start_date: startDate, end_date: endDate,
      status, grading_scale_id: scale.id, pass_percentage: 33, tie_break: 'total_desc', weightage: 100,
      show_rank: 1, instructions: 'Bring your admit card. Mobiles are not allowed in the examination hall.',
      created_by: principalId, created_at: at(), updated_at: at(),
      finalized_at: status === 'draft' ? null : at(), finalized_by: status === 'draft' ? null : principalId,
      result_published_at: status === 'published' ? at() : null,
    });

    selectedSections.forEach((sec) => {
      const examClassId = newId('exc');
      insert('exam_classes', {
        id: examClassId, school_id: schoolId, exam_id: examId, class_id: sec.class_id, section_id: sec.id,
        status: status === 'published' ? 'published' : status === 'finalized' ? 'finalized' : 'marks_entry',
      });
      assignments.filter((a) => a.sectionId === sec.id).forEach((a, idx) => {
        insert('exam_subjects', {
          id: newId('exs'), school_id: schoolId, exam_id: examId, exam_class_id: examClassId,
          class_id: sec.class_id, section_id: sec.id, subject_id: a.subjectId, teacher_id: a.teacherId,
          max_marks: 100, pass_marks: 33, theory_max: 80, practical_max: 20, weightage: 100,
          exam_date: startDate, is_optional: 0, sort_order: idx,
        });
      });
    });

    if (marksMode === 'none') return examId;

    const examSubjects = db.prepare('SELECT * FROM exam_subjects WHERE exam_id = ?').all(examId);
    examSubjects.forEach((es) => {
      const classStudents = students.filter((s) => s.sectionId === es.section_id);
      classStudents.forEach((student) => {
        // Ability per student makes results look organic.
        const ability = 45 + ((student.admissionNo.charCodeAt(student.admissionNo.length - 1) * 7) % 50);
        const theory = Math.min(80, Math.max(12, Math.round(80 * (ability + rnd(20) - 10) / 100)));
        const practical = Math.min(20, Math.max(5, Math.round(20 * (ability + rnd(24) - 12) / 100)));
        const absent = chance(0.015);
        if (marksMode === 'partial' && chance(0.45)) return; // incomplete entry for the live exam
        insert('exam_marks', {
          id: newId('emk'), school_id: schoolId, exam_subject_id: es.id, student_id: student.id,
          theory_marks: absent ? null : theory, practical_marks: absent ? null : practical,
          marks_obtained: absent ? 0 : theory + practical, is_absent: absent ? 1 : 0, is_exempt: 0,
          entered_by: es.teacher_id, entered_at: at(), updated_at: at(),
        });
      });
    });

    if (marksMode === 'full') {
      computeExamResults(examId, { schoolId, userId: principalId });
      db.prepare("UPDATE exams SET status = ?, finalized_at = ?, finalized_by = ?, result_published_at = ? WHERE id = ?")
        .run(status, at(), principalId, status === 'published' ? at() : null, examId);
      db.prepare("UPDATE exam_classes SET status = ? WHERE exam_id = ?")
        .run(status === 'published' ? 'published' : 'finalized', examId);
      if (status === 'published') db.prepare('UPDATE exam_results SET is_published = 1 WHERE exam_id = ?').run(examId);
    } else {
      db.prepare("UPDATE exams SET status = 'marks_entry' WHERE id = ?").run(examId);
    }
    return examId;
  }

  const primarySections = sections.slice(0, 10);
  createExam({
    name: 'First Term Examination 2026', type: 'term', status: 'published',
    startDate: addDays(-120), endDate: addDays(-112), selectedSections: sections, marksMode: 'full',
  });
  const annualExamId = createExam({
    name: 'Annual Examination 2026', type: 'annual', status: 'marks_entry',
    startDate: addDays(-10), endDate: addDays(-3), selectedSections: sections, marksMode: 'partial',
  });
  createExam({
    name: 'Unit Test II — Class 10', type: 'unit_test', status: 'draft',
    startDate: addDays(20), endDate: addDays(22), selectedSections: sections.filter((s) => s.class_id === classes[9].id), marksMode: 'none',
  });
  console.log('[seed] examinations created (1 published, 1 in marks entry, 1 draft)');

  // ---------------- Homework ----------------
  const homeworkTitles = [
    ['Chapter 4 — Fractions worksheet', 'Complete exercises 4.1 to 4.4 in the workbook.', 5],
    ['Essay: My favourite book', 'Write 300 words. Focus on structure and vocabulary.', 4],
    ['Science project — Water cycle model', 'Build a working model and bring it to class.', 10],
    ['Map work: Indian rivers', 'Mark the major rivers on the outline map provided.', 3],
    ['Hindi vyakaran abhyas', 'Complete the assigned grammar exercises.', 4],
    ['Computer practical — Spreadsheet formulas', 'Build the marks analyser sheet as demonstrated.', 6],
  ];
  sections.slice(0, 10).forEach((sec, idx) => {
    homeworkTitles.slice(0, 3).forEach(([title, description, dueOffset], hIdx) => {
      const assignmentId = newId('asg');
      insert('assignments', {
        id: assignmentId, school_id: schoolId, session_id: session, class_id: sec.class_id, section_id: sec.id,
        subject_id: subjects[(idx + hIdx) % subjects.length].id, teacher_id: teachers[(idx + hIdx) % teachers.length].userId,
        title, description, instructions: 'Submit through the portal or hand in a physical copy.',
        due_date: addDays(dueOffset + hIdx), max_marks: 20, status: 'published', created_at: at(), updated_at: at(),
      });
      students.filter((s) => s.sectionId === sec.id).slice(0, 5).forEach((student, sIdx) => {
        insert('assignment_submissions', {
          id: newId('sub'), school_id: schoolId, assignment_id: assignmentId, student_id: student.id,
          content: 'Submitted as instructed.', submitted_at: at(), status: sIdx % 3 === 0 ? 'graded' : 'submitted',
          marks: sIdx % 3 === 0 ? 12 + rnd(8) : null, feedback: sIdx % 3 === 0 ? 'Good effort. Improve presentation.' : null,
          graded_by: sIdx % 3 === 0 ? teachers[(idx + hIdx) % teachers.length].userId : null, graded_at: sIdx % 3 === 0 ? at() : null,
        });
      });
    });
  });

  // Study materials
  subjects.slice(0, 5).forEach((subject, idx) => {
    insert('study_materials', {
      id: newId('mat'), school_id: schoolId, class_id: classes[idx].id, section_id: null, subject_id: subject.id,
      teacher_id: teachers[idx].userId, title: `${subject.name} — Chapter notes (Term 1)`,
      description: 'Printable revision notes covering the first term syllabus.', type: 'notes',
      external_url: 'https://example.com/notes', visible_to: 'students', created_at: at(),
    });
  });

  // ---------------- Announcements ----------------
  [
    ['Parent-Teacher Meeting on 21 November', 'All parents are requested to attend the PTM between 9:00 AM and 1:00 PM. Class teachers will share progress reports.', 'all', 'high', 0],
    ['Annual Sports Day rehearsals', 'Rehearsals begin next Monday at 7:30 AM on the main ground. Students must wear house colours.', 'all', 'normal', -2],
    ['Half-yearly fee reminder', 'Kindly clear outstanding fees before 30 November to avoid a late fee.', 'parents', 'high', -3],
    ['Library week — book fair', 'The book fair is open in the library from 10 AM to 4 PM all week.', 'all', 'normal', -5],
    ['Class 10 pre-board schedule released', 'The pre-board examination begins on 5 December. The timetable is on the notice board.', 'students', 'high', -1],
  ].forEach(([title, body, audience, priority, dayOffset]) => {
    insert('announcements', {
      id: newId('ann'), school_id: schoolId, title, body, audience, priority,
      publish_at: new Date(Date.now() + dayOffset * 86_400_000).toISOString(), send_push: 1,
      created_by: principalId, created_at: at(),
    });
  });

  // Notifications for the principal
  for (let i = 0; i < 6; i += 1) {
    insert('notifications', {
      id: newId('ntf'), school_id: schoolId, user_id: principalId,
      title: pick(['New admission inquiry received', 'Fees payment received', 'Marks entry completed', 'Leave request pending']),
      body: pick(['A new inquiry was submitted through the website.', 'A parent paid ₹4,500 via UPI.', 'Class 8-A Science marks entry was submitted.', 'A staff member applied for casual leave.']),
      type: pick(['info', 'success', 'warning']), read_at: i > 2 ? at() : null, created_at: at(),
    });
  }

  // ---------------- Library ----------------
  const categories = ['Fiction', 'Non-fiction', 'Reference', 'Science', 'Competitive Exams', 'Children'].map((name) => {
    const id = newId('bct');
    insert('book_categories', { id, school_id: schoolId, name });
    return { id, name };
  });
  const bookTitles = [
    'Wings of Fire', 'The Alchemist', 'Indian Polity', 'Concepts of Physics', 'NCERT Mathematics Class 10',
    'The Jungle Book', 'A Brief History of Time', 'Panchatantra Tales', 'Atomic Habits', 'The Discovery of India',
    'Gitanjali', 'Malgudi Days', 'Harry Potter and the Philosopher\'s Stone', 'The Diary of a Young Girl',
    'Mathematics Olympiad Guide', 'General Knowledge Compendium', 'Environmental Studies', 'Let Us C',
    'Chemistry Lab Manual', 'Stories for Children', 'The Argumentative Indian', 'Economics for Beginners',
    'Shakespeare\'s Comedies', 'Atlas of the World', 'English Grammar in Use', 'Physics Numericals',
    'Biology Diagrams Workbook', 'Modern History of India', 'Poetry Collection', 'Sports Almanac',
  ];
  const books = bookTitles.map((title) => {
    const id = newId('bok');
    const copies = 2 + rnd(6);
    insert('books', {
      id, school_id: schoolId, title, author: pick(['A.P.J. Abdul Kalam', 'Ruskin Bond', 'Rabindranath Tagore', 'Amartya Sen', 'Anonymous']),
      isbn: `978-${rnd(9)}${rnd(100000000)}`, publisher: pick(['Oxford', 'Penguin', 'NCERT', 'Cambridge', 'Macmillan']),
      category_id: pick(categories).id, edition: `${1 + rnd(5)}${['st', 'nd', 'rd', 'th'][rnd(3)]} Ed.`,
      rack: `R${1 + rnd(12)}`, total_copies: copies, available_copies: copies, price: 150 + rnd(850),
      created_at: at(), updated_at: at(),
    });
    return { id, title, copies };
  });
  for (let i = 0; i < 26; i += 1) {
    const book = pick(books);
    const borrower = pick(students);
    const issuedDaysAgo = rnd(45);
    const due = addDays(-issuedDaysAgo + 14);
    const returned = issuedDaysAgo > 20 && chance(0.7);
    const id = newId('bis');
    insert('book_issues', {
      id, school_id: schoolId, book_id: book.id, borrower_type: 'student', borrower_id: borrower.id,
      issue_date: addDays(-issuedDaysAgo), due_date: due, return_date: returned ? addDays(-issuedDaysAgo + 10) : null,
      status: returned ? 'returned' : 'issued', fine: returned && chance(0.3) ? 20 : 0, fine_paid: returned ? 1 : 0,
      issued_by: staff.find((s) => s.department === 'library')?.userId, remarks: null,
    });
    if (!returned) db.prepare('UPDATE books SET available_copies = MAX(0, available_copies - 1) WHERE id = ?').run(book.id);
  }

  // ---------------- Transport ----------------
  const vehicles = [
    ['WB-01-AB-1234', 'Tata Starbus 40', 45, 'Ramesh Yadav', '+91 98311 10001'],
    ['WB-01-CD-5678', 'Ashok Leyland 32', 38, 'Suresh Das', '+91 98311 10002'],
    ['WB-02-EF-9012', 'Force Traveller 26', 26, 'Bimal Mondal', '+91 98311 10003'],
    ['WB-03-GH-3456', 'Tata Winger 18', 18, 'Arup Ghosh', '+91 98311 10004'],
  ].map(([registration_no, model, capacity, driver_name, driver_phone]) => {
    const id = newId('veh');
    insert('vehicles', {
      id, school_id: schoolId, registration_no, model, capacity, driver_name, driver_phone,
      driver_license: `WB2019${rnd(100000)}`, insurance_expiry: addDays(60 + rnd(300)),
      fitness_expiry: addDays(120 + rnd(200)), status: 'active', created_at: at(), updated_at: at(),
    });
    return { id, capacity, registration_no };
  });
  const routeSpecs = [
    ['Salt Lake Route', 'R1', 'Salt Lake Sector 5', 'School Gate'],
    ['Ballygunge Route', 'R2', 'Ballygunge Place', 'School Gate'],
    ['New Town Route', 'R3', 'New Town Action Area 2', 'School Gate'],
    ['Behala Route', 'R4', 'Behala Chowrasta', 'School Gate'],
  ];
  const routes = routeSpecs.map(([name, code, start_point, end_point], idx) => {
    const id = newId('rte');
    insert('transport_routes', {
      id, school_id: schoolId, name, code, vehicle_id: vehicles[idx % vehicles.length].id, start_point, end_point,
      distance_km: 8 + rnd(12), fee_amount: 1200 + idx * 150, status: 'active', created_at: at(), updated_at: at(),
    });
    const stopNames = ['Sector 1', 'Sector 3', 'Market Junction', 'Bus Stand', 'Lake View'];
    stopNames.slice(0, 3 + idx).forEach((stop, sIdx) => {
      insert('transport_stops', {
        id: newId('stp'), school_id: schoolId, route_id: id, name: `${stop} (${code})`,
        pickup_time: `07:${String(10 + sIdx * 5).padStart(2, '0')}`, drop_time: `14:${String(20 + sIdx * 5).padStart(2, '0')}`,
        landmark: 'Main crossing', fee_amount: 1200 + idx * 150, sort_order: sIdx,
      });
    });
    return { id, stops: db.prepare('SELECT * FROM transport_stops WHERE route_id = ?').all(id) };
  });
  students.filter((_, idx) => idx % 7 === 0).forEach((student, idx) => {
    const route = routes[idx % routes.length];
    const stop = route.stops[idx % route.stops.length];
    db.prepare('UPDATE students SET transport_route_id = ?, transport_stop_id = ? WHERE id = ?').run(route.id, stop.id, student.id);
  });
  vehicles.forEach((vehicle, idx) => {
    insert('vehicle_maintenance', {
      id: newId('vm'), school_id: schoolId, vehicle_id: vehicle.id, service_date: addDays(-30 - idx * 15),
      type: pick(['Oil change', 'Brake service', 'Tyre replacement', 'General service']), cost: 3500 + rnd(9000),
      garage: 'City Motors', notes: 'Routine maintenance', next_service_date: addDays(60 + idx * 10), created_at: at(),
    });
  });

  // ---------------- Payroll & leave ----------------
  const payrollEmployees = db.prepare('SELECT * FROM employees WHERE school_id = ?').all(schoolId);
  ['2026-08', '2026-09'].forEach((month) => {
    payrollEmployees.forEach((emp) => {
      const basic = Number(emp.salary_amount) || 30000;
      const allowances = Math.round(basic * 0.1);
      const deductions = Math.round(basic * 0.12);
      insert('payroll', {
        id: newId('pay'), school_id: schoolId, employee_id: emp.id, month, basic, allowances, deductions,
        net: basic + allowances - deductions, status: month === '2026-09' ? 'pending' : 'paid',
        paid_on: month === '2026-09' ? null : `${month}-28`, method: 'bank_transfer', created_by: principalId,
        created_at: at(), updated_at: at(),
      });
    });
  });
  [0, 1, 2].forEach((idx) => {
    const emp = db.prepare('SELECT * FROM employees WHERE school_id = ? LIMIT 1 OFFSET ?').get(schoolId, idx + 3);
    insert('leave_applications', {
      id: newId('lv'), school_id: schoolId, user_id: emp.user_id, employee_id: emp.id,
      from_date: addDays(5 + idx), to_date: addDays(6 + idx), type: pick(['casual', 'sick', 'earned']),
      reason: pick(['Family function', 'Medical appointment', 'Personal work']), status: idx === 0 ? 'approved' : 'pending',
      decided_by: idx === 0 ? principalId : null, decided_at: idx === 0 ? at() : null, created_at: at(), updated_at: at(),
    });
  });

  // ---------------- Website ----------------
  insert('news_posts', {
    id: newId('nws'), school_id: schoolId, title: 'Admissions open for the 2026-27 session',
    excerpt: 'Applications are invited for Nursery to Class 9. Limited seats available.',
    body: 'Our admissions process is now open. Please submit the online inquiry form and our team will contact you within two working days.',
    category: 'notice', author: 'Dr. Ananya Sen', is_published: 1, published_at: at(), created_at: at(),
  });
  insert('news_posts', {
    id: newId('nws'), school_id: schoolId, title: 'Inter-house debate competition results',
    excerpt: 'Congratulations to the winners of this year’s inter-house debate.',
    body: 'The final round was held in the school auditorium. Tagore House won the trophy with a persuasive closing statement.',
    category: 'achievement', author: 'Rekha Banerjee', is_published: 1, published_at: at(), created_at: at(),
  });
  insert('news_posts', {
    id: newId('nws'), school_id: schoolId, title: 'Annual Sports Day — 12 December',
    excerpt: 'Mark your calendars for a day of athletics, house relays and celebration.',
    body: 'Events begin at 8 AM on the main ground. Parents are welcome from 9:30 AM.',
    category: 'event', author: 'Vivek Nair', is_published: 1, published_at: at(), created_at: at(),
  });
  [['Aarav Sharma', 'Soumitra Chatterjee', '9876543210', 'Class 1', 'Looking for admission'],
    ['Ishita Bose', 'Anindita Bose', '9876543311', 'Class 6', 'We recently relocated to Kolkata']]
    .forEach(([student, parent, phone, cls, message]) => {
      insert('admission_inquiries', {
        id: newId('inq'), school_id: schoolId, student_name: student, parent_name: parent,
        email: `${student.split(' ')[0].toLowerCase()}@example.com`, phone, class_applied: cls,
        message, status: 'new', created_at: at(),
      });
    });

  // Website settings
  setSetting(schoolId, 'website', 'heroTitle', 'A school where curiosity becomes capability');
  setSetting(schoolId, 'website', 'heroSubtitle', 'Sunrise International School blends rigorous academics with creativity, sport and character — from Class 1 to Class 10.');
  setSetting(schoolId, 'website', 'aboutText', 'Founded in 1998, Sunrise International School has grown into one of Kolkata\'s most trusted CBSE schools. Our 80+ faculty members nurture 1,400 students across primary and secondary sections.');
  setSetting(schoolId, 'website', 'stats', [
    { label: 'Students', value: '1,400+' }, { label: 'Expert teachers', value: '80+' },
    { label: 'Board pass rate', value: '99%' }, { label: 'Years of excellence', value: '27' },
  ]);
  setSetting(schoolId, 'website', 'contactPhone', '+91 33 4000 1234');
  setSetting(schoolId, 'website', 'contactEmail', 'office@sunrise.edu.in');
  setSetting(schoolId, 'library', 'finePerDay', 2);
  setSetting(schoolId, 'library', 'maxBooksPerBorrower', 3);

  // Audit history so the activity feed is not empty
  [
    ['create', 'students', 'Admitted 42 students through bulk CSV import'],
    ['finalize', 'results', 'Finalized First Term Examination 2026'],
    ['publish', 'results', 'Published First Term results to parent portals'],
    ['create', 'fees', 'Generated monthly invoices for 2026-09'],
    ['update', 'settings', 'Updated school logo and theme accent colour'],
  ].forEach(([action, module, summary]) => {
    insert('audit_logs', {
      id: newId('aud'), school_id: schoolId, user_id: principalId, actor_name: 'Dr. Ananya Sen',
      actor_role: 'principal', action, module, summary, created_at: at(), ip: '127.0.0.1',
    });
  });

  db.prepare('UPDATE schools SET is_demo = 1 WHERE id = ?').run(schoolId);

  return { schoolId, students: students.length, teachers: teachers.length, annualExamId };
}

const started = Date.now();
const result = db.transaction(() => seed())();
console.log(`\n[seed] done in ${((Date.now() - started) / 1000).toFixed(1)}s — ${DB_FILE}`);
console.log(`
  Demo logins (password shown in brackets)
  ─────────────────────────────────────────────────────────────
  Super admin admin                        (admin123)
  Principal   principal@sunrise.edu.in      (Principal@123)
  Teacher     teacher1@sunrise.edu.in       (Teacher@123)
  Staff       accounts@sunrise.edu.in       (Staff@123)
  Staff       exams@sunrise.edu.in          (Staff@123)
  Parent      parent1@example.com           (Parent@123)
  Student     student25@example.com         (Student@123)

  Students: ${result.students} • Teachers: ${result.teachers}
`);
