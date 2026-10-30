import { Router } from 'express';
import { db, getSetting } from '../db/index.js';
import { asyncHandler } from '../lib/errors.js';
import { currentSession } from '../lib/defaults.js';
import { can } from '../lib/auth.js';

const router = Router();

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

function adminDashboard(req) {
  const schoolId = req.user.school_id;
  const session = currentSession(schoolId);
  const sessionId = req.query.sessionId || session?.id || null;
  const now = today();

  const studentCount = db.prepare("SELECT COUNT(*) c FROM students WHERE school_id = ? AND status = 'active'").get(schoolId).c;
  const teacherCount = db.prepare("SELECT COUNT(*) c FROM users WHERE school_id = ? AND role = 'teacher' AND status = 'active'").get(schoolId).c;
  const staffCount = db.prepare("SELECT COUNT(*) c FROM users WHERE school_id = ? AND role = 'staff' AND status = 'active'").get(schoolId).c;
  const parentCount = db.prepare("SELECT COUNT(*) c FROM users WHERE school_id = ? AND role = 'parent' AND status = 'active'").get(schoolId).c;
  const classCount = db.prepare('SELECT COUNT(*) c FROM classes WHERE school_id = ?').get(schoolId).c;

  const todayAttendance = db.prepare(
    `SELECT status, COUNT(*) c FROM attendance WHERE school_id = ? AND date = ? AND entity_type = 'student' GROUP BY status`,
  ).all(schoolId, now);
  const marked = todayAttendance.reduce((s, r) => s + r.c, 0);
  const present = todayAttendance.filter((r) => r.status === 'present' || r.status === 'late').reduce((s, r) => s + r.c, 0);
  const staffToday = db.prepare(
    `SELECT status, COUNT(*) c FROM attendance WHERE school_id = ? AND date = ? AND entity_type = 'employee' GROUP BY status`,
  ).all(schoolId, now);

  const collection = (from, to = now) => db.prepare(
    `SELECT COALESCE(SUM(amount),0) total, COUNT(*) count FROM payments
     WHERE school_id = ? AND status IN ('success','partially_refunded') AND date(paid_at) BETWEEN ? AND ?`,
  ).get(schoolId, from, to);

  const todayCollection = collection(now);
  const monthStart = `${now.slice(0, 7)}-01`;
  const monthCollection = collection(monthStart);
  const yearStart = session?.start_date || `${now.slice(0, 4)}-01-01`;
  const yearCollection = collection(yearStart);
  const pending = db.prepare(
    `SELECT COALESCE(SUM(balance),0) total, COUNT(*) count FROM invoices
     WHERE school_id = ? AND status IN ('unpaid','partial','overdue') AND balance > 0`,
  ).get(schoolId);

  const monthly = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date();
    d.setMonth(d.getMonth() - i, 1);
    const key = d.toISOString().slice(0, 7);
    const row = db.prepare(
      `SELECT COALESCE(SUM(amount),0) total FROM payments
       WHERE school_id = ? AND status IN ('success','partially_refunded') AND substr(COALESCE(paid_at, created_at),1,7) = ?`,
    ).get(schoolId, key);
    monthly.push({ month: key, label: d.toLocaleString('en-IN', { month: 'short' }), value: Math.round(row.total) });
  }

  const attendanceTrend = [];
  for (let i = 13; i >= 0; i -= 1) {
    const date = daysAgo(i);
    const rows = db.prepare(
      `SELECT status, COUNT(*) c FROM attendance WHERE school_id = ? AND date = ? AND entity_type = 'student' GROUP BY status`,
    ).all(schoolId, date);
    const total = rows.reduce((s, r) => s + r.c, 0);
    const pres = rows.filter((r) => r.status === 'present' || r.status === 'late').reduce((s, r) => s + r.c, 0);
    attendanceTrend.push({ date, percentage: total ? Math.round((pres / total) * 100) : null, marked: total });
  }

  const methods = db.prepare(
    `SELECT method, COUNT(*) count, COALESCE(SUM(amount),0) total FROM payments
     WHERE school_id = ? AND status IN ('success','partially_refunded') AND substr(COALESCE(paid_at, created_at),1,7) = ?
     GROUP BY method ORDER BY total DESC`,
  ).all(schoolId, now.slice(0, 7));

  const classWise = db.prepare(
    `SELECT c.id, c.name, COUNT(DISTINCT s.id) students,
       COALESCE(SUM(sf.net_amount),0) billed, COALESCE(SUM(sf.paid_amount),0) collected, COALESCE(SUM(sf.due_amount),0) due
     FROM classes c
     LEFT JOIN students s ON s.class_id = c.id AND s.status = 'active'
     LEFT JOIN student_fees sf ON sf.student_id = s.id
     WHERE c.school_id = ? GROUP BY c.id ORDER BY c.order_index`,
  ).all(schoolId);

  const performance = db.prepare(
    `SELECT c.name AS class_name, ROUND(AVG(r.percentage),1) avg_percentage, COUNT(*) results
     FROM exam_results r JOIN classes c ON c.id = r.class_id
     WHERE r.school_id = ? AND r.is_published = 1 GROUP BY c.id ORDER BY c.order_index`,
  ).all(schoolId);

  const resultStatus = db.prepare(
    `SELECT result_status, COUNT(*) c FROM exam_results WHERE school_id = ? GROUP BY result_status`,
  ).all(schoolId);

  const upcomingExams = db.prepare(
    `SELECT id, name, start_date, end_date, status FROM exams
     WHERE school_id = ? AND (status != 'published') ORDER BY COALESCE(start_date, '9999') LIMIT 5`,
  ).all(schoolId);

  const recentAdmissions = db.prepare(
    `SELECT s.id, s.full_name, s.admission_no, s.created_at, c.name AS class_name
     FROM students s LEFT JOIN classes c ON c.id = s.class_id
     WHERE s.school_id = ? ORDER BY s.created_at DESC LIMIT 6`,
  ).all(schoolId);

  const recentPayments = db.prepare(
    `SELECT p.id, p.amount, p.method, p.receipt_no, p.paid_at, s.full_name
     FROM payments p LEFT JOIN students s ON s.id = p.student_id
     WHERE p.school_id = ? AND p.status = 'success' ORDER BY COALESCE(p.paid_at, p.created_at) DESC LIMIT 6`,
  ).all(schoolId);

  const recentActivity = db.prepare(
    `SELECT id, actor_name, action, module, summary, created_at FROM audit_logs
     WHERE school_id = ? ORDER BY created_at DESC LIMIT 8`,
  ).all(schoolId);

  const upcomingEvents = db.prepare(
    `SELECT id, name, date, type FROM holidays WHERE school_id = ? AND date >= ? ORDER BY date LIMIT 5`,
  ).all(schoolId, now);

  const pendingMarks = db.prepare(
    `SELECT e.id AS exam_id, e.name AS exam_name, c.name AS class_name, COUNT(DISTINCT es.id) subjects,
       COUNT(DISTINCT CASE WHEN em.id IS NOT NULL THEN es.id END) started
     FROM exams e
     JOIN exam_subjects es ON es.exam_id = e.id
     LEFT JOIN exam_marks em ON em.exam_subject_id = es.id
     LEFT JOIN classes c ON c.id = es.class_id
     WHERE e.school_id = ? AND e.status IN ('marks_entry','marks_complete') AND c.id IS NOT NULL
     GROUP BY e.id, es.class_id ORDER BY e.start_date DESC LIMIT 5`,
  ).all(schoolId);

  return {
    scope: 'admin',
    session,
    kpis: {
      students: studentCount, teachers: teacherCount, staff: staffCount, parents: parentCount, classes: classCount,
      attendanceToday: { marked, present, percentage: marked ? Math.round((present / marked) * 100) : null, absent: marked - present },
      staffAttendanceToday: staffToday.reduce((acc, r) => ({ ...acc, [r.status]: r.c }), {}),
      todayCollection: { amount: todayCollection.total, count: todayCollection.count },
      monthCollection: { amount: monthCollection.total, count: monthCollection.count },
      yearCollection: { amount: yearCollection.total, count: yearCollection.count },
      pendingFees: { amount: pending.total, invoices: pending.count },
      passRate: (() => {
        const total = resultStatus.reduce((s, r) => s + r.c, 0);
        const passed = resultStatus.filter((r) => r.result_status === 'pass').reduce((s, r) => s + r.c, 0);
        return total ? Math.round((passed / total) * 100) : null;
      })(),
    },
    charts: { monthly, attendanceTrend, methods, classWise, performance },
    lists: { upcomingExams, recentAdmissions, recentPayments, recentActivity, upcomingEvents, pendingMarks },
    quickActions: {
      canPublishResults: db.prepare("SELECT COUNT(*) c FROM exams WHERE school_id = ? AND status = 'finalized'").get(schoolId).c,
      overdueInvoices: db.prepare("SELECT COUNT(*) c FROM invoices WHERE school_id = ? AND status = 'overdue'").get(schoolId).c,
      pendingLeave: db.prepare("SELECT COUNT(*) c FROM leave_applications WHERE school_id = ? AND status = 'pending'").get(schoolId).c,
      newInquiries: db.prepare("SELECT COUNT(*) c FROM admission_inquiries WHERE school_id = ? AND status = 'new'").get(schoolId).c,
      libraryOverdue: db.prepare("SELECT COUNT(*) c FROM book_issues WHERE school_id = ? AND status IN ('issued','overdue') AND date(due_date) < date('now')").get(schoolId).c,
    },
  };
}

function teacherDashboard(req) {
  const schoolId = req.user.school_id;
  const session = currentSession(schoolId);
  const now = today();
  const dayOfWeek = new Date().getDay() === 0 ? 7 : new Date().getDay();

  const assignments = db.prepare(
    `SELECT cs.*, c.name AS class_name, sec.name AS section_name, s.name AS subject_name
     FROM class_subjects cs
     LEFT JOIN classes c ON c.id = cs.class_id
     LEFT JOIN sections sec ON sec.id = cs.section_id
     LEFT JOIN subjects s ON s.id = cs.subject_id
     WHERE cs.school_id = ? AND cs.session_id = ? AND cs.teacher_id = ?`,
  ).all(schoolId, session?.id, req.user.id);

  const mySections = [...new Map(assignments.map((a) => [a.section_id || a.class_id, a])).values()];

  const todayPeriods = db.prepare(
    `SELECT te.*, tp.name AS period_name, tp.start_time, tp.end_time, s.name AS subject_name,
            sec.name AS section_name, c.name AS class_name
     FROM timetable_entries te
     JOIN timetable_periods tp ON tp.id = te.period_id
     LEFT JOIN subjects s ON s.id = te.subject_id
     LEFT JOIN sections sec ON sec.id = te.section_id
     LEFT JOIN classes c ON c.id = sec.class_id
     WHERE te.school_id = ? AND te.session_id = ? AND te.teacher_id = ? AND te.day = ?
     ORDER BY tp.sort_order`,
  ).all(schoolId, session?.id, req.user.id, dayOfWeek);

  const attendanceToday = db.prepare(
    `SELECT section_id, COUNT(*) c FROM attendance
     WHERE school_id = ? AND date = ? AND entity_type = 'student' AND marked_by = ? GROUP BY section_id`,
  ).all(schoolId, now, req.user.id);

  const pendingMarks = db.prepare(
    `SELECT es.id, es.exam_id, e.name AS exam_name, c.name AS class_name, sec.name AS section_name, s.name AS subject_name,
            es.max_marks, COUNT(em.id) entered,
            (SELECT COUNT(*) FROM students st WHERE st.section_id = es.section_id AND st.status = 'active') students
     FROM exam_subjects es
     JOIN exams e ON e.id = es.exam_id
     LEFT JOIN classes c ON c.id = es.class_id
     LEFT JOIN sections sec ON sec.id = es.section_id
     LEFT JOIN subjects s ON s.id = es.subject_id
     LEFT JOIN exam_marks em ON em.exam_subject_id = es.id
     WHERE es.school_id = ? AND es.teacher_id = ? AND e.status IN ('marks_entry','marks_complete')
     GROUP BY es.id
     HAVING entered < students OR students = 0`,
  ).all(schoolId, req.user.id);

  const homework = db.prepare(
    `SELECT a.id, a.title, a.due_date, c.name AS class_name, s.name AS subject_name,
       (SELECT COUNT(*) FROM assignment_submissions x WHERE x.assignment_id = a.id) submissions,
       (SELECT COUNT(*) FROM students st WHERE st.section_id = a.section_id AND st.status='active') students
     FROM assignments a LEFT JOIN classes c ON c.id = a.class_id LEFT JOIN subjects s ON s.id = a.subject_id
     WHERE a.school_id = ? AND a.teacher_id = ? AND a.status = 'published' ORDER BY a.created_at DESC LIMIT 5`,
  ).all(schoolId, req.user.id);

  const announcements = db.prepare(
    `SELECT id, title, body, priority, publish_at FROM announcements
     WHERE school_id = ? AND publish_at <= ? AND (expires_at IS NULL OR expires_at >= ?)
     ORDER BY publish_at DESC LIMIT 4`,
  ).all(schoolId, new Date().toISOString(), now);

  const sectionIds = [...new Set(assignments.map((a) => a.section_id).filter(Boolean))];
  const studentTotal = sectionIds.length
    ? db.prepare(
      `SELECT COUNT(*) c FROM students WHERE school_id = ? AND status = 'active' AND section_id IN (${sectionIds.map(() => '?').join(',')})`,
    ).get(schoolId, ...sectionIds).c
    : 0;

  return {
    scope: 'teacher',
    session,
    mySections: mySections.map((s) => ({
      class_id: s.class_id, section_id: s.section_id, class_name: s.class_name, section_name: s.section_name,
    })),
    assignments,
    kpis: {
      classes: new Set(assignments.map((a) => `${a.class_id}:${a.section_id}`)).size,
      subjects: new Set(assignments.map((a) => a.subject_id)).size,
      students: studentTotal,
      periodsToday: todayPeriods.length,
      pendingMarks: pendingMarks.length,
      homeworkDue: homework.filter((h) => h.due_date && h.due_date >= now).length,
    },
    lists: { todayPeriods, pendingMarks, homework, announcements, attendanceToday },
    dayOfWeek,
  };
}

router.get('/', asyncHandler(async (req, res) => {
  if (['student', 'parent'].includes(req.user.role)) return res.json({ scope: 'portal', redirect: '/portal' });
  if (req.user.role === 'teacher') return res.json(teacherDashboard(req));
  if (req.user.role === 'staff') {
    const data = adminDashboard(req);
    // Staff only see the finance/admin widgets they are allowed to see.
    if (!can(req.user, 'fees.view')) {
      data.charts.methods = [];
      data.charts.classWise = [];
      data.charts.monthly = [];
      data.lists.recentPayments = [];
      data.kpis.todayCollection = null;
      data.kpis.monthCollection = null;
      data.kpis.yearCollection = null;
      data.kpis.pendingFees = null;
    }
    data.scope = 'staff';
    data.roleSummary = {
      department: req.user.department,
      designation: req.user.designation,
      permissions: req.user.permissions,
    };
    return res.json(data);
  }
  const data = adminDashboard(req);
  const widgets = getSetting(req.user.school_id, 'dashboard', 'widgets', null);
  if (widgets) data.layout = widgets;
  res.json(data);
}));

export default router;
