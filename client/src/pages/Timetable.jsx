import { useEffect, useMemo, useState } from 'react';
import { del, get, post } from '../api.js';
import { useApp } from '../store.jsx';
import { useAcademic, WEEKDAYS } from '../lib/academic.js';
import {
  Alert, Badge, Button, Card, EmptyState, Loading, Modal, PageHeader, Select, Input, useToast,
} from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';

export default function Timetable() {
  const { can } = useApp();
  const { classes, sectionsFor, subjects, periods } = useAcademic();
  const toast = useToast();
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [slot, setSlot] = useState(null);
  const [form, setForm] = useState({ subject_id: '', teacher_id: '', room: '' });
  const [teachers, setTeachers] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!classId && classes.length) setClassId(classes[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classes]);

  useEffect(() => {
    if (!classId) return;
    const sections = sectionsFor(classId);
    if (!sections.find((s) => s.id === sectionId)) setSectionId(sections[0]?.id || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  const load = async () => {
    if (!sectionId) { setData(null); return; }
    setLoading(true);
    try {
      const res = await get('/academics/timetable', { sectionId });
      setData(res);
    } catch (err) {
      toast.error('Could not load timetable', err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [sectionId]);

  useEffect(() => {
    get('/academics/classes').then((res) => setTeachers(res.teachers || [])).catch(() => {});
  }, []);

  const entries = data?.entries || [];
  const days = WEEKDAYS.slice(0, 6);
  const orderedPeriods = (data?.periods?.length ? data.periods : periods);

  const entryFor = (periodId, day) => entries.find((e) => e.period_id === periodId && e.day === day);

  const openSlot = (period, day) => {
    if (!can('timetable.manage')) return;
    const entry = entryFor(period.id, day);
    setSlot({ period, day, entry });
    setForm({
      subject_id: entry?.subject_id || '',
      teacher_id: entry?.teacher_id || '',
      room: entry?.room || '',
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      if (!form.subject_id) {
        if (slot.entry) await del(`/academics/timetable/${slot.entry.id}`);
        toast.success('Slot cleared');
      } else {
        await post('/academics/timetable', {
          section_id: sectionId,
          period_id: slot.period.id,
          day: slot.day,
          subject_id: form.subject_id,
          teacher_id: form.teacher_id || null,
          room: form.room || null,
        });
        toast.success('Timetable updated');
      }
      setSlot(null);
      load();
    } catch (err) {
      toast.error('Could not update slot', err.message);
    } finally {
      setSaving(false);
    }
  };

  const filled = entries.length;
  const capacity = orderedPeriods.filter((p) => !p.is_break).length * days.length;

  return (
    <div className="page">
      <PageHeader
        title="Timetable"
        subtitle="Weekly period plan per section. Click a cell to assign a subject and teacher."
        actions={(
          <>
            <select className="select" style={{ width: 'auto' }} value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }}>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="select" style={{ width: 'auto' }} value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              <option value="">Select section</option>
              {sectionsFor(classId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </>
        )}
      />

      {!sectionsFor(classId).length ? <Card><EmptyState icon="classes" title="No sections in this class" text="Add sections under Classes & subjects first." /></Card> : null}
      {loading ? <Card><Loading /></Card> : null}

      {!loading && data ? (
        <Card
          title={`${classes.find((c) => c.id === classId)?.name || ''} ${sectionsFor(classId).find((s) => s.id === sectionId)?.name || ''}`.trim() || 'Weekly plan'}
          subtitle={`${filled} of ${capacity} teaching slots filled`}
          actions={<Badge tone={filled === capacity ? 'success' : 'outline'}>{capacity ? Math.round((filled / capacity) * 100) : 0}% filled</Badge>}
          flush
        >
          <div style={{ padding: 14, overflowX: 'auto' }}>
            <div className="timetable-grid">
              <div className="tt-row" style={{ '--periods': orderedPeriods.length }}>
                <div className="tt-cell head">Day</div>
                {orderedPeriods.map((p) => (
                  <div key={p.id} className="tt-cell head">
                    {p.name}
                    <div style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{p.start_time}–{p.end_time}</div>
                  </div>
                ))}
              </div>
              {days.map((d) => (
                <div key={d.value} className="tt-row" style={{ '--periods': orderedPeriods.length }}>
                  <div className="tt-cell head" style={{ display: 'grid', placeItems: 'center' }}>{d.short}</div>
                  {orderedPeriods.map((p) => {
                    const entry = entryFor(p.id, d.value);
                    if (p.is_break) return <div key={p.id} className="tt-cell break">Break</div>;
                    return (
                      <div
                        key={p.id}
                        className={`tt-cell ${entry ? 'filled' : 'empty-cell'}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => openSlot(p, d.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') openSlot(p, d.value); }}
                        title={entry ? `${entry.subject_name} · ${entry.teacher_name || 'No teacher'}` : 'Add subject'}
                      >
                        {entry ? (
                          <>
                            <div className="subj">{entry.subject_name || '—'}</div>
                            <div className="teacher">{entry.teacher_name || 'Unassigned'}</div>
                            {entry.room ? <div className="teacher">Room {entry.room}</div> : null}
                          </>
                        ) : <Icon name="plus" size={14} />}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          {!can('timetable.manage') ? <div style={{ padding: '0 14px 14px' }}><Alert tone="info">You have view-only access to the timetable.</Alert></div> : null}
        </Card>
      ) : null}

      <Modal
        open={!!slot}
        onClose={() => setSlot(null)}
        title={slot ? `${slot.period.name} · ${days.find((d) => d.value === slot.day)?.label}` : ''}
        subtitle="Choose the subject and teacher for this slot."
        size="sm"
        busy={saving}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setSlot(null)} disabled={saving}>Cancel</Button>
            {slot?.entry ? <Button variant="soft-danger" onClick={() => { setForm({ ...form, subject_id: '' }); }} disabled={saving}>Clear slot</Button> : null}
            <Button variant="primary" loading={saving} onClick={save}>Save slot</Button>
          </>
        )}
      >
        <Select label="Subject" placeholder="Free period" options={subjects.map((s) => ({ value: s.id, label: s.name }))} value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })} />
        <Select label="Teacher" placeholder="Unassigned" options={teachers.map((t) => ({ value: t.id, label: t.full_name }))} value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value })} />
        <Input label="Room" placeholder="Lab 2 / 204" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} />
      </Modal>
    </div>
  );
}
