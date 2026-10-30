import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { del, post, useResource } from '../api.js';
import { useApp } from '../store.jsx';
import { useAcademic } from '../lib/academic.js';
import {
  Alert, Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Progress, SearchField, Select,
  StatusBadge, Textarea, formatDate, useToast,
} from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';

const EXAM_TYPES = [
  { value: 'unit_test', label: 'Unit test' },
  { value: 'term', label: 'Term examination' },
  { value: 'half_yearly', label: 'Half yearly' },
  { value: 'annual', label: 'Annual examination' },
  { value: 'practical', label: 'Practical' },
  { value: 'project', label: 'Project' },
  { value: 'custom', label: 'Custom' },
];

function NewExamModal({ open, onClose, onCreated }) {
  const toast = useToast();
  const { classes, sectionsFor, subjects, sessions, currentSession } = useAcademic();
  const [form, setForm] = useState({
    name: '', type: 'term', start_date: '', end_date: '', sessionId: currentSession?.id || '',
    pass_percentage: 33, show_rank: true, instructions: '',
  });
  const [entries, setEntries] = useState([]);
  const [draft, setDraft] = useState({ class_id: '', section_id: '', subject_ids: [], max_marks: 100, pass_marks: 33 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const addEntry = () => {
    if (!draft.class_id || draft.subject_ids.length === 0) return;
    const cls = classes.find((c) => c.id === draft.class_id);
    const sec = sectionsFor(draft.class_id).find((s) => s.id === draft.section_id);
    setEntries((prev) => [...prev, {
      ...draft,
      label: `${cls?.name || 'Class'}${sec ? ` · ${sec.name}` : ''} · ${draft.subject_ids.length} subject(s)`,
      max_marks: Number(draft.max_marks) || 100,
      pass_marks: Number(draft.pass_marks) || 33,
    }]);
    setDraft({ class_id: '', section_id: '', subject_ids: [], max_marks: 100, pass_marks: 33 });
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await post('/exams', {
        ...form,
        classes: entries.map(({ label, ...rest }) => rest),
      });
      toast.success('Examination created', `${entries.length} class groups configured`);
      onClose();
      onCreated?.(res.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleSubject = (id, checked) => setDraft((prev) => ({
    ...prev,
    subject_ids: checked ? [...prev.subject_ids, id] : prev.subject_ids.filter((s) => s !== id),
  }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create an examination"
      subtitle="Choose classes and subjects, then enter marks. Results are computed automatically."
      size="xl"
      busy={busy}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit} disabled={!form.name || !entries.length}>Create examination</Button>
        </>
      )}
    >
      {error ? <div className="mb-2"><Alert tone="danger">{error}</Alert></div> : null}
      <div className="field-row">
        <Input label="Exam name" required placeholder="Term 1 Examination" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Select label="Type" value={form.type} options={EXAM_TYPES} onChange={(e) => setForm({ ...form, type: e.target.value })} />
        <Select label="Session" value={form.sessionId} options={sessions.map((s) => ({ value: s.id, label: s.name }))} onChange={(e) => setForm({ ...form, sessionId: e.target.value })} />
      </div>
      <div className="field-row">
        <Input label="Start date" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
        <Input label="End date" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
        <Input label="Pass percentage" type="number" min="0" max="100" value={form.pass_percentage} onChange={(e) => setForm({ ...form, pass_percentage: e.target.value })} />
      </div>

      <h4 className="mb-2">Classes & subjects</h4>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'end' }}>
        <Select label="Class" placeholder="Select" options={classes.map((c) => ({ value: c.id, label: c.name }))} value={draft.class_id} onChange={(e) => setDraft({ ...draft, class_id: e.target.value, section_id: '' })} />
        <Select label="Section" placeholder="Whole class" options={sectionsFor(draft.class_id)} value={draft.section_id} onChange={(e) => setDraft({ ...draft, section_id: e.target.value })} disabled={!draft.class_id} />
        <Input label="Max marks" type="number" value={draft.max_marks} onChange={(e) => setDraft({ ...draft, max_marks: e.target.value })} />
        <Input label="Pass marks" type="number" value={draft.pass_marks} onChange={(e) => setDraft({ ...draft, pass_marks: e.target.value })} />
        <Button variant="outline" icon="plus" onClick={addEntry} disabled={!draft.class_id || !draft.subject_ids.length}>Add</Button>
      </div>
      {draft.class_id ? (
        <div className="mt-2" style={{ maxHeight: 150, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 10, padding: 10 }}>
          <div className="fs-12 muted mb-1">Select subjects</div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 6 }}>
            {subjects.map((s) => (
              <label key={s.id} className="checkbox">
                <input type="checkbox" checked={draft.subject_ids.includes(s.id)} onChange={(e) => toggleSubject(s.id, e.target.checked)} />
                <span>{s.name}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {entries.length ? (
        <div className="mt-2">
          {entries.map((entry, i) => (
            <div key={i} className="file-row">
              <span className="file-icon"><Icon name="exams" size={15} /></span>
              <span className="grow fs-13">{entry.label}</span>
              <span className="fs-12 muted">max {entry.max_marks}</span>
              <Button size="sm" variant="ghost" icon="trash" onClick={() => setEntries((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Remove" />
            </div>
          ))}
        </div>
      ) : <p className="fs-13 muted mt-1">Add at least one class group to continue.</p>}

      <Textarea label="Instructions" rows={2} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} hint="Shown to teachers entering marks." />
      <label className="checkbox">
        <input type="checkbox" checked={form.show_rank} onChange={(e) => setForm({ ...form, show_rank: e.target.checked })} />
        <span>Show class rank on report cards</span>
      </label>
    </Modal>
  );
}

export default function Exams() {
  const { can } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const { data, loading, reload } = useResource('/exams', { q, status });

  const rows = data?.items || [];

  const remove = async (exam) => {
    if (!window.confirm(`Delete ${exam.name}? Marks entry will be lost.`)) return;
    try {
      await del(`/exams/${exam.id}`);
      toast.success('Examination deleted');
      reload(true);
    } catch (err) {
      toast.error('Could not delete', err.message);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Examinations"
        subtitle="Create exams, open marks entry, compute ranks and publish results."
        actions={can('exams.create') ? <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>New examination</Button> : null}
      />

      <div className="row row-wrap gap-1 mb-2">
        <SearchField value={q} onChange={setQ} placeholder="Search examinations…" />
        <select className="select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="marks_entry">Marks entry</option>
          <option value="marks_complete">Marks complete</option>
          <option value="finalized">Finalized</option>
          <option value="published">Published</option>
        </select>
        <span className="grow" />
        <span className="fs-12 muted">{rows.length} examinations</span>
      </div>

      {!loading && rows.length === 0 ? (
        <Card>
          <EmptyState
            icon="exams"
            title="No examinations yet"
            text="Create an examination, add classes and subjects, then invite teachers to enter marks."
            action={can('exams.create') ? <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>Create your first exam</Button> : null}
          />
        </Card>
      ) : (
        <div className="grid grid-2">
          {rows.map((exam) => (
            <Card key={exam.id} flush>
              <div className="card-head" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row gap-1">
                    <h3 className="truncate">{exam.name}</h3>
                    <StatusBadge status={exam.status} />
                  </div>
                  <div className="fs-12 muted mt-0" style={{ marginTop: 3 }}>
                    {exam.session_name || ''} · {EXAM_TYPES.find((t) => t.value === exam.type)?.label || exam.type}
                    {exam.start_date ? ` · ${formatDate(exam.start_date)}` : ''}
                  </div>
                </div>
                <Button size="sm" variant="ghost" icon="chevronRight" onClick={() => navigate(`/app/exams/${exam.id}`)} aria-label="Open" />
              </div>
              <div className="card-body" style={{ paddingTop: 0 }}>
                <div className="row-between fs-12 muted mb-1">
                  <span>Marks entry</span>
                  <span className="tnum">{exam.marksProgress || 0}%</span>
                </div>
                <Progress value={exam.marksProgress || 0} small />
                <div className="row-between mt-2">
                  <div className="row gap-1">
                    <Badge tone="outline">{exam.result_count || 0} results</Badge>
                    {exam.published_count ? <Badge tone="success">{exam.published_count} published</Badge> : null}
                  </div>
                  <div className="row gap-1">
                    {exam.status !== 'published' ? (
                      <Button size="sm" variant="outline" onClick={() => navigate(`/app/exams/${exam.id}?tab=marks`)}>Marks</Button>
                    ) : null}
                    <Button size="sm" variant="primary" onClick={() => navigate(`/app/exams/${exam.id}`)}>Open</Button>
                    {can('exams.delete') && !['finalized', 'published'].includes(exam.status) ? (
                      <Button size="sm" variant="ghost" icon="trash" onClick={() => remove(exam)} aria-label="Delete" />
                    ) : null}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <NewExamModal open={open} onClose={() => setOpen(false)} onCreated={(id) => { reload(true); if (id) navigate(`/app/exams/${id}`); }} />
    </div>
  );
}
