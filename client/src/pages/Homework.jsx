import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { assetUrl, del, get, patch, post, upload, useDebounced } from '../api.js';
import { useApp } from '../store.jsx';
import { useAcademic } from '../lib/academic.js';
import {
  Alert, Badge, Button, Card, DataTable, EmptyState, FileDrop, Input, Loading, Modal, PageHeader, Pagination,
  Progress, SearchField, Select, StatusBadge, Tabs, Textarea, formatDate, useToast,
} from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';

function AssignmentModal({ open, onClose, onDone, initial }) {
  const toast = useToast();
  const { classes, sectionsFor, subjects } = useAcademic();
  const [form, setForm] = useState({ title: '', description: '', instructions: '', class_id: '', section_id: '', subject_id: '', due_date: '', max_marks: 20, status: 'published', attachment_url: '' });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const due = new Date();
    due.setDate(due.getDate() + 3);
    setForm(initial ? {
      ...initial,
      class_id: initial.class_id || '',
      section_id: initial.section_id || '',
      subject_id: initial.subject_id || '',
      attachment_url: initial.attachment_url || '',
    } : { title: '', description: '', instructions: '', class_id: classes[0]?.id || '', section_id: '', subject_id: '', due_date: due.toISOString().slice(0, 10), max_marks: 20, status: 'published', attachment_url: '' });
  }, [open, initial, classes]);

  const save = async () => {
    setBusy(true);
    try {
      const payload = { ...form, section_id: form.section_id || null, subject_id: form.subject_id || null, max_marks: Number(form.max_marks) || 0, attachment_url: form.attachment_url || null };
      if (initial?.id) await patch(`/homework/assignments/${initial.id}`, payload);
      else await post('/homework/assignments', payload);
      toast.success(initial ? 'Assignment updated' : 'Assignment published');
      onDone?.();
      onClose();
    } catch (err) {
      toast.error('Could not save assignment', err.message);
    } finally {
      setBusy(false);
    }
  };

  const uploadFile = async (file) => {
    setUploading(true);
    try {
      const res = await upload('/uploads', file, { bucket: 'homework' });
      setForm((prev) => ({ ...prev, attachment_url: res.url }));
      toast.success('Attachment uploaded');
    } catch (err) {
      toast.error('Upload failed', err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit assignment' : 'New assignment'} size="lg" busy={busy}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!form.title || !form.class_id || !form.due_date}>{initial ? 'Save changes' : 'Publish assignment'}</Button></>}>
      <Input label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <div className="field-row">
        <Select label="Class" options={classes.map((c) => ({ value: c.id, label: c.name }))} value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value, section_id: '' })} />
        <Select label="Section" placeholder="Whole class" options={sectionsFor(form.class_id)} value={form.section_id} onChange={(e) => setForm({ ...form, section_id: e.target.value })} />
        <Select label="Subject" placeholder="General" options={subjects.map((s) => ({ value: s.id, label: s.name }))} value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })} />
      </div>
      <div className="field-row">
        <Input label="Due date" type="date" required value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
        <Input label="Max marks" type="number" value={form.max_marks} onChange={(e) => setForm({ ...form, max_marks: e.target.value })} />
        <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={[{ value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft' }, { value: 'closed', label: 'Closed' }]} />
      </div>
      <Textarea label="Description" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <Textarea label="Instructions" rows={2} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
      <label className="label mb-1">Attachment</label>
      <FileDrop onFile={uploadFile} uploading={uploading} currentUrl={form.attachment_url} label="Upload a worksheet or reference (optional)" />
    </Modal>
  );
}

function MaterialsTab({ classes, subjects }) {
  const toast = useToast();
  const { can } = useApp();
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', class_id: '', subject_id: '', type: 'document', file_url: '', external_url: '', visible_to: 'students' });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = () => { get('/homework/materials').then((res) => setItems(res.items || [])).catch(() => setItems([])); };
  useEffect(load, []);

  const save = async () => {
    setBusy(true);
    try {
      await post('/homework/materials', { ...form, class_id: form.class_id || null, subject_id: form.subject_id || null });
      toast.success('Material added');
      setOpen(false);
      setForm({ title: '', description: '', class_id: '', subject_id: '', type: 'document', file_url: '', external_url: '', visible_to: 'students' });
      load();
    } catch (err) {
      toast.error('Could not add material', err.message);
    } finally {
      setBusy(false);
    }
  };

  const uploadFile = async (file) => {
    setUploading(true);
    try {
      const res = await upload('/uploads', file, { bucket: 'materials' });
      setForm((prev) => ({ ...prev, file_url: res.url }));
      if (!form.title) setForm((prev) => ({ ...prev, title: file.name.replace(/\.[^.]+$/, '') }));
    } catch (err) {
      toast.error('Upload failed', err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <div className="row-between mb-2">
        <span className="fs-13 muted">Shared notes, worksheets and reference links.</span>
        {can('homework.materials') ? <Button size="sm" variant="primary" icon="plus" onClick={() => setOpen(true)}>Add material</Button> : null}
      </div>
      {!items ? <Loading /> : items.length === 0 ? <EmptyState icon="materials" title="No study materials" text="Upload notes or paste a link for students to access." /> : (
        <div className="grid grid-3">
          {items.map((m) => (
            <div key={m.id} className="card card-pad">
              <div className="row-between">
                <Badge tone="accent">{m.type || 'document'}</Badge>
                <span className="fs-12 muted">{formatDate(m.created_at)}</span>
              </div>
              <div className="strong mt-1">{m.title}</div>
              <div className="fs-12 muted">{m.class_name || 'All classes'} {m.section_name || ''} · {m.subject_name || 'General'}</div>
              {m.description ? <p className="fs-13 ink-2" style={{ margin: '6px 0' }}>{m.description}</p> : null}
              <div className="row gap-1 mt-1">
                {m.file_url ? <a className="btn btn-sm btn-outline" href={assetUrl(m.file_url)} target="_blank" rel="noreferrer"><Icon name="download" size={14} /> Open</a> : null}
                {m.external_url ? <a className="btn btn-sm btn-ghost" href={m.external_url} target="_blank" rel="noreferrer"><Icon name="link" size={14} /> Link</a> : null}
                {can('homework.materials') ? (
                  <Button size="sm" variant="ghost" icon="trash" aria-label="Delete" onClick={async () => { try { await del(`/homework/materials/${m.id}`); toast.success('Material deleted'); load(); } catch (err) { toast.error('Could not delete', err.message); } }} />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add study material" size="sm" busy={busy}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!form.title || (!form.file_url && !form.external_url)}>Save</Button></>}>
        <Input label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <div className="field-row">
          <Select label="Class" placeholder="All classes" options={classes.map((c) => ({ value: c.id, label: c.name }))} value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })} />
          <Select label="Subject" placeholder="General" options={subjects.map((s) => ({ value: s.id, label: s.name }))} value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })} />
        </div>
        <Select label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} options={['document', 'link', 'video', 'notes', 'worksheet'].map((t) => ({ value: t, label: t }))} />
        <FileDrop onFile={uploadFile} uploading={uploading} currentUrl={form.file_url} label="Upload a file (optional)" />
        <Input label="External link" placeholder="https://…" value={form.external_url} onChange={(e) => setForm({ ...form, external_url: e.target.value })} />
        <Textarea label="Description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Modal>
    </>
  );
}

function SubmissionsModal({ assignment, onClose }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [marks, setMarks] = useState({});

  useEffect(() => {
    if (!assignment) return;
    get(`/homework/assignments/${assignment.id}`).then((res) => {
      setData(res);
      const next = {};
      (res.submissions || []).forEach((s) => { next[s.id] = s.marks ?? ''; });
      setMarks(next);
    }).catch((err) => toast.error('Could not load submissions', err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment]);

  const grade = async (submission) => {
    try {
      await post(`/homework/submissions/${submission.id}/grade`, { marks: Number(marks[submission.id]), feedback: '' });
      toast.success('Submission graded');
    } catch (err) {
      toast.error('Could not grade', err.message);
    }
  };

  return (
    <Modal open={!!assignment} onClose={onClose} title={assignment?.title || 'Submissions'} subtitle={assignment ? `${assignment.class_name} · due ${formatDate(assignment.due_date)}` : ''} size="lg"
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      {!data ? <Loading /> : (data.submissions || []).length === 0 ? <EmptyState icon="homework" title="No submissions yet" /> : (
        <div className="stack-sm">
          {data.submissions.map((s) => (
            <div key={s.id} className="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <div>
                <div className="strong fs-13">{s.full_name}</div>
                <div className="fs-12 muted">{s.submitted_at ? `Submitted ${formatDate(s.submitted_at)}` : 'Not submitted'} {s.file_url ? '· file attached' : ''}</div>
              </div>
              <div className="row gap-1">
                <input className="input" style={{ width: 80, textAlign: 'right' }} type="number" max={assignment?.max_marks} value={marks[s.id] ?? ''} onChange={(e) => setMarks({ ...marks, [s.id]: e.target.value })} placeholder={`/${assignment?.max_marks}`} />
                <Button size="sm" variant="outline" onClick={() => grade(s)}>Save</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default function Homework() {
  const { can } = useApp();
  const toast = useToast();
  const { classes, subjects } = useAcademic();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'assignments';
  const setTab = (value) => { const next = new URLSearchParams(params); next.set('tab', value); setParams(next, { replace: true }); };
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const [status, setStatus] = useState('');
  const [classId, setClassId] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submissionsFor, setSubmissionsFor] = useState(null);
  const limit = 20;

  const load = async () => {
    setLoading(true);
    try { setData(await get('/homework/assignments', { q: debounced, status, classId, page, limit })); } catch (err) { toast.error('Could not load assignments', err.message); } finally { setLoading(false); }
  };
  useEffect(() => { if (tab === 'assignments') load(); /* eslint-disable-next-line */ }, [debounced, status, classId, page, tab]);
  useEffect(() => { setPage(1); }, [debounced, status, classId]);

  return (
    <div className="page">
      <PageHeader
        title="Homework & learning"
        subtitle="Assignments, submissions, grading and shared study materials."
        actions={can('homework.create') ? <Button variant="primary" icon="plus" onClick={() => { setEditing(null); setModalOpen(true); }}>New assignment</Button> : null}
      />
      <Card flush>
        <div style={{ padding: '0 14px' }}>
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'assignments', label: 'Assignments' }, { value: 'materials', label: 'Study materials' }]} />
        </div>
        <div style={{ padding: 16 }}>
          {tab === 'assignments' ? (
            <>
              <div className="row row-wrap gap-1 mb-2">
                <SearchField value={q} onChange={setQ} placeholder="Search assignments…" />
                <select className="select" style={{ width: 'auto' }} value={classId} onChange={(e) => setClassId(e.target.value)}>
                  <option value="">All classes</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select className="select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">All statuses</option>
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                  <option value="closed">Closed</option>
                </select>
                <span className="grow" />
                <span className="fs-12 muted">{data?.total || 0} assignments</span>
              </div>
              <DataTable
                loading={loading}
                rows={data?.items || []}
                columns={[
                  { key: 'title', header: 'Assignment', render: (r) => (<div><div className="strong">{r.title}</div><div className="fs-12 muted">{r.class_name}{r.section_name ? ` · ${r.section_name}` : ''} · {r.subject_name || 'General'}</div></div>) },
                  { key: 'teacher_name', header: 'Teacher', render: (r) => r.teacher_name || '—' },
                  { key: 'due_date', header: 'Due', render: (r) => formatDate(r.due_date) },
                  {
                    key: 'submissions',
                    header: 'Submissions',
                    render: (r) => (
                      <div style={{ minWidth: 120 }}>
                        <div className="row-between fs-12 muted mb-0"><span>{r.submissions}/{r.class_strength}</span><span>{r.class_strength ? Math.round((r.submissions / r.class_strength) * 100) : 0}%</span></div>
                        <Progress small value={r.submissions} max={r.class_strength || 1} />
                      </div>
                    ),
                  },
                  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                  {
                    key: 'actions',
                    header: '',
                    align: 'actions',
                    render: (r) => (
                      <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                        <Button size="sm" variant="outline" onClick={() => setSubmissionsFor(r)}>Submissions</Button>
                        {can('homework.edit') ? <Button size="sm" variant="ghost" icon="edit" onClick={() => { setEditing(r); setModalOpen(true); }} aria-label="Edit" /> : null}
                        {can('homework.edit') ? <Button size="sm" variant="ghost" icon="trash" aria-label="Delete" onClick={async () => { if (!window.confirm(`Delete "${r.title}"?`)) return; try { await del(`/homework/assignments/${r.id}`); toast.success('Assignment deleted'); load(); } catch (err) { toast.error('Could not delete', err.message); } }} /> : null}
                      </div>
                    ),
                  },
                ]}
                emptyTitle="No assignments"
                emptyText="Create an assignment for a class to get started."
                footer={<Pagination page={page} pageCount={data?.pages || 1} total={data?.total || 0} pageSize={limit} onChange={setPage} />}
              />
            </>
          ) : <MaterialsTab classes={classes} subjects={subjects} />}
        </div>
      </Card>

      <AssignmentModal open={modalOpen} initial={editing} onClose={() => { setModalOpen(false); setEditing(null); }} onDone={load} />
      <SubmissionsModal assignment={submissionsFor} onClose={() => setSubmissionsFor(null)} />
    </div>
  );
}
