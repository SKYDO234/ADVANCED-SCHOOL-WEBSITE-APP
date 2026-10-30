import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { assetUrl, get, downloadFile, openFile, post } from '../api.js';
import { useApp } from '../store.jsx';
import {
  Alert, Avatar, Badge, Button, Card, EmptyState, Loading, Menu, MenuItem, PageHeader, Progress, StatusBadge,
  Tabs, cx, formatDate, formatMoney, useToast,
} from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';
import { Donut } from '../ui/Charts.jsx';

function PortalHeader() {
  const { school, user, logout, mode, toggleMode, refresh } = useApp();
  const toast = useToast();
  return (
    <header className="topbar" style={{ position: 'sticky' }}>
      <div className="row gap-1" style={{ minWidth: 0 }}>
        <span className="brand-mark" style={{ width: 30, height: 30, borderRadius: 8 }}>
          {school?.logo_url ? <img src={assetUrl(school.logo_url)} alt="" /> : (school?.name || 'S').slice(0, 1)}
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="topbar-title truncate">{school?.name || 'School'}</div>
          <div className="fs-12 muted">Parent & student portal</div>
        </div>
      </div>
      <div className="topbar-actions">
        <button type="button" className="icon-btn" onClick={toggleMode} aria-label="Toggle theme">
          <Icon name={mode === 'dark' ? 'sun' : 'moon'} />
        </button>
        <Menu
          trigger={(
            <button type="button" className="profile-btn" aria-label="Account">
              <Avatar name={user?.full_name} src={user?.avatar_url} size="sm" />
              <span className="hide-mobile" style={{ textAlign: 'left' }}>
                <span className="pname" style={{ display: 'block' }}>{user?.full_name}</span>
                <span className="prole">{user?.role}</span>
              </span>
              <Icon name="chevronDown" size={14} />
            </button>
          )}
        >
          <div className="menu-head">
            <div className="n">{user?.full_name}</div>
            <div className="e">{user?.email}</div>
          </div>
          <div className="menu-sep" />
          <MenuItem icon="refresh" onClick={async () => { await refresh(); toast.success('Refreshed'); }}>Refresh data</MenuItem>
          <MenuItem icon="logout" danger onClick={() => logout()}>Sign out</MenuItem>
        </Menu>
      </div>
    </header>
  );
}

function InvoiceRow({ invoice, currency, onPay, paid }) {
  return (
    <div className="file-row">
      <span className="file-icon"><Icon name="receipt" size={16} /></span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row gap-1">
          <strong className="fs-13">{invoice.invoice_no}</strong>
          <StatusBadge status={invoice.status} />
        </div>
        <div className="fs-12 muted">
          {invoice.period || 'Fee invoice'} · due {formatDate(invoice.due_date)} · balance {formatMoney(invoice.balance, currency)}
        </div>
      </div>
      <div className="row gap-1">
        <Button size="sm" variant="ghost" icon="download" onClick={() => openFile(`/portal/invoice/${invoice.id}/pdf`)}>Invoice</Button>
        {invoice.balance > 0 && !paid ? <Button size="sm" variant="primary" onClick={() => onPay(invoice)}>Pay</Button> : null}
      </div>
    </div>
  );
}

export default function Portal() {
  const { user, status, school, meta } = useApp();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fees, setFees] = useState(null);
  const [paying, setPaying] = useState(null);
  const currency = school?.currency_symbol || '₹';

  const studentId = params.get('studentId') || '';
  const load = async (silent) => {
    if (!silent) setLoading(true);
    try {
      const result = await get('/portal/overview', { studentId: studentId || undefined });
      setData(result);
      setError(null);
      if (result.studentId) {
        setFees(await get('/portal/fees', { studentId: result.studentId }));
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (status === 'ready') load(); /* eslint-disable-next-line */ }, [status, studentId]);

  if (status !== 'ready') return <Loading label="Loading your portal…" />;
  if (!user) return <Navigate to="/login" replace />;
  if (!['student', 'parent'].includes(user.role)) return <Navigate to="/app" replace />;

  const pay = async (invoice) => {
    setPaying(invoice.id);
    try {
      const result = await post('/portal/pay', { invoice_id: invoice.id, amount: invoice.balance });
      if (result.razorpay) {
        toast.info('Redirecting to payment gateway…');
        window.location.href = result.checkoutUrl || result.razorpay.checkoutUrl || '/portal';
        return;
      }
      toast.success('Payment successful', 'Your receipt is available below.');
      await load(true);
    } catch (err) {
      toast.error('Could not complete payment', err.message);
    } finally {
      setPaying(null);
    }
  };

  const student = data?.student;
  const children = data?.children || [];
  const attendancePct = data?.attendance?.percentage ?? 0;
  const due = Number(data?.fees?.due || 0);

  return (
    <div className="public-shell" style={{ background: 'var(--bg)' }}>
      <PortalHeader />
      <div className="page" style={{ maxWidth: 1180 }}>
        {loading && !data ? <Loading /> : null}
        {error ? <Alert tone="danger" title="Could not load the portal">{error.message}</Alert> : null}
        {!loading && data && !data.studentId ? (
          <Card>
            <EmptyState icon="info" title="No student linked yet" text={data.message} />
          </Card>
        ) : null}

        {data?.studentId ? (
          <>
            <div className="portal-head">
              <Avatar name={student?.full_name} src={student?.photo_url} size="lg" />
              <div className="grow">
                <h2>{student?.full_name}</h2>
                <div className="sub">
                  {student?.class_name || 'Class'} {student?.section_name ? `· ${student.section_name}` : ''} · Adm. {student?.admission_no}
                </div>
              </div>
              {children.length > 1 ? (
                <select
                  className="select"
                  style={{ maxWidth: 220, background: 'rgba(255,255,255,0.15)', color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }}
                  value={data.studentId}
                  onChange={(e) => { params.set('studentId', e.target.value); setParams(params); }}
                >
                  {children.map((c) => <option key={c.id} value={c.id} style={{ color: '#111' }}>{c.full_name}</option>)}
                </select>
              ) : null}
            </div>

            <div className="tile-nav mb-3">
              {[
                { label: 'Attendance', meta: `${attendancePct}%`, icon: 'attendance', value: 'overview' },
                { label: 'Results', meta: `${(data.results || []).length} published`, icon: 'results', value: 'results' },
                { label: 'Fees', meta: due ? `${formatMoney(due, currency)} due` : 'All clear', icon: 'fees', value: 'fees' },
                { label: 'Timetable', meta: `${(data.timetable || []).length} periods today`, icon: 'calendar', value: 'timetable' },
                { label: 'Homework', meta: `${(data.homework || []).length} tasks`, icon: 'homework', value: 'homework' },
              ].map((tile) => (
                <button
                  type="button"
                  key={tile.value}
                  className="tile"
                  style={{ textAlign: 'left', borderColor: tab === tile.value ? 'var(--accent)' : undefined }}
                  onClick={() => { params.set('tab', tile.value); setParams(params); }}
                >
                  <span className="t-icon"><Icon name={tile.icon} /></span>
                  <span className="t-label">{tile.label}</span>
                  <span className="t-meta">{tile.meta}</span>
                </button>
              ))}
            </div>

            <Tabs
              value={tab}
              onChange={(v) => { params.set('tab', v); setParams(params); }}
              tabs={[
                { value: 'overview', label: 'Overview' },
                { value: 'fees', label: 'Fees & payments' },
                { value: 'results', label: 'Results' },
                { value: 'timetable', label: 'Timetable' },
                { value: 'homework', label: 'Homework' },
              ]}
            />

            <div className="mt-3">
              {tab === 'overview' ? (
                <div className="grid grid-2">
                  <Card title="Attendance" icon="attendance" actions={<Badge tone={attendancePct >= 75 ? 'success' : 'warning'}>{attendancePct}%</Badge>}>
                    <div className="row gap-3" style={{ alignItems: 'center' }}>
                      <Donut
                        size={150}
                        thickness={18}
                        data={[
                          { label: 'Present', value: data.attendance?.present || 0, color: 'var(--success)' },
                          { label: 'Absent', value: data.attendance?.absent || 0, color: 'var(--danger)' },
                        ]}
                        centerValue={`${attendancePct}%`}
                        centerLabel="attendance"
                      />
                    </div>
                    <div className="fs-12 muted mt-2">{(data.attendance?.total || 0).toLocaleString('en-IN')} days recorded this session.</div>
                  </Card>

                  <Card title="Fees" icon="fees" actions={<Button size="sm" variant="ghost" iconRight="arrowRight" onClick={() => { params.set('tab', 'fees'); setParams(params); }}>Details</Button>}>
                    <div className="row-between mb-2">
                      <div>
                        <div className="fs-12 muted">Total due</div>
                        <div className="stat-value">{formatMoney(due, currency)}</div>
                      </div>
                      <div className="right">
                        <div className="fs-12 muted">Paid</div>
                        <div className="strong">{formatMoney(fees?.position?.paid || data.fees?.paid || 0, currency)}</div>
                      </div>
                    </div>
                    <Progress value={Number(data.fees?.paid || 0)} max={Number(data.fees?.total || 1) || 1} label="Fee collection" />
                    {due > 0 ? <div className="mt-2"><Alert tone="warning">Please clear the outstanding balance before the due date.</Alert></div> : null}
                  </Card>

                  <Card title="Recent results" icon="award" actions={<Button size="sm" variant="ghost" onClick={() => { params.set('tab', 'results'); setParams(params); }}>All results</Button>}>
                    {(data.results || []).length === 0 ? <EmptyState icon="results" title="No published results yet" text="Results appear here as soon as the school publishes them." /> : (
                      <div className="stack-sm">
                        {data.results.slice(0, 3).map((r) => (
                          <div key={r.id} className="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                            <div>
                              <div className="strong fs-13">{r.exam_name}</div>
                              <div className="fs-12 muted">Rank {r.rank || '—'} · {(Number(r.percentage) || 0).toFixed(1)}%</div>
                            </div>
                            <Button size="sm" variant="ghost" icon="download" onClick={() => openFile(`/portal/report-card/${r.id}/pdf`)}>Report card</Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>

                  <Card title="Today's classes" icon="calendar">
                    {(data.timetable || []).length === 0 ? <EmptyState icon="calendar" title="No periods today" text="Enjoy the break — or check the full timetable tab." /> : (
                      <div className="stack-sm">
                        {data.timetable.map((p) => (
                          <div key={p.id} className="row-between" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                            <div className="row gap-2">
                              <Badge tone="accent">{p.period_name}</Badge>
                              <div>
                                <div className="strong fs-13">{p.subject_name || 'Free period'}</div>
                                <div className="fs-12 muted">{p.teacher_name || '—'}</div>
                              </div>
                            </div>
                            <span className="fs-12 muted nowrap">{p.start_time}–{p.end_time}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>

                  <Card title="Homework" icon="homework" actions={<Button size="sm" variant="ghost" onClick={() => { params.set('tab', 'homework'); setParams(params); }}>All tasks</Button>}>
                    {(data.homework || []).length === 0 ? <EmptyState icon="homework" title="Nothing pending" /> : (
                      <div className="stack-sm">
                        {data.homework.slice(0, 4).map((h) => (
                          <div key={h.id} className="row-between" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                            <div style={{ minWidth: 0 }}>
                              <div className="strong fs-13 truncate">{h.title}</div>
                              <div className="fs-12 muted">{h.subject_name || 'General'} · due {formatDate(h.due_date)}</div>
                            </div>
                            {h.my_status ? <Badge tone="success">{h.my_status}</Badge> : <Badge tone="warning">pending</Badge>}
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>

                  <Card title="Documents" icon="file">
                    {(data.documents || []).length === 0 ? <EmptyState icon="file" title="No documents shared" /> : (
                      <div>
                        {data.documents.map((d) => (
                          <div key={d.id} className="file-row">
                            <span className="file-icon"><Icon name="file" size={16} /></span>
                            <div className="grow truncate">
                              <div className="fs-13 strong truncate">{d.name || d.title || 'Document'}</div>
                              <div className="fs-12 muted">{formatDate(d.created_at)}</div>
                            </div>
                            <a className="btn btn-sm btn-ghost" href={assetUrl(d.file_url)} target="_blank" rel="noreferrer"><Icon name="download" /></a>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </div>
              ) : null}

              {tab === 'fees' ? (
                <div className="grid grid-2">
                  <Card title="Invoices" icon="invoices">
                    {!fees ? <Loading /> : (fees.invoices || []).length === 0 ? <EmptyState icon="invoices" title="No invoices yet" /> : (
                      <div>
                        {fees.invoices.map((invoice) => (
                          <InvoiceRow key={invoice.id} invoice={invoice} currency={currency} onPay={pay} paid={paying === invoice.id} />
                        ))}
                      </div>
                    )}
                  </Card>
                  <Card title="Payment history" icon="receipt">
                    {!fees ? <Loading /> : (fees.payments || []).length === 0 ? <EmptyState icon="receipt" title="No payments recorded" /> : (
                      <div>
                        {fees.payments.map((p) => (
                          <div key={p.id} className="file-row">
                            <span className="file-icon"><Icon name="check" size={16} /></span>
                            <div className="grow">
                              <div className="fs-13 strong">{p.receipt_no || p.id}</div>
                              <div className="fs-12 muted">{formatDate(p.paid_at || p.created_at)} · {p.method} · {p.invoice_no}</div>
                            </div>
                            <span className="tnum strong">{formatMoney(p.amount, currency)}</span>
                            {p.receipt_no ? <Button size="sm" variant="ghost" icon="download" onClick={() => openFile(`/portal/receipt/${p.id}/pdf`)} aria-label="Receipt" /> : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </div>
              ) : null}

              {tab === 'results' ? (
                <div className="grid grid-2">
                  {(data.results || []).length === 0 ? <Card><EmptyState icon="results" title="No results published" text="Your report cards will appear here once published." /></Card> : data.results.map((r) => (
                    <Card key={r.id} flush>
                      <div className="result-head">
                        <div className="grow">
                          <div className="strong">{r.exam_name}</div>
                          <div className="fs-12 muted">{r.session_name || ''} · Rank {r.rank || '—'}</div>
                        </div>
                        <Badge tone={(Number(r.percentage) || 0) >= 33 ? 'success' : 'danger'}>{(Number(r.percentage) || 0).toFixed(1)}%</Badge>
                      </div>
                      <div className="card-body">
                        <div className="grid grid-3 mb-2" style={{ gap: 10 }}>
                          <div><div className="fs-12 muted">Marks</div><div className="strong">{r.total_marks ?? '—'} / {r.max_marks ?? '—'}</div></div>
                          <div><div className="fs-12 muted">Grade</div><div className="strong">{r.grade || '—'}</div></div>
                          <div><div className="fs-12 muted">Result</div><div><StatusBadge status={r.status || (r.is_pass ? 'pass' : 'fail')} labels={{ pass: 'Pass', fail: 'Needs improvement', compartment: 'Compartment' }} /></div></div>
                        </div>
                        {(r.subjects_data || []).length ? (
                          <div className="scroll-x">
                            <table className="data compact">
                              <thead><tr><th>Subject</th><th className="num">Marks</th><th>Grade</th></tr></thead>
                              <tbody>
                                {r.subjects_data.map((s, i) => (
                                  <tr key={i}>
                                    <td>{s.subject_name || s.subject}</td>
                                    <td className="num">{s.obtained ?? s.marks ?? '—'} / {s.max ?? s.max_marks ?? '—'}</td>
                                    <td>{s.grade || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                        <div className="row-between mt-2">
                          <span className="fs-12 muted">Attendance: {r.attendance_percentage ?? '—'}%</span>
                          <Button size="sm" variant="outline" icon="download" onClick={() => openFile(`/portal/report-card/${r.id}/pdf`)}>Report card PDF</Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : null}

              {tab === 'timetable' ? <TimetableTab studentId={data.studentId} /> : null}
              {tab === 'homework' ? (
                <Card title="Homework & assignments" icon="homework">
                  {(data.homework || []).length === 0 ? <EmptyState icon="homework" title="No assignments" /> : (
                    <div className="stack-sm">
                      {data.homework.map((h) => (
                        <div key={h.id} className="row-between" style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                          <div style={{ minWidth: 0 }}>
                            <div className="strong fs-13">{h.title}</div>
                            <div className="fs-12 muted">{h.subject_name || 'General'} · assigned {formatDate(h.assigned_date)} · due {formatDate(h.due_date)}</div>
                            {h.instructions ? <div className="fs-13 ink-2 mt-1 prewrap">{h.instructions}</div> : null}
                          </div>
                          <div className="row gap-1">
                            {h.my_marks != null ? <Badge tone="success">{h.my_marks} marks</Badge> : null}
                            <Badge tone={h.my_status ? 'success' : 'warning'}>{h.my_status || 'pending'}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function TimetableTab({ studentId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    get('/portal/timetable', { studentId }).then(setData).catch(() => setData({ periods: [], entries: [] }));
  }, [studentId]);
  if (!data) return <Loading />;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return (
    <Card title="Weekly timetable" icon="calendar">
      {!data.periods?.length ? <EmptyState icon="calendar" title="Timetable not published" /> : (
        <div className="scroll-x">
          <table className="data compact">
            <thead>
              <tr>
                <th>Period</th>
                {days.map((d, i) => <th key={d}>{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.periods.map((p) => (
                <tr key={p.id}>
                  <td className="nowrap"><strong>{p.name}</strong><div className="fs-12 muted">{p.start_time}–{p.end_time}</div></td>
                  {days.map((_, di) => {
                    const entry = (data.entries || []).find((e) => e.period_id === p.id && e.day === di + 1);
                    return (
                      <td key={di} className={cx(!entry && 'muted')}>
                        {entry ? (<><div className="strong fs-13">{entry.subject_name || '—'}</div><div className="fs-12 muted">{entry.teacher_name || ''}</div></>) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
