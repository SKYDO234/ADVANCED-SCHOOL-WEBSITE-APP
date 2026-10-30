import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, openFile, post, useResource } from '../api.js';
import { useApp } from '../store.jsx';
import { useAcademic } from '../lib/academic.js';
import {
  Alert, Avatar, Badge, Button, Card, DataTable, EmptyState, Loading, PageHeader, Progress, SearchField,
  Tabs, formatDate, useToast,
} from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';

const STATUS_OPTIONS = [
  { value: 'present', label: 'P', title: 'Present' },
  { value: 'absent', label: 'A', title: 'Absent' },
  { value: 'late', label: 'L', title: 'Late' },
  { value: 'half_day', label: 'H', title: 'Half day' },
  { value: 'leave', label: 'Lv', title: 'Leave' },
];

function StatusPicker({ value, onChange, disabled }) {
  return (
    <div className="segmented" style={{ padding: 2 }}>
      {STATUS_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          title={opt.title}
          className={value === opt.value ? 'active' : ''}
          disabled={disabled}
          onClick={() => onChange(value === opt.value ? '' : opt.value)}
          style={{
            minWidth: 30, padding: '3px 6px', fontSize: 11.5, fontWeight: 650,
            color: value === opt.value
              ? (opt.value === 'absent' ? 'var(--danger)' : opt.value === 'present' ? 'var(--success)' : 'var(--warning)')
              : undefined,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function StudentsTab() {
  const toast = useToast();
  const { can } = useApp();
  const { classes, sectionsFor } = useAcademic();
  const [params, setParams] = useSearchParams();
  const [date, setDate] = useState(params.get('date') || new Date().toISOString().slice(0, 10));
  const [classId, setClassId] = useState(params.get('classId') || classes[0]?.id || '');
  const [sectionId, setSectionId] = useState(params.get('sectionId') || '');
  const [grid, setGrid] = useState(null);
  const [marks, setMarks] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!classId) return;
    setLoading(true);
    setGrid(null);
    get('/attendance/students/grid', { date, classId, sectionId: sectionId || undefined })
      .then((data) => {
        setGrid(data);
        const next = {};
        data.students.forEach((s) => { next[s.id] = { status: s.status || '', remark: s.remark || '' }; });
        setMarks(next);
      })
      .catch((err) => toast.error('Could not load attendance', err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, classId, sectionId]);

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (date) next.set('date', date);
    if (classId) next.set('classId', classId);
    if (sectionId) next.set('sectionId', sectionId);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, classId, sectionId]);

  const students = useMemo(() => {
    const list = grid?.students || [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((s) => s.full_name.toLowerCase().includes(q) || String(s.roll_no || '').includes(q));
  }, [grid, search]);

  const counts = useMemo(() => {
    const acc = { present: 0, absent: 0, late: 0, half_day: 0, leave: 0, unmarked: 0 };
    (grid?.students || []).forEach((s) => {
      const status = marks[s.id]?.status;
      if (status) acc[status] += 1;
      else acc.unmarked += 1;
    });
    return acc;
  }, [grid, marks]);

  const markAllPresent = () => {
    const next = { ...marks };
    students.forEach((s) => { next[s.id] = { ...next[s.id], status: 'present' }; });
    setMarks(next);
  };

  const save = async () => {
    const records = Object.entries(marks)
      .filter(([, v]) => v.status)
      .map(([student_id, v]) => ({ student_id, status: v.status, remark: v.remark || '' }));
    if (!records.length) return toast.warning('Nothing to save', 'Mark at least one student.');
    setSaving(true);
    try {
      const res = await post('/attendance/students', { date, classId, sectionId: sectionId || null, records });
      toast.success('Attendance saved', `${res.inserted} new, ${res.updated} updated${res.absentees ? `, ${res.absentees} absent` : ''}`);
      const data = await get('/attendance/students/grid', { date, classId, sectionId: sectionId || undefined });
      setGrid(data);
    } catch (err) {
      toast.error('Could not save attendance', err.message);
    } finally {
      setSaving(false);
    }
  };

  const canEdit = grid?.canEdit !== false;

  return (
    <>
      <div className="row row-wrap gap-1 mb-2">
        <input type="date" className="input" style={{ width: 'auto' }} value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
        <select className="select" style={{ width: 'auto' }} value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }}>
          <option value="">Select class</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!classId}>
          <option value="">All sections</option>
          {sectionsFor(classId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <SearchField value={search} onChange={setSearch} placeholder="Find student…" />
        <span className="grow" />
        {can('attendance.mark') ? <Button variant="outline" icon="check" onClick={markAllPresent} disabled={!students.length || !canEdit}>Mark all present</Button> : null}
        {can('attendance.mark') ? <Button variant="primary" icon="check" loading={saving} onClick={save} disabled={!students.length || !canEdit}>Save attendance</Button> : null}
      </div>

      {!classId ? <Card><EmptyState icon="attendance" title="Choose a class" text="Pick a class and section to mark attendance." /></Card> : null}
      {classId && loading ? <Card><Loading label="Loading class list…" /></Card> : null}
      {grid && !canEdit ? <div className="mb-2"><Alert tone="warning">This date is locked for corrections. Ask an administrator with correction rights to update it.</Alert></div> : null}

      {grid && !loading ? (
        <Card
          title={`${classes.find((c) => c.id === classId)?.name || ''} ${sectionsFor(classId).find((s) => s.id === sectionId)?.name || ''}`.trim() || 'Attendance'}
          subtitle={`${formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${grid.students.length} students`}
          actions={(
            <div className="row gap-1">
              <Badge tone="success">P {counts.present}</Badge>
              <Badge tone="danger">A {counts.absent}</Badge>
              <Badge tone="warning">L {counts.late}</Badge>
              {counts.unmarked ? <Badge tone="outline">{counts.unmarked} unmarked</Badge> : null}
            </div>
          )}
          flush
        >
          {students.length === 0 ? <EmptyState icon="students" title="No students in this class" /> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 70 }}>Roll</th>
                    <th>Student</th>
                    <th style={{ width: 170 }}>Status</th>
                    <th>Remark</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id}>
                      <td className="tnum">{search ? s.roll_no || '—' : (students.indexOf(s) + 1)}</td>
                      <td>
                        <div className="person">
                          <Avatar name={s.full_name} src={s.photo_url} size="sm" />
                          <div className="person-meta">
                            <div className="person-name">{s.full_name}</div>
                            <div className="person-sub">{s.admission_no}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <StatusPicker
                          value={marks[s.id]?.status || ''}
                          disabled={!canEdit || !can('attendance.mark')}
                          onChange={(status) => setMarks((prev) => ({ ...prev, [s.id]: { ...prev[s.id], status } }))}
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          style={{ minHeight: 30, padding: '4px 8px', fontSize: 12.6 }}
                          placeholder="Optional note"
                          disabled={!canEdit || !can('attendance.mark')}
                          value={marks[s.id]?.remark || ''}
                          onChange={(e) => setMarks((prev) => ({ ...prev, [s.id]: { ...prev[s.id], remark: e.target.value } }))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </>
  );
}

function SummaryTab() {
  const { classes, sectionsFor } = useAcademic();
  const toast = useToast();
  const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const { data, loading, reload } = useResource('/attendance/students/summary', { from, to, classId, sectionId });
  const { can } = useApp();

  const rows = data?.items || [];
  const average = rows.length ? Math.round(rows.reduce((s, r) => s + (r.percentage || 0), 0) / rows.length) : 0;

  return (
    <>
      <div className="row row-wrap gap-1 mb-2">
        <input type="date" className="input" style={{ width: 'auto' }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="muted">to</span>
        <input type="date" className="input" style={{ width: 'auto' }} value={to} onChange={(e) => setTo(e.target.value)} />
        <select className="select" style={{ width: 'auto' }} value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }}>
          <option value="">All classes</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!classId}>
          <option value="">All sections</option>
          {sectionsFor(classId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span className="grow" />
        {can('attendance.export') || can('attendance.report') ? (
          <>
            <Button variant="outline" icon="download" onClick={() => openFile('/attendance/students/report', { from, to, classId, sectionId, format: 'pdf' })}>PDF register</Button>
            <Button variant="outline" icon="download" onClick={() => openFile('/attendance/students/report', { from, to, classId, sectionId })}>Export</Button>
          </>
        ) : null}
      </div>

      <div className="grid grid-4 mb-2">
        <div className="card card-pad"><div className="fs-12 muted">Students</div><div className="stat-value">{rows.length}</div></div>
        <div className="card card-pad"><div className="fs-12 muted">Average attendance</div><div className="stat-value">{average}%</div></div>
        <div className="card card-pad"><div className="fs-12 muted">Below 75%</div><div className="stat-value">{rows.filter((r) => (r.percentage ?? 0) < 75).length}</div></div>
        <div className="card card-pad"><div className="fs-12 muted">Period</div><div className="fs-13 mt-1">{formatDate(from)} → {formatDate(to)}</div></div>
      </div>

      <Card flush>
        <DataTable
          loading={loading}
          rows={rows}
          columns={[
            { key: 'full_name', header: 'Student', render: (r) => (<div><div className="strong">{r.full_name}</div><div className="fs-12 muted">{r.class_name} {r.section_name} · Roll {r.roll_no || '—'}</div></div>) },
            { key: 'marked', header: 'Days marked', align: 'num' },
            { key: 'present', header: 'Present', align: 'num' },
            { key: 'absent', header: 'Absent', align: 'num' },
            { key: 'late', header: 'Late', align: 'num' },
            {
              key: 'percentage',
              header: 'Attendance',
              render: (r) => (
                <div className="row gap-1" style={{ minWidth: 140 }}>
                  <Progress small value={r.percentage || 0} max={100} tone={(r.percentage || 0) < 75 ? 'var(--danger)' : undefined} />
                  <span className="fs-12 tnum" style={{ width: 38, textAlign: 'right' }}>{r.percentage ?? '—'}%</span>
                </div>
              ),
            },
          ]}
          sortable
          emptyTitle="No attendance in this range"
          emptyText="Try widening the dates or picking another class."
        />
      </Card>
    </>
  );
}

function StaffTab() {
  const toast = useToast();
  const { can } = useApp();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [data, setData] = useState(null);
  const [marks, setMarks] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await get('/attendance/employees/grid', { date });
      setData(res);
      const next = {};
      res.employees.forEach((e) => { next[e.id] = { status: e.status || '', remark: e.remark || '' }; });
      setMarks(next);
    } catch (err) {
      toast.error('Could not load staff attendance', err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [date]);

  const save = async () => {
    const records = Object.entries(marks).filter(([, v]) => v.status).map(([employee_id, v]) => ({ employee_id, status: v.status, remark: v.remark || '' }));
    if (!records.length) return toast.warning('Nothing to save');
    setSaving(true);
    try {
      const res = await post('/attendance/employees', { date, records });
      toast.success('Staff attendance saved', `${res.saved ?? records.length} records saved`);
      load();
    } catch (err) {
      toast.error('Could not save', err.message);
    } finally {
      setSaving(false);
    }
  };

  const markAll = (status) => {
    const next = { ...marks };
    (data?.employees || []).forEach((e) => { next[e.id] = { ...next[e.id], status }; });
    setMarks(next);
  };

  return (
    <>
      <div className="row row-wrap gap-1 mb-2">
        <input type="date" className="input" style={{ width: 'auto' }} value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        <span className="grow" />
        {can('attendance.staff') ? (
          <>
            <Button variant="outline" icon="check" onClick={() => markAll('present')}>All present</Button>
            <Button variant="outline" icon="check" onClick={() => markAll('leave')}>All on leave</Button>
            <Button variant="primary" icon="check" loading={saving} onClick={save}>Save</Button>
          </>
        ) : null}
      </div>
      <Card flush title="Staff attendance" subtitle={formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}>
        {loading ? <Loading /> : (
          <DataTable
            rows={data?.employees || []}
            columns={[
              { key: 'full_name', header: 'Employee', render: (r) => (<div className="person"><Avatar name={r.full_name} size="sm" /><div className="person-meta"><div className="person-name">{r.full_name}</div><div className="person-sub">{r.designation || r.role} · {r.employee_code || ''}</div></div></div>) },
              { key: 'department', header: 'Department' },
              {
                key: 'status',
                header: 'Status',
                render: (r) => (
                  <StatusPicker
                    value={marks[r.id]?.status || ''}
                    disabled={!can('attendance.staff')}
                    onChange={(status) => setMarks((prev) => ({ ...prev, [r.id]: { ...prev[r.id], status } }))}
                  />
                ),
              },
              {
                key: 'remark',
                header: 'Remark',
                render: (r) => (
                  <input
                    className="input"
                    style={{ minHeight: 30, padding: '4px 8px', fontSize: 12.6, maxWidth: 220 }}
                    placeholder="Optional"
                    disabled={!can('attendance.staff')}
                    value={marks[r.id]?.remark || ''}
                    onChange={(e) => setMarks((prev) => ({ ...prev, [r.id]: { ...prev[r.id], remark: e.target.value } }))}
                  />
                ),
              },
            ]}
            emptyTitle="No employees"
          />
        )}
      </Card>
    </>
  );
}

export default function Attendance() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'students';
  const setTab = (value) => { const next = new URLSearchParams(params); next.set('tab', value); setParams(next, { replace: true }); };
  const { can } = useApp();

  return (
    <div className="page">
      <PageHeader title="Attendance" subtitle="Mark daily attendance, review summaries and export registers." />
      <Card flush>
        <div style={{ padding: '0 14px' }}>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'students', label: 'Students' },
              { value: 'summary', label: 'Summary & reports' },
              ...(can('attendance.staff') || can('attendance.view') ? [{ value: 'staff', label: 'Staff' }] : []),
            ]}
          />
        </div>
        <div style={{ padding: 16 }}>
          {tab === 'students' ? <StudentsTab /> : null}
          {tab === 'summary' ? <SummaryTab /> : null}
          {tab === 'staff' ? <StaffTab /> : null}
        </div>
      </Card>
    </div>
  );
}
