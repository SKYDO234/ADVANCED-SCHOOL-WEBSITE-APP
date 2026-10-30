import { db } from '../db/index.js';
import { notifyUsers } from './audit.js';

/** Notify every active student (and their parents) in a class/section. */
export function notifyClass({ schoolId, classId, sectionId = null, title, body, link = null, type = 'info', includeParents = true }) {
  const students = db.prepare(
    `SELECT id, user_id FROM students WHERE school_id = ? AND class_id = ?
     AND (? IS NULL OR section_id = ?) AND status = 'active'`,
  ).all(schoolId, classId, sectionId, sectionId);

  const ids = students.map((s) => s.user_id).filter(Boolean);
  if (includeParents && students.length) {
    const rows = db.prepare(
      `SELECT parent_user_id FROM parent_students WHERE student_id IN (${students.map(() => '?').join(',')})`,
    ).all(...students.map((s) => s.id));
    ids.push(...rows.map((r) => r.parent_user_id));
  }
  return notifyUsers(schoolId, ids, { title, body, link, type });
}

export function notifyRoles(schoolId, roles, payload) {
  const ids = db.prepare(
    `SELECT id FROM users WHERE school_id = ? AND status = 'active' AND role IN (${roles.map(() => '?').join(',')})`,
  ).all(schoolId, ...roles).map((r) => r.id);
  return notifyUsers(schoolId, ids, payload);
}

/** Student ids the current user may see in the portal. */
export function portalStudentIds(user) {
  if (user.role === 'student') {
    const row = db.prepare('SELECT id FROM students WHERE user_id = ?').get(user.id);
    return row ? [row.id] : [];
  }
  if (user.role === 'parent') {
    return db.prepare('SELECT student_id AS id FROM parent_students WHERE parent_user_id = ?').all(user.id).map((r) => r.id);
  }
  return [];
}
