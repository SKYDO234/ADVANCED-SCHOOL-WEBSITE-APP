import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, downloadFile, get, post, upload, useDebounced } from '../api.js';
import { useApp } from '../store.jsx';
import { useAcademic } from '../lib/academic.js';
import {
  Alert, Avatar, Badge, Button, Card, DataTable, EmptyState, FileDrop, Field, Input, Modal, PageHeader, Pagination,
  SearchField, Select, StatusBadge, Textarea, formatDate, formatMoney, useToast,
} from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';

const emptyForm = {
  full_name: '', admission_no: '', roll_no: '', class_id: '', section_id: '', gender: '', dob: '',
  father_name: '', mother_name: '', guardian_name: '', guardian_relation: '', phone: '', email: '',
  address: '', city: '', pincode: '', admission_date: new Date().toISOString().slice(0, 10),
  category: '', emergency_contact: '', previous_school: '', notes: '', createLogin: false, parentEmail: '', parentName: '',
};

export function StudentForm({ open, onClose, onSaved, initial }) {
  const toast = useToast();
  const { classes, sectionOptions } = useAcademic();
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError('');
    setForm(initial ? { ...emptyForm, ...initial } : emptyForm);
  }, [open, initial]);

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const submit = async (e) => {
    e?.preventDefault();
    if (!form.full_name.trim()) return setError('Student name is required');
    setBusy(true);
    setError('');
    try {
      const payload = {
        ...form,
        class_id: form.class_id || null,
        section_id: form.section_id || null,
      };
      delete payload.confirm;
      const saved = initial?.id ? await api(`/students/${initial.id}`, { method: 'PATCH', body: payload }) : await post('/students', payload);
      toast.success(initial?.id ? 'Student updated' : 'Student admitted', `${form.full_name} · ${saved.admission_no || ''}`);
      if (saved.credentials) setResult(saved.credentials);
      onSaved?.(saved);
      if (!saved.credentials) onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <Modal open={open} onClose={() => { setResult(null); onClose(); }} title="Parent login created" size="sm" footer={<Button variant="primary" onClick={() => { setResult(null); onClose(); }}>Done</Button>}>
        <Alert tone="success" title="Share these credentials with the family">
          <div className="mt-2 stack-sm">
            <div className="row-between"><span>Email</span><strong>{result.email}</strong></div>
            <div className="row-between"><span>Temporary password</span><strong>{result.password}</strong></div>
          </div>
        </Alert>
        <p className="fs-12 muted mt-2">The parent can change this password after signing in to the portal.</p>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial?.id ? 'Edit student' : 'Admit a new student'}
      subtitle={initial?.id ? initial.full_name : 'Admission numbers and roll numbers are generated automatically when left blank.'}
      size="lg"
      busy={busy}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit} icon="check">{initial?.id ? 'Save changes' : 'Admit student'}</Button>
        </>
      )}
    >
      <form onSubmit={submit}>
        {error ? <div className="mb-2"><Alert tone="danger">{error}</Alert></div> : null}
        <h4 className="mb-2">Student details</h4>
        <div className="field-row">
          <Input label="Full name" required value={form.full_name} onChange={(e) => set({ full_name: e.target.value })} />
          <Input label="Admission no." placeholder="Auto" value={form.admission_no} onChange={(e) => set({ admission_no: e.target.value })} />
          <Input label="Roll no." placeholder="Auto" value={form.roll_no} onChange={(e) => set({ roll_no: e.target.value })} />
        </div>
        <div className="field-row">
          <Select label="Class" placeholder="Select class" options={classes.map((c) => ({ value: c.id, label: c.name }))} value={form.class_id} onChange={(e) => set({ class_id: e.target.value, section_id: '' })} />
          <Select label="Section" placeholder="Select section" options={sectionOptions(form.class_id)} value={form.section_id} onChange={(e) => set({ section_id: e.target.value })} disabled={!form.class_id} />
          <Input label="Date of birth" type="date" value={form.dob} onChange={(e) => set({ dob: e.target.value })} />
          <Select label="Gender" placeholder="Select" options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }]} value={form.gender} onChange={(e) => set({ gender: e.target.value })} />
        </div>
        <div className="field-row">
          <Input label="Admission date" type="date" value={form.admission_date} onChange={(e) => set({ admission_date: e.target.value })} />
          <Input label="Category" placeholder="General / OBC / SC / ST" value={form.category} onChange={(e) => set({ category: e.target.value })} />
        </div>

        <h4 className="mb-2 mt-2">Family & contact</h4>
        <div className="field-row">
          <Input label="Father's name" value={form.father_name} onChange={(e) => set({ father_name: e.target.value })} />
          <Input label="Mother's name" value={form.mother_name} onChange={(e) => set({ mother_name: e.target.value })} />
          <Input label="Guardian name" value={form.guardian_name} onChange={(e) => set({ guardian_name: e.target.value })} />
        </div>
        <div className="field-row">
          <Input label="Phone" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
          <Input label="Email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
          <Input label="Emergency contact" value={form.emergency_contact} onChange={(e) => set({ emergency_contact: e.target.value })} />
        </div>
        <Input label="Address" value={form.address} onChange={(e) => set({ address: e.target.value })} />
        <div className="field-row">
          <Input label="City" value={form.city} onChange={(e) => set({ city: e.target.value })} />
          <Input label="PIN code" value={form.pincode} onChange={(e) => set({ pincode: e.target.value })} />
          <Input label="Previous school" value={form.previous_school} onChange={(e) => set({ previous_school: e.target.value })} />
        </div>
        <Textarea label="Notes" rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />

        {!initial?.id ? (
          <>
            <h4 className="mb-2 mt-2">Parent portal access</h4>
            <div className="field-row">
              <Input label="Parent email" type="email" placeholder="parent@example.com" value={form.parentEmail} onChange={(e) => set({ parentEmail: e.target.value })} hint="A parent login is created if this email is new." />
              <Input label="Parent name" value={form.parentName} onChange={(e) => set({ parentName: e.target.value })} />
            </div>
          </>
        ) : null}
      </form>
    </Modal>
  );
}

function ImportModal({ open, onClose, onDone }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setFile(null); setPreview(null); setResult(null); } }, [open]);

  const run = async (dryRun) => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await upload('/students/import', file, dryRun ? { dryRun: 1 } : {});
      if (dryRun) {
        setPreview(res);
      } else {
        setResult(res);
        toast.success('Import finished', `${res.created} students created`);
        onDone?.();
      }
    } catch (err) {
      toast.error('Import failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bulk import students"
      subtitle="Upload a CSV exported from another system or built from our template."
      size="lg"
      busy={busy}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
          <Button variant="outline" loading={busy} disabled={!file} onClick={() => run(true)}>Validate</Button>
          <Button variant="primary" loading={busy} disabled={!file || !preview} onClick={() => run(false)}>Import {preview?.created ?? ''} students</Button>
        </>
      )}
    >
      <div className="row-between mb-2">
        <span className="fs-13 muted">Columns: name, class, section, guardian, phone, email and more.</span>
        <Button size="sm" variant="ghost" icon="download" onClick={() => downloadFile('/students/import/template', null, 'student-import-template.csv')}>Template</Button>
      </div>
      <FileDrop onFile={setFile} accept=".csv,text/csv" label={file ? file.name : 'Click or drop a CSV file'} uploading={busy && !preview} />
      {preview ? (
        <div className="mt-3">
          <Alert tone={preview.errors?.length ? 'warning' : 'success'} title={`${preview.created || 0} rows ready to import`}>
            {preview.errors?.length ? `${preview.errors.length} row(s) have problems and will be skipped.` : 'All rows look valid.'}
          </Alert>
          {preview.errors?.length ? (
            <div className="scroll-x mt-2">
              <table className="data compact">
                <thead><tr><th>Row</th><th>Problem</th></tr></thead>
                <tbody>{preview.errors.slice(0, 12).map((e, i) => <tr key={i}><td>{e.row}</td><td>{e.message}</td></tr>)}</tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
      {result ? (
        <div className="mt-3">
          <Alert tone="success" title={`${result.created} students imported`}>
            {result.credentials?.length ? `${result.credentials.length} parent logins created — credentials are listed below.` : 'No new parent logins were created.'}
          </Alert>
          {result.credentials?.length ? (
            <div className="scroll-x mt-2">
              <table className="data compact">
                <thead><tr><th>Email</th><th>Password</th></tr></thead>
                <tbody>{result.credentials.map((c, i) => <tr key={i}><td>{c.email}</td><td>{c.password}</td></tr>)}</tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

export default function Students() {
  const { can, school } = useApp();
  const { classes, sectionsFor, classLabel } = useAcademic();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const debounced = useDebounced(q);
  const [classId, setClassId] = useState(params.get('classId') || '');
  const [sectionId, setSectionId] = useState(params.get('sectionId') || '');
  const [status, setStatus] = useState(params.get('status') || 'active');
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(params.get('new') === '1');
  const [importOpen, setImportOpen] = useState(false);
  const currency = school?.currency_symbol || '₹';

  const load = async (silent) => {
    if (!silent) setLoading(true);
    try {
      const data = await get('/students', { q: debounced, classId, sectionId, status, page, limit });
      setRows(data.items);
      setMeta({ total: data.total, pages: data.pages });
    } catch (err) {
      toast.error('Could not load students', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [debounced, classId, sectionId, status, page]);
  useEffect(() => { setPage(1); }, [debounced, classId, sectionId, status]);

  const filters = useMemo(() => ({ q: debounced, classId, sectionId, status }), [debounced, classId, sectionId, status]);

  const openNew = () => {
    setOpen(true);
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
  };

  return (
    <div className="page">
      <PageHeader
        title="Students"
        subtitle={`${meta.total.toLocaleString('en-IN')} student records${status === 'active' ? ' · active only' : ''}`}
        actions={(
          <>
            {can('students.export') ? <Button variant="outline" icon="download" onClick={() => downloadFile('/students/export', filters, 'students.csv')}>Export</Button> : null}
            {can('students.import') ? <Button variant="outline" icon="upload" onClick={() => setImportOpen(true)}>Import</Button> : null}
            {can('students.create') ? <Button variant="primary" icon="plus" onClick={openNew}>Admit student</Button> : null}
          </>
        )}
      />

      <Card flush>
        <div className="row row-wrap gap-1" style={{ padding: 14, borderBottom: '1px solid var(--line)' }}>
          <SearchField value={q} onChange={setQ} placeholder="Search name, admission no., phone…" />
          <select className="select" style={{ width: 'auto' }} value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }}>
            <option value="">All classes</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!classId}>
            <option value="">All sections</option>
            {sectionsFor(classId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Active</option>
            <option value="all">All statuses</option>
            <option value="withdrawn">Withdrawn</option>
            <option value="alumni">Alumni</option>
            <option value="suspended">Suspended</option>
          </select>
          <span className="grow" />
          <span className="fs-12 muted">{meta.total.toLocaleString('en-IN')} found</span>
        </div>

        <DataTable
          loading={loading}
          rows={rows}
          columns={[
            {
              key: 'full_name',
              header: 'Student',
              render: (r) => (
                <Link to={`/app/students/${r.id}`} className="person" style={{ textDecoration: 'none' }}>
                  <Avatar name={r.full_name} src={r.photo_url} size="sm" />
                  <div className="person-meta">
                    <div className="person-name">{r.full_name}</div>
                    <div className="person-sub">Adm. {r.admission_no}{r.roll_no ? ` · Roll ${r.roll_no}` : ''}</div>
                  </div>
                </Link>
              ),
            },
            { key: 'class', header: 'Class', render: (r) => <span className="nowrap">{classLabel(r.class_id, r.section_id) || <span className="muted">Unassigned</span>}</span> },
            { key: 'parent_names', header: 'Guardian', render: (r) => (<div><div className="fs-13">{r.parent_names || r.father_name || r.guardian_name || '—'}</div><div className="fs-12 muted">{r.phone || r.parent_emails || ''}</div></div>) },
            {
              key: 'fees',
              header: 'Fee balance',
              align: 'num',
              render: (r) => (Number(r.fees?.due) > 0
                ? <Badge tone="warning">{formatMoney(r.fees.due, currency)}</Badge>
                : <Badge tone="success">Clear</Badge>),
            },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'actions',
              header: '',
              align: 'actions',
              render: (r) => (
                <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                  <Button size="sm" variant="ghost" icon="eye" onClick={() => navigate(`/app/students/${r.id}`)} aria-label="View">View</Button>
                </div>
              ),
            },
          ]}
          emptyTitle="No students found"
          emptyText="Adjust the filters, or admit your first student."
          emptyIcon="students"
          footer={<Pagination page={page} pageCount={meta.pages} total={meta.total} pageSize={limit} onChange={setPage} />}
        />
      </Card>

      <StudentForm open={open} onClose={() => setOpen(false)} onSaved={() => load(true)} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={() => load(true)} />
    </div>
  );
}
