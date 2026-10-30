import { db, nowIso, newId } from '../db/index.js';
import { hashPassword, generatePassword } from './auth.js';
import { conflict } from './errors.js';

export function roleIdFor(schoolId, baseRole) {
  const row = db.prepare('SELECT id FROM roles WHERE school_id = ? AND base_role = ? AND is_system = 1').get(schoolId, baseRole);
  return row?.id || null;
}

export function emailTaken(schoolId, email) {
  return Boolean(db.prepare('SELECT id FROM users WHERE school_id = ? AND lower(email) = lower(?)').get(schoolId, email));
}

/** Create a login for a person. Returns { id, password } — password is only ever returned once. */
export function createAccount({ schoolId, email, fullName, phone, role, password, department, designation, roleId, mustChangePassword = true }) {
  if (!email) throw conflict('An email address is required to create a login');
  if (emailTaken(schoolId, email)) throw conflict(`An account already exists for ${email}`);
  const id = newId('usr');
  const raw = password || generatePassword(10);
  const at = nowIso();
  db.prepare(
    `INSERT INTO users (id, school_id, email, password_hash, full_name, phone, role, role_id, department, designation,
      status, must_change_password, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, schoolId, email.toLowerCase(), hashPassword(raw), fullName, phone || null, role,
    roleId || roleIdFor(schoolId, role), department || null, designation || null, 'active',
    mustChangePassword ? 1 : 0, at, at);
  return { id, password: raw };
}

export function suspendAccount(userId) {
  db.prepare("UPDATE users SET status = 'suspended', updated_at = ? WHERE id = ?").run(nowIso(), userId);
}

export function classLabel(schoolId, classId, sectionId) {
  const cls = classId ? db.prepare('SELECT name FROM classes WHERE id = ?').get(classId) : null;
  const sec = sectionId ? db.prepare('SELECT name FROM sections WHERE id = ?').get(sectionId) : null;
  return [cls?.name, sec?.name].filter(Boolean).join(' ');
}

export function studentName(studentId) {
  return db.prepare('SELECT full_name FROM students WHERE id = ?').get(studentId)?.full_name || 'Student';
}

export function parentUserIdsForStudent(studentId) {
  return db.prepare('SELECT parent_user_id FROM parent_students WHERE student_id = ?').all(studentId)
    .map((r) => r.parent_user_id);
}

export function studentIdsForParent(userId) {
  return db.prepare('SELECT student_id FROM parent_students WHERE parent_user_id = ?').all(userId)
    .map((r) => r.student_id);
}

/** Next admission number using a readable, sortable pattern. */
export function nextAdmissionNo(schoolId, prefix = 'ADM') {
  const year = new Date().getFullYear();
  const base = `${prefix}${year}`;
  const row = db.prepare(
    "SELECT admission_no FROM students WHERE school_id = ? AND admission_no LIKE ? ORDER BY admission_no DESC LIMIT 1",
  ).get(schoolId, `${base}%`);
  const last = row ? Number(String(row.admission_no).slice(base.length)) || 0 : 0;
  return `${base}${String(last + 1).padStart(4, '0')}`;
}

export function nextEmployeeCode(schoolId) {
  const row = db.prepare(
    "SELECT employee_code FROM employees WHERE school_id = ? ORDER BY employee_code DESC LIMIT 1",
  ).get(schoolId);
  const last = row ? Number(String(row.employee_code).replace(/\D/g, '')) || 0 : 0;
  return `EMP${String(last + 1).padStart(4, '0')}`;
}

export function nextRollNo(schoolId, classId, sectionId, sessionId) {
  const row = db.prepare(
    'SELECT roll_no FROM students WHERE school_id = ? AND class_id = ? AND ifnull(section_id,\'\') = ifnull(?,\'\') AND session_id = ? ORDER BY CAST(roll_no AS INTEGER) DESC LIMIT 1',
  ).get(schoolId, classId, sectionId || null, sessionId);
  const last = row ? Number(row.roll_no) || 0 : 0;
  return String(last + 1).padStart(2, '0');
}
