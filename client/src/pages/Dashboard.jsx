import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useResource } from '../api.js';
import { useApp } from '../store.jsx';
import {
  Alert, Avatar, Badge, Button, Card, DataTable, EmptyState, PageHeader, Progress, Stat, StatusBadge,
  formatDate, formatMoney, relativeTime,
} from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';
import { BarChart, Donut, HBars, LineChart } from '../ui/Charts.jsx';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const { user, school, can } = useApp();
  const navigate = useNavigate();
  const { data, loading, error } = useResource('/dashboard');
  const currency = school?.currency_symbol || '₹';

  if (error) return <div className="page"><Alert tone="danger" title="Could not load dashboard">{error.message}</Alert></div>;
  if (loading || !data) {
    return (
      <div className="page">
        <PageHeader title="Dashboard" subtitle="Loading today's snapshot…" />
        <div className="grid grid-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="card" style={{ padding: 18 }}><div className="skeleton" style={{ height: 12, width: '50%' }} /><div className="skeleton mt-2" style={{ height: 30, width: '70%' }} /></div>)}</div>
      </div>
    );
  }

  const isTeacher = data.scope === 'teacher';
  const firstName = (user?.full_name || '').split(' ')[0];
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="page">
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        subtitle={`${today}${data.session ? ` · Session ${data.session.name}` : ''}`}
        actions={(
          <>
            {can('students.create') ? <Button variant="outline" icon="plus" onClick={() => navigate('/app/students?new=1')}>Admit student</Button> : null}
            {can('attendance.mark') ? <Button variant="outline" icon="attendance" onClick={() => navigate('/app/attendance')}>Mark attendance</Button> : null}
            {can('fees.collect') ? <Button variant="primary" icon="fees" onClick={() => navigate('/app/fees?tab=collect')}>Collect fee</Button> : null}
          </>
        )}
      />

      {isTeacher ? <TeacherDashboard data={data} currency={currency} /> : <AdminDashboard data={data} currency={currency} />}
    </div>
  );
}

function AdminDashboard({ data, currency }) {
  const { kpis, charts, lists, quickActions } = data;
  const attendance = kpis.attendanceToday || {};
  const monthly = (charts.monthly || []).map((m) => ({ label: m.label, value: m.value }));
  const trend = (charts.attendanceTrend || []).filter((t) => t.marked > 0).map((t) => ({
    label: formatDate(t.date, { day: '2-digit', month: 'short' }),
    percentage: t.percentage,
  }));

  const alerts = [
    quickActions?.overdueInvoices ? { tone: 'danger', text: `${quickActions.overdueInvoices} invoice${quickActions.overdueInvoices === 1 ? '' : 's'} overdue`, to: '/app/fees?tab=invoices&status=overdue', perm: 'fees.view' } : null,
    quickActions?.pendingLeave ? { tone: 'warning', text: `${quickActions.pendingLeave} leave request${quickActions.pendingLeave === 1 ? '' : 's'} awaiting approval`, to: '/app/employees?tab=leave', perm: 'employees.view' } : null,
    quickActions?.newInquiries ? { tone: 'info', text: `${quickActions.newInquiries} new admission inquir${quickActions.newInquiries === 1 ? 'y' : 'ies'}`, to: '/app/website?tab=inquiries', perm: 'website.admissions' } : null,
    quickActions?.libraryOverdue ? { tone: 'warning', text: `${quickActions.libraryOverdue} library book${quickActions.libraryOverdue === 1 ? '' : 's'} overdue`, to: '/app/library?tab=issues', perm: 'library.view' } : null,
    quickActions?.canPublishResults ? { tone: 'success', text: `${quickActions.canPublishResults} exam${quickActions.canPublishResults === 1 ? '' : 's'} ready to publish`, to: '/app/exams', perm: 'results.publish' } : null,
  ].filter(Boolean);

  return (
    <>
      <div className="grid grid-4 mb-3">
        <Stat label="Active students" value={(kpis.students || 0).toLocaleString('en-IN')} icon="students" meta={`${kpis.teachers || 0} teachers · ${kpis.classes || 0} classes`} />
        <Stat
          label="Attendance today"
          value={attendance.percentage != null ? `${attendance.percentage}%` : '—'}
          icon="attendance"
          meta={attendance.marked ? `${attendance.present} present · ${attendance.absent} absent` : 'Not marked yet'}
        />
        <Stat
          label="Collected this month"
          value={kpis.monthCollection ? formatMoney(kpis.monthCollection.amount, currency) : '—'}
          icon="fees"
          meta={kpis.todayCollection ? `${formatMoney(kpis.todayCollection.amount, currency)} today` : ''}
        />
        <Stat
          label="Outstanding fees"
          value={kpis.pendingFees ? formatMoney(kpis.pendingFees.amount, currency) : '—'}
          icon="invoices"
          meta={kpis.pendingFees ? `${kpis.pendingFees.invoices} open invoices` : ''}
        />
      </div>

      {alerts.length ? (
        <div className="grid grid-4 mb-3" style={{ gap: 10 }}>
          {alerts.map((a) => (
            <Link key={a.text} to={a.to} className="card" style={{ padding: '10px 14px', textDecoration: 'none', borderLeft: `3px solid var(--${a.tone === 'danger' ? 'danger' : a.tone === 'warning' ? 'warning' : a.tone === 'success' ? 'success' : 'info'})` }}>
              <div className="row gap-1 fs-13"><Icon name="alert" size={15} /> {a.text}</div>
            </Link>
          ))}
        </div>
      ) : null}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', alignItems: 'start' }}>
        <div className="col gap-3">
          <Card title="Fee collection" subtitle="Last 12 months" actions={<Link className="btn btn-sm btn-ghost" to="/app/reports">Reports</Link>}>
            <BarChart data={monthly} series={[{ key: 'value', label: 'Collected', color: 'var(--accent)' }]} format={(v) => `${currency}${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} />
          </Card>

          <Card title="Daily attendance" subtitle="Students marked present or late, last 14 school days">
            {trend.length ? (
              <LineChart data={trend} series={[{ key: 'percentage', label: 'Attendance %', color: '#0f766e' }]} format={(v) => `${v}%`} height={200} />
            ) : <EmptyState icon="attendance" title="No attendance recorded yet" text="Mark today's attendance to start the trend." action={<Link className="btn btn-sm btn-primary" to="/app/attendance">Mark attendance</Link>} />}
          </Card>

          <Card title="Class-wise fee position" flush actions={<Link className="btn btn-sm btn-ghost" to="/app/fees">Open fees</Link>}>
            <DataTable
              columns={[
                { key: 'name', header: 'Class' },
                { key: 'students', header: 'Students', align: 'num' },
                { key: 'billed', header: 'Billed', align: 'num', render: (r) => formatMoney(r.billed, currency) },
                { key: 'collected', header: 'Collected', align: 'num', render: (r) => formatMoney(r.collected, currency) },
                {
                  key: 'progress',
                  header: 'Collection',
                  render: (r) => <div style={{ minWidth: 120 }}><Progress small value={Number(r.collected)} max={Number(r.billed) || 1} /></div>,
                },
              ]}
              rows={charts.classWise || []}
              emptyTitle="No fee data"
              emptyText="Create fee structures to start billing."
            />
          </Card>
        </div>

        <div className="col gap-3">
          <Card title="Fees collected by method" subtitle="This month">
            {(charts.methods || []).length ? (
              <Donut
                size={150}
                data={charts.methods.map((m) => ({ label: m.method || 'Cash', value: Math.round(m.total) }))}
                centerValue={formatMoney(charts.methods.reduce((s, m) => s + Number(m.total), 0), currency)}
                centerLabel="this month"
              />
            ) : <EmptyState icon="fees" title="No payments yet" />}
          </Card>

          <Card title="Upcoming exams" icon="exams">
            {(lists.upcomingExams || []).length === 0 ? <EmptyState icon="exams" title="No exams scheduled" /> : (
              <div className="stack-sm">
                {lists.upcomingExams.map((e) => (
                  <Link key={e.id} to={`/app/exams/${e.id}`} className="row-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)', textDecoration: 'none' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="strong fs-13 truncate">{e.name}</div>
                      <div className="fs-12 muted">{formatDate(e.start_date)}</div>
                    </div>
                    <StatusBadge status={e.status} />
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card title="Marks entry pending" icon="edit">
            {(lists.pendingMarks || []).length === 0 ? <EmptyState icon="check" title="All caught up" text="Every subject has marks entered." /> : (
              <div className="stack-sm">
                {lists.pendingMarks.map((p) => (
                  <Link key={`${p.exam_id}-${p.class_name}`} to={`/app/exams/${p.exam_id}?tab=marks`} className="row-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)', textDecoration: 'none' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="strong fs-13 truncate">{p.class_name} · {p.exam_name}</div>
                      <div className="fs-12 muted">{p.started} of {p.subjects} subjects started</div>
                    </div>
                    <Progress small value={p.started} max={p.subjects || 1} />
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card title="Recent payments" icon="payments">
            {(lists.recentPayments || []).length === 0 ? <EmptyState icon="payments" title="No payments yet" /> : (
              <div className="stack-sm">
                {lists.recentPayments.map((p) => (
                  <div key={p.id} className="row-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                    <div className="person" style={{ gap: 8 }}>
                      <Avatar name={p.full_name} size="sm" />
                      <div className="person-meta">
                        <div className="person-name fs-13">{p.full_name}</div>
                        <div className="fs-12 muted">{p.method} · {relativeTime(p.paid_at)}</div>
                      </div>
                    </div>
                    <span className="strong tnum fs-13">{formatMoney(p.amount, currency)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Recently admitted" icon="students" actions={<Link className="btn btn-sm btn-ghost" to="/app/students">All</Link>}>
            {(lists.recentAdmissions || []).length === 0 ? <EmptyState icon="students" title="No admissions yet" /> : (
              <div className="stack-sm">
                {lists.recentAdmissions.map((s) => (
                  <Link key={s.id} to={`/app/students/${s.id}`} className="row-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)', textDecoration: 'none' }}>
                    <div className="person" style={{ gap: 8 }}>
                      <Avatar name={s.full_name} size="sm" />
                      <div className="person-meta">
                        <div className="person-name fs-13">{s.full_name}</div>
                        <div className="fs-12 muted">{s.class_name || 'Unassigned'} · {s.admission_no}</div>
                      </div>
                    </div>
                    <span className="fs-12 muted">{relativeTime(s.created_at)}</span>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card title="Recent activity" icon="clock">
            {(lists.recentActivity || []).length === 0 ? <EmptyState icon="clock" title="No activity yet" /> : (
              <div className="stack-sm">
                {lists.recentActivity.map((a) => (
                  <div key={a.id} style={{ padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
                    <div className="fs-13">{a.summary}</div>
                    <div className="fs-12 muted">{a.actor_name || 'System'} · {relativeTime(a.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function TeacherDashboard({ data, currency }) {
  const { kpis, lists } = data;
  const navigate = useNavigate();
  const pending = lists.pendingMarks || [];

  return (
    <>
      <div className="grid grid-4 mb-3">
        <Stat label="My classes" value={kpis.classes} icon="classes" meta={`${kpis.subjects} subjects`} />
        <Stat label="My students" value={kpis.students} icon="students" />
        <Stat label="Periods today" value={kpis.periodsToday} icon="calendar" />
        <Stat label="Marks pending" value={kpis.pendingMarks} icon="edit" meta={pending.length ? 'Needs attention' : 'All submitted'} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', alignItems: 'start' }}>
        <div className="col gap-3">
          <Card title="Today's timetable" icon="calendar" actions={<Button size="sm" variant="ghost" onClick={() => navigate('/app/timetable')}>Full timetable</Button>}>
            {(lists.todayPeriods || []).length === 0 ? <EmptyState icon="calendar" title="No periods scheduled today" /> : (
              <div className="stack-sm">
                {lists.todayPeriods.map((p) => (
                  <div key={p.id} className="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                    <div className="row gap-2">
                      <Badge tone="accent">{p.period_name}</Badge>
                      <div>
                        <div className="strong fs-13">{p.subject_name || '—'}</div>
                        <div className="fs-12 muted">{p.class_name} {p.section_name ? `· ${p.section_name}` : ''}</div>
                      </div>
                    </div>
                    <span className="fs-12 muted nowrap">{p.start_time}–{p.end_time}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Marks still to enter" icon="edit">
            {pending.length === 0 ? <EmptyState icon="check" title="Everything submitted" text="No pending marks entry for your subjects." /> : (
              <div className="stack-sm">
                {pending.map((p) => (
                  <div key={p.id} className="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="strong fs-13">{p.subject_name} · {p.class_name}{p.section_name ? ` (${p.section_name})` : ''}</div>
                      <div className="fs-12 muted">{p.exam_name} · {p.entered}/{p.students} entered · max {p.max_marks}</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => navigate(`/app/exams/${p.exam_id}?tab=marks&subject=${p.id}`)}>Enter marks</Button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="My homework" icon="homework" actions={<Button size="sm" variant="ghost" onClick={() => navigate('/app/homework')}>Manage</Button>}>
            {(lists.homework || []).length === 0 ? <EmptyState icon="homework" title="No assignments yet" /> : (
              <div className="stack-sm">
                {lists.homework.map((h) => (
                  <div key={h.id} className="row-between" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="strong fs-13 truncate">{h.title}</div>
                      <div className="fs-12 muted">{h.class_name} · {h.subject_name || 'General'} · due {formatDate(h.due_date)}</div>
                    </div>
                    <Badge tone={h.submissions ? 'success' : 'warning'}>{h.submissions}/{h.students} submitted</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="col gap-3">
          <Card title="My sections" icon="students">
            {(data.mySections || []).length === 0 ? <EmptyState icon="classes" title="No sections assigned" /> : (
              <div className="stack-sm">
                {data.mySections.map((s) => (
                  <div key={`${s.class_id}-${s.section_id}`} className="row-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                    <span className="fs-13 strong">{s.class_name}{s.section_name ? ` · ${s.section_name}` : ''}</span>
                    <Button size="sm" variant="ghost" onClick={() => navigate(`/app/attendance?classId=${s.class_id}&sectionId=${s.section_id || ''}`)}>Attendance</Button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Attendance marked by me" subtitle="Today">
            {(lists.attendanceToday || []).length === 0 ? <EmptyState icon="attendance" title="Nothing marked yet" action={<Button size="sm" variant="primary" onClick={() => navigate('/app/attendance')}>Mark now</Button>} /> : (
              <div className="fs-13 ink-2">
                {(lists.attendanceToday || []).reduce((sum, r) => sum + r.c, 0)} students marked across {lists.attendanceToday.length} sections.
              </div>
            )}
          </Card>

          <Card title="Announcements" icon="communication">
            {(lists.announcements || []).length === 0 ? <EmptyState icon="communication" title="No announcements" /> : (
              <div className="stack-sm">
                {lists.announcements.map((a) => (
                  <div key={a.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                    <div className="row gap-1"><Badge tone={a.priority === 'high' ? 'danger' : 'outline'}>{a.priority || 'normal'}</Badge><span className="strong fs-13">{a.title}</span></div>
                    <div className="fs-12 muted mt-0" style={{ marginTop: 3 }}>{a.body}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
