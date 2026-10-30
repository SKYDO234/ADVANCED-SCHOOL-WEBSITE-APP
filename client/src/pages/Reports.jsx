import { useEffect, useMemo, useState } from 'react';
import { get, openFile, useResource } from '../api.js';
import { useApp } from '../store.jsx';
import { useAcademic } from '../lib/academic.js';
import {
  Alert, Badge, Button, Card, DataTable, Loading, PageHeader, formatDate, formatMoney, useToast,
} from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';

const REPORTS = [
  {
    group: 'Academic',
    items: [
      { key: 'class-performance', label: 'Class performance', path: '/reports/academic/class-performance', perm: 'reports.view', icon: 'chart', exam: true, description: 'Average, highest, lowest and pass rate per section.' },
      { key: 'subject-performance', label: 'Subject performance', path: '/reports/academic/subject-performance', perm: 'reports.view', icon: 'subjects', exam: true, description: 'Subject averages and topper for each class.' },
      { key: 'top-students', label: 'Top students', path: '/reports/academic/top-students', perm: 'reports.view', icon: 'award', exam: true, description: 'Ranked merit list with totals and grades.' },
      { key: 'grade-distribution', label: 'Grade distribution', path: '/reports/academic/grade-distribution', perm: 'reports.view', icon: 'analytics', exam: true, description: 'How many students fall into each grade band.' },
      { key: 'year-comparison', label: 'Year comparison', path: '/reports/academic/year-comparison', perm: 'reports.view', icon: 'trendUp', description: 'Session-over-session result comparison.' },
    ],
  },
  {
    group: 'Finance',
    items: [
      { key: 'collection', label: 'Collection report', path: '/reports/finance/collection', perm: 'reports.finance', icon: 'fees', dates: true, description: 'Day-by-day collections with method split.' },
      { key: 'pending', label: 'Pending fees', path: '/reports/finance/pending', perm: 'reports.finance', icon: 'invoices', description: 'Outstanding invoices with ageing.' },
      { key: 'profit-loss', label: 'Income vs expenses', path: '/reports/finance/profit-loss', perm: 'reports.finance', icon: 'money', dates: true, description: 'Collections against expenses for the period.' },
      { key: 'class-collection', label: 'Class-wise collection', path: '/reports/finance/class-collection', perm: 'reports.finance', icon: 'classes', description: 'Billed, collected and due by class.' },
    ],
  },
  {
    group: 'Attendance',
    items: [
      { key: 'attendance-summary', label: 'Attendance summary', path: '/reports/attendance/summary', perm: 'reports.attendance', icon: 'attendance', dates: true, classFilter: true, description: 'Present / absent percentages per student.' },
      { key: 'absentees', label: 'Absentee register', path: '/reports/attendance/absentees', perm: 'reports.attendance', icon: 'alert', dates: true, description: 'Every absence with contact numbers.' },
    ],
  },
  {
    group: 'Administration',
    items: [
      { key: 'overview', label: 'School overview', path: '/reports/admin/overview', perm: 'reports.admin', icon: 'school', description: 'Key counts across the whole workspace.' },
      { key: 'class-strength', label: 'Class strength', path: '/reports/admin/class-strength', perm: 'reports.admin', icon: 'classes', description: 'Students per section against capacity.' },
      { key: 'employees', label: 'Employee register', path: '/reports/admin/employees', perm: 'reports.admin', icon: 'teachers', description: 'Staff list with departments and roles.' },
      { key: 'transport', label: 'Transport report', path: '/reports/admin/transport', perm: 'reports.admin', icon: 'transport', description: 'Routes, vehicles and occupancy.' },
      { key: 'library', label: 'Library report', path: '/reports/admin/library', perm: 'reports.admin', icon: 'library', description: 'Catalogue usage and overdue books.' },
      { key: 'audit', label: 'Audit trail', path: '/reports/admin/audit', perm: 'settings.audit', dates: true, description: 'System activity for compliance reviews.' },
    ],
  },
];

export default function Reports() {
  const { can, school } = useApp();
  const toast = useToast();
  const { classes } = useAcademic();
  const { data: examsData } = useResource('/exams');
  const [activeKey, setActiveKey] = useState('class-performance');
  const [filters, setFilters] = useState({ from: '', to: '', classId: '', examId: '', entity: 'student' });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const currency = school?.currency_symbol || '₹';

  const all = useMemo(() => REPORTS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group }))), []);
  const active = all.find((r) => r.key === activeKey) || all[0];
  const allowed = (report) => !report.perm || can(report.perm);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        ...(active.dates ? { from: filters.from || undefined, to: filters.to || undefined } : {}),
        ...(active.classFilter && filters.classId ? { classId: filters.classId } : {}),
        ...(active.exam ? { examId: filters.examId || undefined } : {}),
        ...(active.key === 'attendance-summary' ? { entity: filters.entity } : {}),
      };
      const res = await get(active.path, params);
      setResult(res);
    } catch (err) {
      setError(err);
      setResult(null);
      toast.error('Could not run report', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { run(); /* eslint-disable-next-line */ }, [activeKey]);

  const exportParams = () => ({
    ...(active.dates ? { from: filters.from || undefined, to: filters.to || undefined } : {}),
    ...(active.classFilter && filters.classId ? { classId: filters.classId } : {}),
    ...(active.exam ? { examId: filters.examId || undefined } : {}),
    ...(active.key === 'attendance-summary' ? { entity: filters.entity } : {}),
  });

  const columns = (result?.columns || []).map((c) => ({
    key: c.key || c.label,
    header: c.label,
    align: typeof c.align === 'string' && c.align === 'right' ? 'num' : undefined,
    render: (row) => {
      const value = row[c.key] ?? row[c.label];
      if (value === null || value === undefined || value === '') return '—';
      if (typeof value === 'number' && /amount|fee|collected|billed|due|total|expense|salary/i.test(c.key || c.label)) return formatMoney(value, currency);
      if (/percent|percentage|rate/i.test(c.key || c.label) && typeof value === 'number') return `${value}%`;
      return String(value);
    },
  }));

  return (
    <div className="page">
      <PageHeader
        title="Reports & analytics"
        subtitle="Run any report, inspect it on screen and export to CSV or PDF."
        actions={result ? (
          <>
            <Button variant="outline" icon="download" onClick={() => openFile(active.path, { ...exportParams(), format: 'csv' })}>CSV</Button>
            <Button variant="primary" icon="print" onClick={() => openFile(active.path, { ...exportParams(), format: 'pdf' })}>PDF</Button>
          </>
        ) : null}
      />

      <div className="grid" style={{ gridTemplateColumns: '280px minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <Card title="Report library" icon="reports" flush>
          <div style={{ maxHeight: 640, overflow: 'auto', padding: 8 }}>
            {REPORTS.map((group) => {
              const items = group.items.filter(allowed);
              if (!items.length) return null;
              return (
                <div key={group.group} className="mb-2">
                  <div className="nav-heading" style={{ color: 'var(--ink-3)', padding: '8px 8px 4px' }}>{group.group}</div>
                  {items.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => setActiveKey(r.key)}
                      style={{
                        display: 'flex', gap: 9, alignItems: 'center', width: '100%', textAlign: 'left', border: 0,
                        background: activeKey === r.key ? 'var(--accent-soft)' : 'transparent',
                        color: activeKey === r.key ? 'var(--accent)' : 'var(--ink-2)',
                        padding: '8px 9px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: activeKey === r.key ? 600 : 500,
                      }}
                    >
                      <Icon name={r.icon} size={15} />
                      {r.label}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </Card>

        <div className="col gap-3">
          <Card title={active.label} subtitle={active.description}>
            <div className="row row-wrap gap-1" style={{ alignItems: 'flex-end' }}>
              {active.dates ? (
                <>
                  <div><label className="label">From</label><input className="input" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></div>
                  <div><label className="label">To</label><input className="input" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></div>
                </>
              ) : null}
              {active.classFilter ? (
                <div><label className="label">Class</label>
                  <select className="select" value={filters.classId} onChange={(e) => setFilters({ ...filters, classId: e.target.value })}>
                    <option value="">All classes</option>
                    {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              ) : null}
              {active.key === 'attendance-summary' ? (
                <div><label className="label">Entity</label>
                  <select className="select" value={filters.entity} onChange={(e) => setFilters({ ...filters, entity: e.target.value })}>
                    <option value="student">Students</option>
                    <option value="employee">Employees</option>
                  </select>
                </div>
              ) : null}
              {active.exam ? (
                <div><label className="label">Examination</label>
                  <select className="select" value={filters.examId} onChange={(e) => setFilters({ ...filters, examId: e.target.value })}>
                    <option value="">All examinations</option>
                    {(examsData?.items || []).filter((e) => ['finalized', 'published'].includes(e.status)).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
              ) : null}
              <Button variant="primary" icon="refresh" loading={loading} onClick={run}>Run report</Button>
            </div>
          </Card>

          {loading ? <Card><Loading label="Running report…" /></Card> : null}
          {error ? <Alert tone="danger" title="Report failed">{error.message}</Alert> : null}

          {result && !loading ? (
            <Card flush title={result.title} subtitle={result.subtitle || `${result.total} rows`} actions={<Badge tone="outline">{result.total} rows</Badge>}>
              {result.summary ? (
                <div className="grid grid-4" style={{ padding: 14, gap: 10 }}>
                  {Object.entries(result.summary).map(([k, v]) => (
                    <div key={k}>
                      <div className="fs-12 muted" style={{ textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</div>
                      <div className="strong">{typeof v === 'number' ? v.toLocaleString('en-IN') : String(v)}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              <DataTable
                rows={result.rows || []}
                columns={columns}
                emptyTitle="No rows for this filter"
                emptyText="Try widening the date range or removing filters."
                footer={<div className="table-foot"><span className="muted fs-12">{result.total} rows · generated {formatDate(new Date())}</span></div>}
              />
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
