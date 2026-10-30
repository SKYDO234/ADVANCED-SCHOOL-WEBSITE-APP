import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { del, get, patch, post, useResource } from '../api.js';
import { useApp } from '../store.jsx';
import { useAcademic } from '../lib/academic.js';
import {
  Alert, Badge, Button, Card, DataTable, EmptyState, Input, Loading, Modal, PageHeader, Select, StatusBadge,
  Tabs, formatDate, useToast,
} from '../ui/index.jsx';

function useTab(name) {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || name;
  const setTab = (value) => { const next = new URLSearchParams(params); next.set('tab', value); setParams(next, { replace: true }); };
  return [tab, setTab];
}

/* ------------------------------- classes tab ------------------------------- */

function ClassesTab() {
  const toast = useToast();
  const { can } = useApp();
  const { data, loading, reload } = useResource('/academics/classes');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', stream: '', sections: 'A' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sectionFor, setSectionFor] = useState(null);
  const [sectionForm, setSectionForm] = useState({ name: '', capacity: 40, class_teacher_id: '' });

  const addClass = async () => {
    setBusy(true);
    setError('');
    try {
      await post('/academics/classes', {
        name: form.name,
        code: form.code,
        stream: form.stream,
        sections: form.sections.split(',').map((s) => s.trim()).filter(Boolean),
      });
      toast.success('Class created');
      setOpen(false);
      setForm({ name: '', code: '', stream: '', sections: 'A' });
      reload(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const addSection = async () => {
    setBusy(true);
    try {
      await post(`/academics/classes/${sectionFor.id}/sections`, { ...sectionForm, capacity: Number(sectionForm.capacity) || 40 });
      toast.success('Section added');
      setSectionFor(null);
      setSectionForm({ name: '', capacity: 40, class_teacher_id: '' });
      reload(true);
    } catch (err) {
      toast.error('Could not add section', err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Loading />;

  return (
    <>
      <div className="row-between mb-2">
        <span className="muted fs-13">{(data?.items || []).length} classes · {(data?.items || []).reduce((s, c) => s + c.sections.length, 0)} sections</span>
        {can('classes.create') ? <Button variant="primary" size="sm" icon="plus" onClick={() => setOpen(true)}>New class</Button> : null}
      </div>
      {(data?.items || []).length === 0 ? <EmptyState icon="classes" title="No classes yet" text="Create your first class and sections to start admitting students." /> : (
        <div className="grid grid-3">
          {data.items.map((c) => (
            <div key={c.id} className="card">
              <div className="card-head">
                <div>
                  <h3>{c.name}</h3>
                  <div className="fs-12 muted">{c.studentCount} students {c.stream ? `· ${c.stream}` : ''}</div>
                </div>
                {can('classes.create') ? <Button size="sm" variant="ghost" icon="plus" onClick={() => setSectionFor(c)} aria-label="Add section" /> : null}
              </div>
              <div className="card-body" style={{ paddingTop: 0 }}>
                {c.sections.length === 0 ? <p className="fs-13 muted">No sections</p> : (
                  <div className="stack-sm">
                    {c.sections.map((s) => (
                      <div key={s.id} className="row-between fs-13" style={{ padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
                        <span className="row gap-1">
                          <Badge tone="accent">{s.name}</Badge>
                          <span className="muted">{s.studentCount}/{s.capacity || 40}</span>
                        </span>
                        <span className="fs-12 muted truncate">{s.class_teacher_name || 'No class teacher'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create a class"
        size="sm"
        busy={busy}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={addClass} disabled={!form.name.trim()}>Create class</Button></>}
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Input label="Class name" required placeholder="Class 8" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label="Code" placeholder="C8" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        <Input label="Sections" placeholder="A, B, C" value={form.sections} onChange={(e) => setForm({ ...form, sections: e.target.value })} hint="Comma separated. Defaults to A." />
        <Input label="Stream" placeholder="Science / Commerce / General" value={form.stream} onChange={(e) => setForm({ ...form, stream: e.target.value })} />
      </Modal>

      <Modal
        open={!!sectionFor}
        onClose={() => setSectionFor(null)}
        title={`Add section to ${sectionFor?.name || ''}`}
        size="sm"
        busy={busy}
        footer={<><Button variant="ghost" onClick={() => setSectionFor(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={addSection} disabled={!sectionForm.name.trim()}>Add section</Button></>}
      >
        <Input label="Section name" required placeholder="B" value={sectionForm.name} onChange={(e) => setSectionForm({ ...sectionForm, name: e.target.value.toUpperCase() })} />
        <Input label="Capacity" type="number" value={sectionForm.capacity} onChange={(e) => setSectionForm({ ...sectionForm, capacity: e.target.value })} />
        <Select
          label="Class teacher"
          placeholder="Not assigned"
          options={(data?.teachers || []).map((t) => ({ value: t.id, label: t.full_name }))}
          value={sectionForm.class_teacher_id}
          onChange={(e) => setSectionForm({ ...sectionForm, class_teacher_id: e.target.value })}
        />
      </Modal>
    </>
  );
}

/* ------------------------------ subjects tab ------------------------------- */

function SubjectsTab() {
  const toast = useToast();
  const { can } = useApp();
  const { data, loading, reload } = useResource('/academics/subjects');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', code: '', type: 'theory' });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      if (editing) await patch(`/academics/subjects/${editing.id}`, form);
      else await post('/academics/subjects', form);
      toast.success(editing ? 'Subject updated' : 'Subject created');
      setOpen(false);
      setEditing(null);
      setForm({ name: '', code: '', type: 'theory' });
      reload(true);
    } catch (err) {
      toast.error('Could not save subject', err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete ${row.name}?`)) return;
    try {
      await del(`/academics/subjects/${row.id}`);
      toast.success('Subject deleted');
      reload(true);
    } catch (err) {
      toast.error('Could not delete subject', err.message);
    }
  };

  if (loading && !data) return <Loading />;
  return (
    <>
      <div className="row-between mb-2">
        <span className="muted fs-13">{(data?.items || []).length} subjects</span>
        {can('classes.create') ? <Button size="sm" variant="primary" icon="plus" onClick={() => { setEditing(null); setForm({ name: '', code: '', type: 'theory' }); setOpen(true); }}>New subject</Button> : null}
      </div>
      <Card flush>
        <DataTable
          rows={data?.items || []}
          columns={[
            { key: 'name', header: 'Subject', render: (r) => <strong>{r.name}</strong> },
            { key: 'code', header: 'Code' },
            { key: 'type', header: 'Type', render: (r) => <Badge tone={r.type === 'practical' ? 'info' : 'outline'}>{r.type || 'theory'}</Badge> },
            { key: 'max_marks', header: 'Max marks', align: 'num' },
            {
              key: 'actions',
              header: '',
              align: 'actions',
              render: (r) => (can('classes.edit') ? (
                <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                  <Button size="sm" variant="ghost" icon="edit" onClick={() => { setEditing(r); setForm({ name: r.name, code: r.code || '', type: r.type || 'theory' }); setOpen(true); }} aria-label="Edit" />
                  <Button size="sm" variant="ghost" icon="trash" onClick={() => remove(r)} aria-label="Delete" />
                </div>
              ) : null),
            },
          ]}
          emptyTitle="No subjects"
          emptyText="Add subjects so you can build timetables and exams."
        />
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit subject' : 'New subject'}
        size="sm"
        busy={busy}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!form.name.trim()}>Save</Button></>}
      >
        <Input label="Subject name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        <Select label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} options={[{ value: 'theory', label: 'Theory' }, { value: 'practical', label: 'Practical' }, { value: 'activity', label: 'Activity' }]} />
      </Modal>
    </>
  );
}

/* ------------------------------- sessions tab ------------------------------ */

function SessionsTab() {
  const toast = useToast();
  const { can } = useApp();
  const { data: sessionsData, reload: reloadSessions } = useResource('/academics/sessions');
  const { data: holidayData, reload: reloadHolidays } = useResource('/academics/holidays');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', start_date: '', end_date: '' });
  const [holidayOpen, setHolidayOpen] = useState(false);
  const [holiday, setHoliday] = useState({ name: '', date: '', type: 'holiday' });
  const [busy, setBusy] = useState(false);

  const saveSession = async () => {
    setBusy(true);
    try {
      await post('/academics/sessions', form);
      toast.success('Session created');
      setOpen(false);
      reloadSessions(true);
    } catch (err) {
      toast.error('Could not create session', err.message);
    } finally {
      setBusy(false);
    }
  };

  const makeCurrent = async (session) => {
    try {
      await post(`/academics/sessions/${session.id}/current`);
      toast.success(`${session.name} is now the current session`);
      reloadSessions(true);
    } catch (err) {
      toast.error('Could not switch session', err.message);
    }
  };

  const saveHoliday = async () => {
    setBusy(true);
    try {
      await post('/academics/holidays', holiday);
      toast.success('Added to calendar');
      setHolidayOpen(false);
      setHoliday({ name: '', date: '', type: 'holiday' });
      reloadHolidays(true);
    } catch (err) {
      toast.error('Could not add holiday', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-2">
      <Card
        title="Academic sessions"
        icon="calendar"
        actions={can('settings.session') ? <Button size="sm" variant="primary" icon="plus" onClick={() => setOpen(true)}>New session</Button> : null}
      >
        {(sessionsData?.items || []).length === 0 ? <EmptyState icon="calendar" title="No sessions" /> : (
          <div className="stack-sm">
            {(sessionsData.items || []).map((s) => (
              <div key={s.id} className="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <div>
                  <div className="row gap-1">
                    <strong className="fs-13">{s.name}</strong>
                    {s.is_current ? <Badge tone="success">current</Badge> : null}
                  </div>
                  <div className="fs-12 muted">{formatDate(s.start_date)} → {formatDate(s.end_date)}</div>
                </div>
                {!s.is_current && can('settings.session') ? <Button size="sm" variant="ghost" onClick={() => makeCurrent(s)}>Set current</Button> : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Holidays & events"
        icon="star"
        actions={can('settings.session') ? <Button size="sm" variant="outline" icon="plus" onClick={() => setHolidayOpen(true)}>Add</Button> : null}
      >
        {(holidayData?.items || []).length === 0 ? <EmptyState icon="calendar" title="No holidays added" /> : (
          <div className="stack-sm">
            {holidayData.items.map((h) => (
              <div key={h.id} className="row-between" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                <div className="row gap-2">
                  <Badge tone={h.type === 'event' ? 'info' : 'accent'}>{h.type || 'holiday'}</Badge>
                  <div>
                    <div className="strong fs-13">{h.name}</div>
                    <div className="fs-12 muted">{formatDate(h.date)}</div>
                  </div>
                </div>
                {can('settings.session') ? (
                  <Button size="sm" variant="ghost" icon="trash" aria-label="Delete" onClick={async () => { await del(`/academics/holidays/${h.id}`); reloadHolidays(true); }} />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create academic session"
        size="sm"
        busy={busy}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={saveSession} disabled={!form.name || !form.start_date || !form.end_date}>Create</Button></>}
      >
        <Input label="Session name" required placeholder="2027-28" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <div className="field-row">
          <Input label="Start date" type="date" required value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          <Input label="End date" type="date" required value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
        </div>
        <Alert tone="info">New sessions start empty. Promote students by updating their class and session.</Alert>
      </Modal>

      <Modal
        open={holidayOpen}
        onClose={() => setHolidayOpen(false)}
        title="Add holiday or event"
        size="sm"
        busy={busy}
        footer={<><Button variant="ghost" onClick={() => setHolidayOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={saveHoliday} disabled={!holiday.name || !holiday.date}>Add</Button></>}
      >
        <Input label="Title" required value={holiday.name} onChange={(e) => setHoliday({ ...holiday, name: e.target.value })} />
        <Input label="Date" type="date" required value={holiday.date} onChange={(e) => setHoliday({ ...holiday, date: e.target.value })} />
        <Select label="Type" value={holiday.type} onChange={(e) => setHoliday({ ...holiday, type: e.target.value })} options={[{ value: 'holiday', label: 'Holiday' }, { value: 'event', label: 'Event' }, { value: 'exam', label: 'Exam day' }]} />
      </Modal>
    </div>
  );
}

/* ----------------------------- assignments tab ----------------------------- */

function AssignmentsTab() {
  const toast = useToast();
  const { can } = useApp();
  const { classes, subjects, currentSession, sectionsFor } = useAcademic();
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ subject_id: '', teacher_id: '', periods_week: 5 });
  const [busy, setBusy] = useState(false);
  const [teachers, setTeachers] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await get('/academics/assignments', { classId: classId || undefined });
      setRows(data.items || []);
      const cls = await get('/academics/classes');
      setTeachers(cls.teachers || []);
    } catch (err) {
      toast.error('Could not load assignments', err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [classId]);

  const assign = async () => {
    if (!classId || !form.subject_id) return;
    setBusy(true);
    try {
      await post('/academics/assignments', {
        sessionId: currentSession?.id,
        items: [{ class_id: classId, section_id: sectionId || null, subject_id: form.subject_id, teacher_id: form.teacher_id || null, periods_week: Number(form.periods_week) || 5 }],
      });
      toast.success('Subject teacher assigned');
      setForm({ subject_id: '', teacher_id: '', periods_week: 5 });
      load();
    } catch (err) {
      toast.error('Could not assign', err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row) => {
    try {
      await del(`/academics/assignments/${row.id}`);
      toast.success('Assignment removed');
      load();
    } catch (err) {
      toast.error('Could not remove', err.message);
    }
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16, alignItems: 'start' }}>
      <Card flush title="Subject–teacher assignments" subtitle={`Session ${currentSession?.name || '—'}`}>
        <div className="row gap-1" style={{ padding: 12, borderBottom: '1px solid var(--line)' }}>
          <select className="select" style={{ width: 'auto' }} value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }}>
            <option value="">All classes</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!classId}>
            <option value="">Whole class</option>
            {sectionsFor(classId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <DataTable
          loading={loading}
          rows={rows}
          columns={[
            { key: 'class_name', header: 'Class', render: (r) => `${r.class_name || ''}${r.section_name ? ` · ${r.section_name}` : ''}` },
            { key: 'subject_name', header: 'Subject' },
            { key: 'teacher_name', header: 'Teacher', render: (r) => r.teacher_name || <span className="muted">Unassigned</span> },
            { key: 'periods_week', header: 'Periods/week', align: 'num' },
            { key: 'a', header: '', align: 'actions', render: (r) => (can('classes.assign') ? <Button size="sm" variant="ghost" icon="trash" onClick={() => remove(r)} aria-label="Remove" /> : null) },
          ]}
          emptyTitle="No assignments"
          emptyText="Assign subjects to teachers so they appear in timetables and exams."
        />
      </Card>

      {can('classes.assign') ? (
        <Card title="Assign a subject teacher" icon="userCheck">
          <Select label="Class" placeholder="Select class" options={classes.map((c) => ({ value: c.id, label: c.name }))} value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }} />
          <Select label="Section" placeholder="Whole class" options={sectionsFor(classId)} value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!classId} />
          <Select label="Subject" placeholder="Select subject" options={subjects.map((s) => ({ value: s.id, label: s.name }))} value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })} />
          <Select label="Teacher" placeholder="Unassigned" options={teachers.map((t) => ({ value: t.id, label: t.full_name }))} value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value })} />
          <Input label="Periods per week" type="number" min="0" max="40" value={form.periods_week} onChange={(e) => setForm({ ...form, periods_week: e.target.value })} />
          <Button block variant="primary" loading={busy} onClick={assign} disabled={!classId || !form.subject_id}>Assign</Button>
        </Card>
      ) : null}
    </div>
  );
}

/* ------------------------------- periods tab ------------------------------- */

function PeriodsTab() {
  const toast = useToast();
  const { can } = useApp();
  const { data, reload } = useResource('/academics/periods');
  const [form, setForm] = useState({ name: '', start_time: '08:00', end_time: '08:45', is_break: false });
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    try {
      await post('/academics/periods', { ...form, is_break: Boolean(form.is_break) });
      toast.success('Period added');
      setForm({ name: '', start_time: '08:00', end_time: '08:45', is_break: false });
      reload(true);
    } catch (err) {
      toast.error('Could not add period', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-2">
      <Card flush title="Daily periods" subtitle="Used by timetables and the portal">
        <DataTable
          rows={data?.items || []}
          columns={[
            { key: 'sort_order', header: '#', width: 40 },
            { key: 'name', header: 'Period', render: (r) => <strong>{r.name}</strong> },
            { key: 'start_time', header: 'Start' },
            { key: 'end_time', header: 'End' },
            { key: 'is_break', header: 'Type', render: (r) => <Badge tone={r.is_break ? 'warning' : 'outline'}>{r.is_break ? 'break' : 'class'}</Badge> },
            { key: 'a', header: '', align: 'actions', render: (r) => (can('timetable.periods') ? <Button size="sm" variant="ghost" icon="trash" aria-label="Delete" onClick={async () => { await del(`/academics/periods/${r.id}`); reload(true); }} /> : null) },
          ]}
          emptyTitle="No periods configured"
        />
      </Card>
      {can('timetable.periods') ? (
        <Card title="Add a period" icon="clock">
          <Input label="Name" placeholder="Period 1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="field-row">
            <Input label="Start" type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
            <Input label="End" type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
          </div>
          <label className="checkbox mb-2">
            <input type="checkbox" checked={form.is_break} onChange={(e) => setForm({ ...form, is_break: e.target.checked })} />
            <span>This is a break</span>
          </label>
          <Button block variant="primary" loading={busy} onClick={add} disabled={!form.name.trim()}>Add period</Button>
        </Card>
      ) : null}
    </div>
  );
}

export default function Academics() {
  const [tab, setTab] = useTab('classes');
  return (
    <div className="page">
      <PageHeader title="Classes & subjects" subtitle="Master data for classes, sections, subjects, sessions and timetables." />
      <Card flush>
        <div style={{ padding: '0 14px' }}>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'classes', label: 'Classes & sections' },
              { value: 'subjects', label: 'Subjects' },
              { value: 'assignments', label: 'Subject teachers' },
              { value: 'periods', label: 'Periods' },
              { value: 'sessions', label: 'Sessions & holidays' },
            ]}
          />
        </div>
        <div style={{ padding: 16 }}>
          {tab === 'classes' ? <ClassesTab /> : null}
          {tab === 'subjects' ? <SubjectsTab /> : null}
          {tab === 'assignments' ? <AssignmentsTab /> : null}
          {tab === 'periods' ? <PeriodsTab /> : null}
          {tab === 'sessions' ? <SessionsTab /> : null}
        </div>
      </Card>
    </div>
  );
}
