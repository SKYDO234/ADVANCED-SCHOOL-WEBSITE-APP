import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, assetUrl, del, get, openFile, post, upload } from '../api.js';
import { useApp } from '../store.jsx';
import { useAcademic } from '../lib/academic.js';
import {
  Alert, Avatar, Badge, Button, Card, DataTable, EmptyState, FileDrop, Input, KeyValue, Loading, Modal,
  PageHeader, Progress, StatusBadge, Tabs, formatDate, formatDateTime, formatMoney, useToast,
} from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';
import { Donut } from '../ui/Charts.jsx';
import { StudentForm } from './Students.jsx';

export default function StudentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can, school, refresh } = useApp();
  const { classLabel } = useAcademic();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const [credBusy, setCredBusy] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkEmail, setLinkEmail] = useState('');
  const [linking, setLinking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const currency = school?.currency_symbol || '₹';

  const load = async () => {
    try {
      setData(await get(`/students/${id}`));
      setError(null);
    } catch (err) {
      setError(err);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (error) return <div className="page"><Alert tone="danger" title="Student not found">{error.message}</Alert><Button onClick={() => navigate('/app/students')}>Back to students</Button></div>;
  if (!data) return <div className="page"><Loading label="Loading student profile…" /></div>;

  const createLogin = async (role) => {
    setCredBusy(true);
    try {
      const res = await post(`/students/${id}/credentials`, { role, email: role === 'parent' ? undefined : data.email });
      setCredentials({ ...res, role });
    } catch (err) {
      if (err.status === 400) {
        setCredentials({ role, error: err.message });
      } else {
        toast.error('Could not create login', err.message);
      }
    } finally {
      setCredBusy(false);
    }
  };

  const resetCredentials = () => setCredentials(null);

  const linkParent = async () => {
    setLinking(true);
    try {
      const res = await post(`/students/${id}/link-parent`, { email: linkEmail });
      toast.success('Parent linked', res.temporaryPassword ? `Temporary password: ${res.temporaryPassword}` : 'Existing account linked');
      setLinkOpen(false);
      setLinkEmail('');
      await load();
    } catch (err) {
      toast.error('Could not link parent', err.message);
    } finally {
      setLinking(false);
    }
  };

  const uploadDoc = async (file) => {
    setUploading(true);
    try {
      await upload(`/students/${id}/documents`, file, null, { name: file.name, category: 'general' });
      toast.success('Document uploaded');
      await load();
    } catch (err) {
      toast.error('Upload failed', err.message);
    } finally {
      setUploading(false);
    }
  };

  const removeDoc = async (docId) => {
    try {
      await del(`/students/documents/${docId}`);
      toast.success('Document removed');
      await load();
    } catch (err) {
      toast.error('Could not remove document', err.message);
    }
  };

  const setStatus = async (status) => {
    try {
      await post(`/students/${id}/status`, { status });
      toast.success(`Student marked ${status}`);
      await load();
      await refresh();
    } catch (err) {
      toast.error('Could not update status', err.message);
    }
  };

  const due = (data.fees || []).reduce((sum, f) => sum + Number(f.due_amount || 0), 0);
  const billed = (data.fees || []).reduce((sum, f) => sum + Number(f.net_amount || 0), 0);
  const paid = (data.fees || []).reduce((sum, f) => sum + Number(f.paid_amount || 0), 0);

  const tabs = [
    { value: 'overview', label: 'Overview' },
    { value: 'attendance', label: 'Attendance' },
    { value: 'fees', label: 'Fees', count: data.invoices?.length },
    { value: 'results', label: 'Results', count: data.results?.length },
    { value: 'documents', label: 'Documents', count: data.documents?.length },
    { value: 'family', label: 'Family & access', count: data.parents?.length },
    { value: 'history', label: 'History', count: data.history?.length },
  ];

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to="/app/students">Students</Link>
        <Icon name="chevronRight" size={12} />
        <span>{data.full_name}</span>
      </div>
      <PageHeader
        title={data.full_name}
        subtitle={`${data.admission_no} · ${classLabel(data.class_id, data.section_id) || 'Unassigned'} · Admitted ${formatDate(data.admission_date)}`}
        actions={(
          <>
            {can('students.edit') ? <Button variant="outline" icon="edit" onClick={() => setEditing(true)}>Edit</Button> : null}
            {can('students.edit') ? <Button variant="outline" icon="key" loading={credBusy} onClick={() => createLogin('student')}>Student login</Button> : null}
            <Button variant="ghost" icon="print" onClick={() => window.print()}>Print</Button>
          </>
        )}
      />

      <div className="grid mb-3" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', alignItems: 'stretch', gap: 16 }}>
        <Card>
          <div className="row gap-3 row-wrap">
            <Avatar name={data.full_name} src={data.photo_url} size="xl" />
            <div className="grow">
              <div className="row gap-1 mb-1">
                <StatusBadge status={data.status} />
                {data.has_login ? <Badge tone="info">Portal login</Badge> : null}
                {due > 0 ? <Badge tone="warning">{formatMoney(due, currency)} due</Badge> : <Badge tone="success">Fees clear</Badge>}
              </div>
              <KeyValue
                columns={2}
                items={[
                  { label: 'Class', value: classLabel(data.class_id, data.section_id) || '—' },
                  { label: 'Roll number', value: data.roll_no || '—' },
                  { label: 'Date of birth', value: formatDate(data.dob) },
                  { label: 'Gender', value: data.gender || '—' },
                  { label: 'Phone', value: data.phone || '—' },
                  { label: 'Email', value: data.email || '—' },
                  { label: 'Blood group', value: data.blood_group || '—' },
                  { label: 'Category', value: data.category || '—' },
                ]}
              />
            </div>
          </div>
          {data.address ? <div className="mt-2 fs-13 ink-2"><Icon name="map" size={14} /> {data.address}{data.city ? `, ${data.city}` : ''} {data.pincode || ''}</div> : null}
        </Card>

        <Card title="Fee position" icon="fees">
          <Donut
            size={140}
            thickness={16}
            data={[
              { label: 'Paid', value: Math.round(paid), color: 'var(--success)' },
              { label: 'Due', value: Math.round(due), color: 'var(--warning)' },
            ]}
            centerValue={formatMoney(paid, currency)}
            centerLabel={`of ${formatMoney(billed, currency)}`}
          />
          <div className="mt-2">
            <Progress value={paid} max={billed || 1} label="Collected" />
          </div>
          {can('fees.collect') ? (
            <Button block variant="outline" className="mt-2" icon="fees" onClick={() => navigate(`/app/fees?tab=collect&studentId=${data.id}`)}>Collect payment</Button>
          ) : null}
        </Card>
      </div>

      <Card flush>
        <div style={{ padding: '0 14px' }}>
          <Tabs tabs={tabs} value={tab} onChange={setTab} />
        </div>

        <div style={{ padding: 18 }}>
          {tab === 'overview' ? (
            <div className="grid grid-2">
              <div>
                <h4 className="mb-2">Family</h4>
                <KeyValue
                  items={[
                    { label: 'Father', value: data.father_name || '—' },
                    { label: 'Mother', value: data.mother_name || '—' },
                    { label: 'Guardian', value: data.guardian_name ? `${data.guardian_name} (${data.guardian_relation || 'guardian'})` : '—' },
                    { label: 'Emergency contact', value: data.emergency_contact || '—' },
                  ]}
                />
                <h4 className="mb-2 mt-3">Previous school</h4>
                <p className="fs-13 ink-2 mt-0">{data.previous_school || 'Not recorded'}</p>
                {data.notes ? <><h4 className="mb-1 mt-2">Notes</h4><p className="fs-13 ink-2 prewrap">{data.notes}</p></> : null}
              </div>
              <div>
                <h4 className="mb-2">Transport</h4>
                {data.transport ? (
                  <KeyValue items={[
                    { label: 'Route', value: data.transport.route_name },
                    { label: 'Stop', value: data.transport.stop_name || '—' },
                    { label: 'Vehicle', value: data.transport.registration_no || '—' },
                    { label: 'Annual fee', value: formatMoney(data.transport.fee_amount, currency) },
                  ]} />
                ) : <p className="fs-13 muted">No transport allocation.</p>}
                <h4 className="mb-2 mt-3">Quick actions</h4>
                <div className="row row-wrap gap-1">
                  {can('students.edit') ? <Button size="sm" variant="outline" icon="userCheck" onClick={() => setLinkOpen(true)}>Link parent</Button> : null}
                  {can('students.edit') && data.status === 'active' ? <Button size="sm" variant="soft-danger" icon="close" onClick={() => setStatus('withdrawn')}>Mark withdrawn</Button> : null}
                  {can('students.edit') && data.status !== 'active' ? <Button size="sm" variant="success" icon="check" onClick={() => setStatus('active')}>Reactivate</Button> : null}
                  {can('fees.view') ? <Button size="sm" variant="ghost" icon="receipt" onClick={() => navigate(`/app/fees?tab=invoices&q=${data.admission_no}`)}>Invoices</Button> : null}
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'attendance' ? (
            <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 18 }}>
              <div className="center">
                <Donut
                  size={170}
                  thickness={20}
                  data={[
                    { label: 'Present', value: data.attendance?.present || 0, color: 'var(--success)' },
                    { label: 'Absent', value: (data.attendance?.total || 0) - (data.attendance?.present || 0), color: 'var(--danger)' },
                  ]}
                  centerValue={`${data.attendance?.percentage ?? 0}%`}
                  centerLabel="attendance"
                />
              </div>
              <div>
                <h4 className="mb-2">Status breakdown</h4>
                {(data.attendance?.breakdown || []).length === 0 ? <EmptyState icon="attendance" title="No attendance yet" /> : (
                  <div className="stack-sm">
                    {(data.attendance.breakdown || []).map((row) => (
                      <div key={row.status} className="row-between" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                        <StatusBadge status={row.status} />
                        <strong className="tnum">{row.c} day{row.c === 1 ? '' : 's'}</strong>
                      </div>
                    ))}
                  </div>
                )}
                <div className="fs-12 muted mt-2">{data.attendance?.total || 0} days recorded in total.</div>
                {can('attendance.report') ? <Button className="mt-2" size="sm" variant="outline" icon="download" onClick={() => openFile('/attendance/students/report', { classId: data.class_id, sectionId: data.section_id, format: 'pdf' })}>Download class register</Button> : null}
              </div>
            </div>
          ) : null}

          {tab === 'fees' ? (
            <>
              <div className="grid grid-4 mb-3">
                {[
                  ['Billed', formatMoney(billed, currency)],
                  ['Paid', formatMoney(paid, currency)],
                  ['Due', formatMoney(due, currency)],
                  ['Discounts', formatMoney((data.discounts || []).reduce((s, d) => s + Number(d.amount || 0), 0), currency)],
                ].map(([label, value]) => (
                  <div key={label} className="card-pad" style={{ background: 'var(--bg-subtle)', borderRadius: 10 }}>
                    <div className="fs-12 muted">{label}</div>
                    <div className="strong fs-18">{value}</div>
                  </div>
                ))}
              </div>
              <h4 className="mb-2">Invoices</h4>
              <DataTable
                rows={data.invoices || []}
                columns={[
                  { key: 'invoice_no', header: 'Invoice', render: (r) => <Link to={`/app/fees/invoices/${r.id}`} className="strong">{r.invoice_no}</Link> },
                  { key: 'period', header: 'Period' },
                  { key: 'issue_date', header: 'Issued', render: (r) => formatDate(r.issue_date) },
                  { key: 'due_date', header: 'Due', render: (r) => formatDate(r.due_date) },
                  { key: 'total', header: 'Total', align: 'num', render: (r) => formatMoney(r.total, currency) },
                  { key: 'balance', header: 'Balance', align: 'num', render: (r) => formatMoney(r.balance, currency) },
                  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                  { key: 'a', header: '', align: 'actions', render: (r) => <Button size="sm" variant="ghost" icon="download" onClick={() => openFile(`/fees/invoices/${r.id}/pdf`)} aria-label="PDF" /> },
                ]}
                emptyTitle="No invoices"
                emptyText="Fee invoices will appear here once generated."
              />
              <h4 className="mb-2 mt-3">Payments</h4>
              <DataTable
                rows={data.payments || []}
                columns={[
                  { key: 'receipt_no', header: 'Receipt' },
                  { key: 'paid_at', header: 'Date', render: (r) => formatDate(r.paid_at || r.created_at) },
                  { key: 'method', header: 'Method' },
                  { key: 'amount', header: 'Amount', align: 'num', render: (r) => formatMoney(r.amount, currency) },
                  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                  { key: 'a', header: '', align: 'actions', render: (r) => <Button size="sm" variant="ghost" icon="download" onClick={() => openFile(`/fees/payments/${r.id}/receipt`)} aria-label="Receipt" /> },
                ]}
                emptyTitle="No payments recorded"
              />
            </>
          ) : null}

          {tab === 'results' ? (
            (data.results || []).length === 0 ? <EmptyState icon="results" title="No published results" text="Publish an exam to see report cards here." /> : (
              <div className="grid grid-2">
                {data.results.map((r) => (
                  <div key={r.id} className="result-card">
                    <div className="result-head">
                      <div className="grow">
                        <div className="strong">{r.exam_name}</div>
                        <div className="fs-12 muted">{r.session_name || ''} · Rank {r.rank || '—'}</div>
                      </div>
                      <Badge tone={(Number(r.percentage) || 0) >= 33 ? 'success' : 'danger'}>{(Number(r.percentage) || 0).toFixed(1)}%</Badge>
                    </div>
                    <div className="card-body">
                      <div className="row-between mb-2">
                        <span className="fs-13 muted">Marks</span>
                        <strong>{r.total_marks ?? '—'} / {r.max_marks ?? '—'}</strong>
                      </div>
                      <div className="row-between">
                        <span className="fs-13 muted">Grade</span>
                        <strong>{r.grade || '—'}</strong>
                      </div>
                      <Button className="mt-2" block size="sm" variant="outline" icon="download" onClick={() => openFile(`/exams/results/${r.id}/report-card`)}>Report card</Button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : null}

          {tab === 'documents' ? (
            <>
              {can('students.documents', 'students.edit') ? <div className="mb-3"><FileDrop onFile={uploadDoc} uploading={uploading} label="Upload a document (PDF or image, up to 10 MB)" /></div> : null}
              {(data.documents || []).length === 0 ? <EmptyState icon="file" title="No documents" text="Birth certificates, transfers and ID proofs live here." /> : (
                <div>
                  {data.documents.map((d) => (
                    <div key={d.id} className="file-row">
                      <span className="file-icon"><Icon name="file" size={16} /></span>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="fs-13 strong truncate">{d.name || 'Document'}</div>
                        <div className="fs-12 muted">{d.category || 'general'} · {formatDate(d.created_at)} · {d.size ? `${Math.round(d.size / 1024)} KB` : ''}</div>
                      </div>
                      <a className="btn btn-sm btn-ghost" href={assetUrl(d.file_url)} target="_blank" rel="noreferrer" aria-label="Open"><Icon name="eye" /></a>
                      {can('students.documents', 'students.edit') ? <Button size="sm" variant="ghost" icon="trash" onClick={() => removeDoc(d.id)} aria-label="Delete" /> : null}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}

          {tab === 'family' ? (
            <div className="grid grid-2">
              <div>
                <div className="row-between mb-2">
                  <h4>Linked parents</h4>
                  {can('students.edit') ? <Button size="sm" variant="outline" icon="plus" onClick={() => setLinkOpen(true)}>Link parent</Button> : null}
                </div>
                {(data.parents || []).length === 0 ? <EmptyState icon="users" title="No parent accounts" text="Create a parent login so the family can access the portal." action={can('students.edit') ? <Button size="sm" variant="primary" onClick={() => createLogin('parent')}>Create parent login</Button> : null} /> : (
                  <div>
                    {data.parents.map((p) => (
                      <div key={p.id} className="file-row">
                        <Avatar name={p.full_name} size="sm" />
                        <div className="grow" style={{ minWidth: 0 }}>
                          <div className="fs-13 strong">{p.full_name} {p.is_primary ? <Badge tone="accent">primary</Badge> : null}</div>
                          <div className="fs-12 muted">{p.email} · {p.phone || '—'} · {p.relation || 'parent'}</div>
                        </div>
                        <StatusBadge status={p.status} />
                        {can('students.edit') ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon="close"
                            aria-label="Unlink"
                            onClick={async () => {
                              await del(`/students/${id}/parents/${p.id}`).catch((err) => toast.error('Could not unlink', err.message));
                              toast.success('Parent unlinked');
                              load();
                            }}
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h4 className="mb-2">Portal access</h4>
                <div className="stack-sm">
                  <div className="file-row">
                    <span className="file-icon"><Icon name="students" size={16} /></span>
                    <div className="grow">
                      <div className="fs-13 strong">Student login</div>
                      <div className="fs-12 muted">{data.has_login ? 'Active' : 'Not created yet'}</div>
                    </div>
                    {!data.has_login && can('students.edit') ? <Button size="sm" variant="outline" onClick={() => createLogin('student')}>Create</Button> : <Badge tone="success">enabled</Badge>}
                  </div>
                  <div className="file-row">
                    <span className="file-icon"><Icon name="key" size={16} /></span>
                    <div className="grow">
                      <div className="fs-13 strong">Parent logins</div>
                      <div className="fs-12 muted">{(data.parents || []).length} linked account(s)</div>
                    </div>
                    {can('students.edit') ? <Button size="sm" variant="ghost" onClick={() => createLogin('parent')}>Create new</Button> : null}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'history' ? (
            (data.history || []).length === 0 ? <EmptyState icon="clock" title="No academic history" text="Record previous sessions, promotions and results here." /> : (
              <div>
                {data.history.map((h) => (
                  <div key={h.id} className="file-row">
                    <span className="file-icon"><Icon name="book" size={16} /></span>
                    <div className="grow">
                      <div className="fs-13 strong">{h.session_name} · {h.class_name}</div>
                      <div className="fs-12 muted">{h.result || '—'} {h.percentage ? `· ${h.percentage}%` : ''} {h.remarks ? `· ${h.remarks}` : ''}</div>
                    </div>
                    <span className="fs-12 muted">{formatDateTime(h.created_at)}</span>
                  </div>
                ))}
              </div>
            )
          ) : null}
        </div>
      </Card>

      <StudentForm open={editing} initial={data} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); refresh(); }} />

      <Modal
        open={!!credentials}
        onClose={resetCredentials}
        title={credentials?.error ? 'Login could not be created' : 'Login created'}
        size="sm"
        footer={<Button variant="primary" onClick={resetCredentials}>Done</Button>}
      >
        {credentials?.error ? <Alert tone="warning">{credentials.error}</Alert> : (
          <Alert tone="success" title={`Share these ${credentials?.role} credentials`}>
            <div className="stack-sm mt-2">
              <div className="row-between"><span>Email</span><strong>{credentials?.email}</strong></div>
              <div className="row-between"><span>Temporary password</span><strong>{credentials?.temporaryPassword}</strong></div>
            </div>
          </Alert>
        )}
      </Modal>

      <Modal
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        title="Link a parent account"
        subtitle="If the email is new, a parent login is created with a temporary password."
        size="sm"
        busy={linking}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setLinkOpen(false)} disabled={linking}>Cancel</Button>
            <Button variant="primary" loading={linking} disabled={!linkEmail.includes('@')} onClick={linkParent}>Link parent</Button>
          </>
        )}
      >
        <Input label="Parent email" type="email" required value={linkEmail} onChange={(e) => setLinkEmail(e.target.value)} placeholder="parent@example.com" />
      </Modal>
    </div>
  );
}
