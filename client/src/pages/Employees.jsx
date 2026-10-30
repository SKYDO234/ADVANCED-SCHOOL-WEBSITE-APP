import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { downloadFile, get, patch, post, useDebounced } from '../api.js';
import { useApp } from '../store.jsx';
import {
  Alert, Avatar, Badge, Button, Card, DataTable, Drawer, EmptyState, Input, Loading, Modal, PageHeader, Pagination,
  SearchField, Select, StatusBadge, Tabs, Textarea, formatDate, formatDateTime, formatMoney, useToast,
} from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';

const DEPARTMENTS = ['academics', 'accounts', 'administration', 'library', 'transport', 'hostel', 'it', 'sports', 'maintenance'];
const emptyForm = {
  full_name: '', email: '', phone: '', role: 'teacher', department: 'academics', designation: '',
  employee_code: '', employment_type: 'full_time', joining_date: new Date().toISOString().slice(0, 10),
  qualification: '', specialization: '', salary_amount: '', address: '', emergency_contact: '', dob: '', gender: '', password: '',
};

function EmployeeModal({ open, onClose, onDone, initial }) {
  const toast = useToast();
  const { can } = useApp();
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [credentials, setCredentials] = useState(null);

  useEffect(() => {
    if (!open) return;
    setError('');
    setCredentials(null);
    setForm(initial ? { ...emptyForm, ...initial, salary_amount: initial.salary_amount ?? '', password: '' } : emptyForm);
  }, [open, initial]);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (initial?.id) {
        const payload = { ...form };
        delete payload.email;
        delete payload.password;
        await patch(`/employees/${initial.id}`, payload);
        toast.success('Employee updated');
        onDone?.();
        onClose();
      } else {
        const res = await post('/employees', form);
        toast.success('Employee added');
        setCredentials(res.credentials);
        onDone?.();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (credentials) {
    return (
      <Modal open={open} onClose={() => { setCredentials(null); onClose(); }} title="Employee login created" size="sm"
        footer={<Button variant="primary" onClick={() => { setCredentials(null); onClose(); }}>Done</Button>}>
        <Alert tone="success" title="Share these credentials">
          <div className="stack-sm mt-2">
            <div className="row-between"><span>Email</span><strong>{credentials.email}</strong></div>
            <div className="row-between"><span>Temporary password</span><strong>{credentials.password}</strong></div>
          </div>
        </Alert>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit employee' : 'Add a teacher or staff member'}
      subtitle={initial ? initial.full_name : 'A login is created automatically with a temporary password.'}
      size="lg"
      busy={busy}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save} disabled={!form.full_name || (!initial && !form.email)}>{initial ? 'Save changes' : 'Add employee'}</Button>
        </>
      )}
    >
      {error ? <div className="mb-2"><Alert tone="danger">{error}</Alert></div> : null}
      <div className="field-row">
        <Input label="Full name" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        <Input label="Email" type="email" required disabled={Boolean(initial)} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} hint={initial ? 'Email cannot be changed here' : undefined} />
        <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </div>
      <div className="field-row">
        <Select label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} options={[{ value: 'teacher', label: 'Teacher' }, { value: 'staff', label: 'Staff' }, ...(can('settings.users') ? [{ value: 'principal', label: 'Principal' }] : [])]} />
        <Select label="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} options={DEPARTMENTS.map((d) => ({ value: d, label: d.replace(/^\w/, (c) => c.toUpperCase()) }))} />
        <Input label="Designation" placeholder="Senior English Teacher" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
      </div>
      <div className="field-row">
        <Input label="Employee code" placeholder="Auto" value={form.employee_code} onChange={(e) => setForm({ ...form, employee_code: e.target.value })} />
        <Select label="Employment type" value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value })} options={[{ value: 'full_time', label: 'Full time' }, { value: 'part_time', label: 'Part time' }, { value: 'contract', label: 'Contract' }, { value: 'visiting', label: 'Visiting' }]} />
        <Input label="Joining date" type="date" value={form.joining_date} onChange={(e) => setForm({ ...form, joining_date: e.target.value })} />
      </div>
      <div className="field-row">
        <Input label="Qualification" value={form.qualification} onChange={(e) => setForm({ ...form, qualification: e.target.value })} />
        <Input label="Specialisation" value={form.specialization} onChange={(e) => setForm({ ...form, specialization: e.target.value })} />
        <Input label="Monthly salary" type="number" value={form.salary_amount} onChange={(e) => setForm({ ...form, salary_amount: e.target.value })} />
      </div>
      <div className="field-row">
        <Input label="Date of birth" type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
        <Select label="Gender" placeholder="Select" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }]} />
        <Input label="Emergency contact" value={form.emergency_contact} onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })} />
      </div>
      <Textarea label="Address" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      {!initial ? <Input label="Initial password" placeholder="Leave blank to auto-generate" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /> : null}
    </Modal>
  );
}

function EmployeeDrawer({ id, onClose, onEdit, reload }) {
  const { school } = useApp();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('overview');
  const currency = school?.currency_symbol || '₹';

  useEffect(() => {
    if (!id) return;
    get(`/employees/${id}`).then(setData).catch((err) => toast.error('Could not load employee', err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const decide = async (leave, decision) => {
    try {
      await post(`/employees/leave/requests/${leave.id}/decision`, { decision, note: '' });
      toast.success(`Leave ${decision}`);
      const fresh = await get(`/employees/${id}`);
      setData(fresh);
      reload?.(true);
    } catch (err) {
      toast.error('Could not update leave', err.message);
    }
  };

  return (
    <Drawer open={!!id} onClose={onClose} title={data?.full_name || 'Employee'} subtitle={data ? `${data.designation || data.role} · ${data.department || ''}` : ''}
      footer={data ? (<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" icon="edit" onClick={() => onEdit(data)}>Edit employee</Button></>) : null}>
      {!data ? <Loading /> : (
        <>
          <div className="row gap-2 mb-2">
            <Avatar name={data.full_name} src={data.avatar_url} size="lg" />
            <div>
              <div className="strong">{data.full_name}</div>
              <div className="fs-13 muted">{data.email} · {data.phone || '—'}</div>
              <div className="row gap-1 mt-1"><Badge tone="outline">{data.employee_code}</Badge><StatusBadge status={data.status} /></div>
            </div>
          </div>
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'overview', label: 'Profile' }, { value: 'leave', label: 'Leave', count: data.leave?.length }, { value: 'payroll', label: 'Payroll' }]} />
          <div className="mt-2">
            {tab === 'overview' ? (
              <div className="stack-sm fs-13">
                <div className="row-between"><span className="muted">Role</span><span style={{ textTransform: 'capitalize' }}>{data.role}</span></div>
                <div className="row-between"><span className="muted">Employment</span><span>{String(data.employment_type || '').replace(/_/g, ' ')}</span></div>
                <div className="row-between"><span className="muted">Joined</span><span>{formatDate(data.joining_date)}</span></div>
                <div className="row-between"><span className="muted">Qualification</span><span>{data.qualification || '—'}</span></div>
                <div className="row-between"><span className="muted">Salary</span><span>{formatMoney(data.salary_amount, currency)}</span></div>
                <div className="row-between"><span className="muted">Attendance</span><span>{data.attendance?.percentage ?? 0}%</span></div>
                <div className="divider" />
                <div className="strong">Subjects taught</div>
                {(data.assignments || []).length === 0 ? <span className="muted">No subject assignments</span> : data.assignments.map((a) => (
                  <div key={a.id} className="row-between"><span>{a.subject_name} · {a.class_name} {a.section_name || ''}</span><span className="muted">{a.periods_week}/week</span></div>
                ))}
              </div>
            ) : null}
            {tab === 'leave' ? (
              (data.leave || []).length === 0 ? <EmptyState icon="calendar" title="No leave requests" /> : (
                <div className="stack-sm">
                  {data.leave.map((l) => (
                    <div key={l.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                      <div className="row-between">
                        <span className="strong fs-13">{formatDate(l.from_date)} → {formatDate(l.to_date)}</span>
                        <StatusBadge status={l.status} />
                      </div>
                      <div className="fs-12 muted">{l.leave_type} · {l.reason || ''}</div>
                      {l.status === 'pending' ? (
                        <div className="row gap-1 mt-1">
                          <Button size="sm" variant="success" onClick={() => decide(l, 'approved')}>Approve</Button>
                          <Button size="sm" variant="soft-danger" onClick={() => decide(l, 'rejected')}>Reject</Button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )
            ) : null}
            {tab === 'payroll' ? (
              (data.payroll || []).length === 0 ? <EmptyState icon="money" title="No payroll records" /> : (
                <div className="stack-sm">
                  {data.payroll.map((p) => (
                    <div key={p.id} className="row-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                      <div>
                        <div className="fs-13 strong">{p.period || `${p.month}/${p.year}`}</div>
                        <div className="fs-12 muted">{p.status || 'pending'}</div>
                      </div>
                      <span className="tnum">{formatMoney(p.net_amount ?? p.amount, currency)}</span>
                    </div>
                  ))}
                </div>
              )
            ) : null}
          </div>
        </>
      )}
    </Drawer>
  );
}

export default function Employees() {
  const { can } = useApp();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'staff';
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const [department, setDepartment] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [leave, setLeave] = useState(null);
  const limit = 25;

  const load = async () => {
    setLoading(true);
    try {
      setData(await get('/employees', { q: debounced, department, role, page, limit }));
    } catch (err) {
      toast.error('Could not load employees', err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [debounced, department, role, page]);

  const loadLeave = async () => {
    try { setLeave(await get('/employees/leave/requests')); } catch { setLeave({ items: [] }); }
  };
  useEffect(() => { if (tab === 'leave') loadLeave(); }, [tab]);

  const setTab = (value) => { const next = new URLSearchParams(params); next.set('tab', value); setParams(next, { replace: true }); };

  const decide = async (item, decision) => {
    try {
      await post(`/employees/leave/requests/${item.id}/decision`, { decision, note: '' });
      toast.success(`Leave ${decision}`);
      loadLeave();
    } catch (err) {
      toast.error('Could not update leave', err.message);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Teachers & staff"
        subtitle="Employee records, subject assignments, leave and payroll."
        actions={(
          <>
            {can('employees.export') ? <Button variant="outline" icon="download" onClick={() => downloadFile('/employees/export', null, 'employees.csv')}>Export</Button> : null}
            {can('employees.create') ? <Button variant="primary" icon="plus" onClick={() => { setEditing(null); setModalOpen(true); }}>Add employee</Button> : null}
          </>
        )}
      />

      <Card flush>
        <div style={{ padding: '0 14px' }}>
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'staff', label: 'Employees' }, { value: 'leave', label: 'Leave requests' }]} />
        </div>
        <div style={{ padding: 16 }}>
          {tab === 'staff' ? (
            <>
              <div className="row row-wrap gap-1 mb-2">
                <SearchField value={q} onChange={setQ} placeholder="Name, email, code…" />
                <select className="select" style={{ width: 'auto' }} value={department} onChange={(e) => setDepartment(e.target.value)}>
                  <option value="">All departments</option>
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <select className="select" style={{ width: 'auto' }} value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="">All roles</option>
                  <option value="teacher">Teachers</option>
                  <option value="staff">Staff</option>
                  <option value="principal">Principal</option>
                </select>
                <span className="grow" />
                <span className="fs-12 muted">{data?.total || 0} employees</span>
              </div>
              <DataTable
                loading={loading}
                rows={data?.items || []}
                columns={[
                  { key: 'full_name', header: 'Employee', render: (r) => (<button type="button" className="person" style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => setDetailId(r.id)}><Avatar name={r.full_name} src={r.avatar_url} size="sm" /><div className="person-meta"><div className="person-name">{r.full_name}</div><div className="person-sub">{r.employee_code} · {r.email}</div></div></button>) },
                  { key: 'designation', header: 'Designation', render: (r) => (<div><div>{r.designation || '—'}</div><div className="fs-12 muted" style={{ textTransform: 'capitalize' }}>{r.department}</div></div>) },
                  { key: 'role', header: 'Role', render: (r) => <Badge tone={r.role === 'teacher' ? 'accent' : 'outline'}>{r.role}</Badge> },
                  { key: 'subject_count', header: 'Subjects', align: 'num' },
                  { key: 'joining_date', header: 'Joined', render: (r) => formatDate(r.joining_date) },
                  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                  {
                    key: 'actions',
                    header: '',
                    align: 'actions',
                    render: (r) => (
                      <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                        <Button size="sm" variant="ghost" icon="eye" onClick={() => setDetailId(r.id)} aria-label="View" />
                        {can('employees.edit') ? <Button size="sm" variant="ghost" icon="edit" onClick={() => { setEditing(r); setModalOpen(true); }} aria-label="Edit" /> : null}
                      </div>
                    ),
                  },
                ]}
                emptyTitle="No employees found"
                emptyText="Add teachers and staff to build timetables and payroll."
                footer={<Pagination page={page} pageCount={data?.pages || 1} total={data?.total || 0} pageSize={limit} onChange={setPage} />}
              />
            </>
          ) : null}

          {tab === 'leave' ? (
            !leave ? <Loading /> : (leave.items || []).length === 0 ? <EmptyState icon="calendar" title="No leave requests" text="Staff leave applications will appear here for approval." /> : (
              <DataTable
                rows={leave.items}
                columns={[
                  { key: 'employee_name', header: 'Employee', render: (r) => <div><div className="strong">{r.employee_name || r.full_name || '—'}</div><div className="fs-12 muted">{r.department || ''}</div></div> },
                  { key: 'leave_type', header: 'Type', render: (r) => <Badge tone="outline">{String(r.leave_type || 'leave').replace(/_/g, ' ')}</Badge> },
                  { key: 'from_date', header: 'From', render: (r) => formatDate(r.from_date) },
                  { key: 'to_date', header: 'To', render: (r) => formatDate(r.to_date) },
                  { key: 'reason', header: 'Reason', render: (r) => <span className="truncate" style={{ maxWidth: 240, display: 'inline-block' }}>{r.reason || '—'}</span> },
                  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                  {
                    key: 'actions',
                    header: '',
                    align: 'actions',
                    render: (r) => (r.status === 'pending' && can('payroll.approve_leave') ? (
                      <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                        <Button size="sm" variant="success" onClick={() => decide(r, 'approved')}>Approve</Button>
                        <Button size="sm" variant="soft-danger" onClick={() => decide(r, 'rejected')}>Reject</Button>
                      </div>
                    ) : null),
                  },
                ]}
                emptyTitle="No leave requests"
              />
            )
          ) : null}
        </div>
      </Card>

      <EmployeeModal open={modalOpen} initial={editing} onClose={() => { setModalOpen(false); setEditing(null); }} onDone={load} />
      <EmployeeDrawer id={detailId} onClose={() => setDetailId(null)} onEdit={(emp) => { setDetailId(null); setEditing(emp); setModalOpen(true); }} reload={load} />
    </div>
  );
}
