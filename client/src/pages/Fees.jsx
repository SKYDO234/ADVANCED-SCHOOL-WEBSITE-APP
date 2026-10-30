import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { del, downloadFile, get, openFile, post, useDebounced, useResource } from '../api.js';
import { useApp } from '../store.jsx';
import { useAcademic } from '../lib/academic.js';
import {
  Alert, Avatar, Badge, Button, Card, DataTable, EmptyState, Input, Loading, Modal, PageHeader, Pagination,
  Progress, SearchField, Select, StatusBadge, Tabs, Textarea, formatDate, formatMoney, useToast,
} from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';
import { BarChart, Donut, HBars } from '../ui/Charts.jsx';

/* ------------------------------- student picker ---------------------------- */

export function StudentPicker({ value, onSelect, placeholder = 'Search by name or admission no…' }) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q, 260);
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (debounced.trim().length < 2) { setItems([]); return; }
    get('/students', { q: debounced.trim(), limit: 8, status: 'active' }).then((res) => {
      setItems(res.items || []);
      setOpen(true);
    }).catch(() => setItems([]));
  }, [debounced]);

  useEffect(() => {
    const onClick = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      {value ? (
        <div className="row-between" style={{ border: '1px solid var(--line)', borderRadius: 9, padding: '8px 10px' }}>
          <div className="person">
            <Avatar name={value.full_name} size="sm" />
            <div className="person-meta">
              <div className="person-name">{value.full_name}</div>
              <div className="person-sub">{value.admission_no} · {value.class_name || ''} {value.section_name || ''}</div>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>Change</Button>
        </div>
      ) : (
        <>
          <SearchField value={q} onChange={(v) => { setQ(v); setOpen(true); }} placeholder={placeholder} className="w-100" />
          {open && items.length ? (
            <div className="search-results" style={{ maxHeight: 260 }}>
              {items.map((s) => (
                <div key={s.id} className="search-result" role="button" tabIndex={-1} onClick={() => { onSelect(s); setOpen(false); setQ(''); }}>
                  <Avatar name={s.full_name} size="sm" />
                  <div style={{ minWidth: 0 }}>
                    <div className="strong truncate" style={{ fontWeight: 560 }}>{s.full_name}</div>
                    <div className="fs-12 muted">{s.admission_no} · {s.class_name || ''} {s.section_name || ''}{Number(s.fees?.due) > 0 ? ` · due ${s.fees.due}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/* --------------------------------- overview -------------------------------- */

function OverviewTab({ goTo }) {
  const { school } = useApp();
  const currency = school?.currency_symbol || '₹';
  const { data, loading } = useResource('/fees/summary');

  if (loading || !data) return <Loading label="Loading finance summary…" />;
  const k = data.kpis;

  return (
    <>
      <div className="grid grid-4 mb-3">
        <div className="card card-pad"><div className="fs-12 muted">Collected (session)</div><div className="stat-value">{formatMoney(k.sessionCollected, currency)}</div><div className="fs-12 muted">{formatMoney(k.todayCollected, currency)} today · {k.todayReceipts} receipts</div></div>
        <div className="card card-pad"><div className="fs-12 muted">Outstanding</div><div className="stat-value" style={{ color: 'var(--warning)' }}>{formatMoney(k.pending, currency)}</div><div className="fs-12 muted">{k.pendingInvoices} open invoices</div></div>
        <div className="card card-pad"><div className="fs-12 muted">Overdue</div><div className="stat-value" style={{ color: 'var(--danger)' }}>{formatMoney(k.overdue, currency)}</div><div className="fs-12 muted">{k.overdueInvoices} invoices past due</div></div>
        <div className="card card-pad"><div className="fs-12 muted">Billed (net)</div><div className="stat-value">{formatMoney(k.billed, currency)}</div><div className="fs-12 muted">Discounts {formatMoney(k.discounts, currency)}</div></div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <div className="col gap-3">
          <Card title="Collection trend" subtitle="Last 12 months">
            <BarChart
              data={(data.charts.monthly || []).map((m) => ({ label: m.label, value: m.value }))}
              series={[{ key: 'value', label: 'Collected', color: 'var(--accent)' }]}
              format={(v) => `${currency}${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`}
            />
          </Card>
          <Card title="Class-wise collection" flush>
            <DataTable
              rows={data.charts.byClass || []}
              columns={[
                { key: 'name', header: 'Class' },
                { key: 'students', header: 'Students', align: 'num' },
                { key: 'billed', header: 'Billed', align: 'num', render: (r) => formatMoney(r.billed, currency) },
                { key: 'collected', header: 'Collected', align: 'num', render: (r) => formatMoney(r.collected, currency) },
                { key: 'due', header: 'Due', align: 'num', render: (r) => <span style={{ color: Number(r.due) > 0 ? 'var(--danger)' : 'inherit' }}>{formatMoney(r.due, currency)}</span> },
                { key: 'p', header: '', render: (r) => <div style={{ width: 100 }}><Progress small value={Number(r.collected)} max={Number(r.billed) || 1} /></div> },
              ]}
            />
          </Card>
        </div>
        <div className="col gap-3">
          <Card title="Payment mix" icon="card">
            <Donut
              size={150}
              data={(data.charts.methods || []).map((m) => ({ label: String(m.method || 'cash').replace(/_/g, ' '), value: Math.round(m.total) }))}
              centerValue={formatMoney(k.collected, currency)}
              centerLabel="collected"
            />
          </Card>
          <Card title="Recent payments" actions={<Button size="sm" variant="ghost" onClick={() => goTo('payments')}>All</Button>}>
            {(data.recent || []).length === 0 ? <EmptyState icon="payments" title="No payments" /> : (
              <div className="stack-sm">
                {data.recent.map((p) => (
                  <div key={p.id} className="row-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                    <div className="person">
                      <Avatar name={p.full_name} size="sm" />
                      <div className="person-meta">
                        <div className="person-name fs-13">{p.full_name}</div>
                        <div className="fs-12 muted">{p.receipt_no} · {p.method}</div>
                      </div>
                    </div>
                    <div className="right">
                      <div className="strong tnum fs-13">{formatMoney(p.amount, currency)}</div>
                      <div className="fs-12 muted">{formatDate(p.paid_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Top defaulters" icon="alert" actions={<Button size="sm" variant="ghost" onClick={() => goTo('defaulters')}>View all</Button>}>
            {(data.defaulters || []).length === 0 ? <EmptyState icon="check" title="Nothing outstanding" /> : (
              <div className="stack-sm">
                {data.defaulters.map((d) => (
                  <Link key={d.id} to={`/app/students/${d.id}`} className="row-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)', textDecoration: 'none' }}>
                    <div className="person">
                      <Avatar name={d.full_name} size="sm" />
                      <div className="person-meta">
                        <div className="person-name fs-13">{d.full_name}</div>
                        <div className="fs-12 muted">{d.class_name || ''} · {d.admission_no}</div>
                      </div>
                    </div>
                    <span className="strong tnum fs-13" style={{ color: 'var(--danger)' }}>{formatMoney(d.due_amount, currency)}</span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

/* --------------------------------- invoices -------------------------------- */

function CreateInvoiceModal({ open, onClose, onDone, presetStudent }) {
  const toast = useToast();
  const { school } = useApp();
  const currency = school?.currency_symbol || '₹';
  const { data: headsData } = useResource('/fees/heads');
  const [student, setStudent] = useState(presetStudent || null);
  const [form, setForm] = useState({ due_date: '', period: '', discount: 0, notes: '', issue_date: new Date().toISOString().slice(0, 10) });
  const [items, setItems] = useState([{ description: '', amount: '', quantity: 1 }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setStudent(presetStudent || null);
      const due = new Date();
      due.setDate(due.getDate() + 14);
      setForm({ due_date: due.toISOString().slice(0, 10), period: new Date().toISOString().slice(0, 7), discount: 0, notes: '', issue_date: new Date().toISOString().slice(0, 10) });
      setItems([{ description: '', amount: '', quantity: 1 }]);
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const subtotal = items.reduce((s, i) => s + (Number(i.amount) || 0) * (Number(i.quantity) || 1), 0);
  const total = Math.max(0, subtotal - (Number(form.discount) || 0));

  const submit = async () => {
    if (!student) return setError('Choose a student');
    const clean = items.filter((i) => i.description && Number(i.amount) >= 0);
    if (!clean.length) return setError('Add at least one line item');
    setBusy(true);
    setError('');
    try {
      const res = await post('/fees/invoices', {
        student_id: student.id,
        ...form,
        discount: Number(form.discount) || 0,
        items: clean.map((i) => ({ description: i.description, amount: Number(i.amount) || 0, quantity: Number(i.quantity) || 1 })),
      });
      toast.success('Invoice created', `${res.invoice_no} · ${formatMoney(res.total, currency)}`);
      onDone?.(res);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const heads = headsData?.items || [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create an invoice"
      size="lg"
      busy={busy}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>Create invoice · {formatMoney(total, currency)}</Button>
        </>
      )}
    >
      {error ? <div className="mb-2"><Alert tone="danger">{error}</Alert></div> : null}
      <div className="mb-2">
        <label className="label">Student</label>
        <StudentPicker value={student} onSelect={setStudent} />
      </div>
      <div className="field-row">
        <Input label="Issue date" type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} />
        <Input label="Due date" type="date" required value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
        <Input label="Period" placeholder="2026-11" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} />
      </div>

      <label className="label mb-1">Line items</label>
      {items.map((item, i) => (
        <div key={i} className="row gap-1 mb-1" style={{ alignItems: 'flex-end' }}>
          <div className="grow">
            <input className="input" placeholder="Description (e.g. Tuition fee — November)" value={item.description} list="fee-heads" onChange={(e) => setItems((prev) => prev.map((x, idx) => (idx === i ? { ...x, description: e.target.value } : x)))} />
          </div>
          <input className="input" type="number" placeholder="Amount" style={{ width: 120 }} value={item.amount} onChange={(e) => setItems((prev) => prev.map((x, idx) => (idx === i ? { ...x, amount: e.target.value } : x)))} />
          <input className="input" type="number" min="0.1" step="0.5" style={{ width: 76 }} value={item.quantity} onChange={(e) => setItems((prev) => prev.map((x, idx) => (idx === i ? { ...x, quantity: e.target.value } : x)))} />
          <Button size="sm" variant="ghost" icon="trash" onClick={() => setItems((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))} aria-label="Remove" />
        </div>
      ))}
      <datalist id="fee-heads">
        {heads.map((h) => <option key={h.id} value={h.name} />)}
      </datalist>
      <Button size="sm" variant="ghost" icon="plus" onClick={() => setItems((prev) => [...prev, { description: '', amount: '', quantity: 1 }])}>Add line</Button>

      <div className="divider" />
      <div className="row-between mb-1"><span>Subtotal</span><span className="tnum">{formatMoney(subtotal, currency)}</span></div>
      <div className="row-between mb-1">
        <span>Discount</span>
        <input className="input" type="number" style={{ width: 120, textAlign: 'right' }} value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} />
      </div>
      <div className="row-between strong"><span>Total</span><span className="tnum">{formatMoney(total, currency)}</span></div>
      <Textarea label="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
    </Modal>
  );
}

function GenerateInvoicesModal({ open, onClose, onDone }) {
  const toast = useToast();
  const { classes } = useAcademic();
  const [form, setForm] = useState({ period: new Date().toISOString().slice(0, 7), due_date: '', classId: '', includeMonthlyOnly: true });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (open) {
      const due = new Date();
      due.setDate(due.getDate() + 10);
      setForm({ period: new Date().toISOString().slice(0, 7), due_date: due.toISOString().slice(0, 10), classId: '', includeMonthlyOnly: true });
      setResult(null);
    }
  }, [open]);

  const run = async () => {
    setBusy(true);
    try {
      const res = await post('/fees/invoices/generate', {
        period: form.period,
        due_date: form.due_date,
        classIds: form.classId ? [form.classId] : [],
        includeMonthlyOnly: form.includeMonthlyOnly,
      });
      setResult(res);
      toast.success('Invoices generated', `${res.created} created · ${res.skipped || 0} skipped`);
      onDone?.();
    } catch (err) {
      toast.error('Could not generate invoices', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate monthly invoices"
      subtitle="Creates invoices for students with monthly fee structures that have not been billed for this period."
      size="sm"
      busy={busy}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
          <Button variant="primary" loading={busy} onClick={run} icon="spark">Generate</Button>
        </>
      )}
    >
      <Input label="Billing period" placeholder="2026-11" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} hint="Format: YYYY-MM" />
      <Input label="Due date" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
      <Select label="Class" placeholder="All classes" options={classes.map((c) => ({ value: c.id, label: c.name }))} value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} />
      <label className="checkbox mb-2">
        <input type="checkbox" checked={form.includeMonthlyOnly} onChange={(e) => setForm({ ...form, includeMonthlyOnly: e.target.checked })} />
        <span>Only monthly fee heads</span>
      </label>
      {result ? <Alert tone="success" title={`${result.created} invoices created`}>{result.skipped ? `${result.skipped} students skipped (already billed or no structure).` : 'All eligible students were billed.'}</Alert> : null}
    </Modal>
  );
}

function InvoicesTab({ initialStatus }) {
  const { school, can } = useApp();
  const { classes } = useAcademic();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const debounced = useDebounced(q);
  const [status, setStatus] = useState(initialStatus || '');
  const [classId, setClassId] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const currency = school?.currency_symbol || '₹';
  const limit = 25;
  const navigate = useNavigate();
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      setData(await get('/fees/invoices', { q: debounced, status, classId, page, limit }));
    } catch (err) {
      toast.error('Could not load invoices', err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [debounced, status, classId, page]);
  useEffect(() => { setPage(1); }, [debounced, status, classId]);

  return (
    <>
      <div className="row row-wrap gap-1 mb-2">
        <SearchField value={q} onChange={setQ} placeholder="Invoice no., student…" />
        <select className="select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partially paid</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select className="select" style={{ width: 'auto' }} value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">All classes</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="grow" />
        {data?.totals ? (
          <span className="fs-12 muted">Billed {formatMoney(data.totals.billed, currency)} · Balance {formatMoney(data.totals.balance, currency)}</span>
        ) : null}
        {can('fees.invoice_create') ? <Button variant="outline" icon="refresh" onClick={() => setGenOpen(true)}>Generate monthly</Button> : null}
        {can('fees.invoice_create') ? <Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>New invoice</Button> : null}
      </div>

      <Card flush>
        <DataTable
          loading={loading}
          rows={data?.items || []}
          columns={[
            { key: 'invoice_no', header: 'Invoice', render: (r) => <Link to={`/app/fees/invoices/${r.id}`} className="strong">{r.invoice_no}</Link> },
            { key: 'full_name', header: 'Student', render: (r) => (<div><div>{r.full_name}</div><div className="fs-12 muted">{r.class_name || ''} {r.section_name || ''} · {r.admission_no}</div></div>) },
            { key: 'issue_date', header: 'Issued', render: (r) => formatDate(r.issue_date) },
            { key: 'due_date', header: 'Due', render: (r) => formatDate(r.due_date) },
            { key: 'total', header: 'Total', align: 'num', render: (r) => formatMoney(r.total, currency) },
            { key: 'amount_paid', header: 'Paid', align: 'num', render: (r) => formatMoney(r.amount_paid, currency) },
            { key: 'balance', header: 'Balance', align: 'num', render: (r) => <span className={Number(r.balance) > 0 ? 'strong' : ''}>{formatMoney(r.balance, currency)}</span> },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'actions',
              header: '',
              align: 'actions',
              render: (r) => (
                <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                  <Button size="sm" variant="ghost" icon="download" onClick={() => openFile(`/fees/invoices/${r.id}/pdf`)} aria-label="PDF" />
                  <Button size="sm" variant="outline" onClick={() => navigate(`/app/fees/invoices/${r.id}`)}>Open</Button>
                </div>
              ),
            },
          ]}
          emptyTitle="No invoices"
          emptyText="Create an invoice or generate monthly invoices for the whole school."
          footer={<Pagination page={page} pageCount={data?.pages || 1} total={data?.total || 0} pageSize={limit} onChange={setPage} />}
        />
      </Card>

      <CreateInvoiceModal open={createOpen} onClose={() => setCreateOpen(false)} onDone={load} />
      <GenerateInvoicesModal open={genOpen} onClose={() => setGenOpen(false)} onDone={load} />
    </>
  );
}

function CollectTab() {
  const toast = useToast();
  const { school, can } = useApp();
  const currency = school?.currency_symbol || '₹';
  const [params] = useSearchParams();
  const [student, setStudent] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [invoiceId, setInvoiceId] = useState('');
  const [form, setForm] = useState({ amount: '', method: 'cash', txn_ref: '', notes: '', paid_at: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);

  useEffect(() => {
    const id = params.get('studentId');
    if (id) get(`/students/${id}`).then((s) => setStudent(s)).catch(() => {});
  }, [params]);

  useEffect(() => {
    if (!student) { setInvoices([]); return; }
    get('/fees/invoices', { studentId: student.id, limit: 50 })
      .then((res) => {
        const open = (res.items || []).filter((i) => Number(i.balance) > 0 && i.status !== 'cancelled');
        setInvoices(open);
        setInvoiceId(open[0]?.id || '');
      })
      .catch(() => setInvoices([]));
  }, [student]);

  const selected = invoices.find((i) => i.id === invoiceId);

  useEffect(() => {
    if (selected) setForm((prev) => ({ ...prev, amount: String(selected.balance) }));
  }, [invoiceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!student) return toast.warning('Choose a student first');
    setBusy(true);
    try {
      const res = await post('/fees/payments', {
        invoice_id: invoiceId || null,
        student_id: invoiceId ? null : student.id,
        amount: Number(form.amount),
        method: form.method,
        txn_ref: form.txn_ref,
        notes: form.notes,
        paid_at: form.paid_at,
      });
      toast.success('Payment recorded', `Receipt ${res.receipt_no}`);
      setReceipt(res);
      setForm({ amount: '', method: 'cash', txn_ref: '', notes: '', paid_at: new Date().toISOString().slice(0, 10) });
      const res2 = await get('/fees/invoices', { studentId: student.id, limit: 50 });
      const open = (res2.items || []).filter((i) => Number(i.balance) > 0 && i.status !== 'cancelled');
      setInvoices(open);
      setInvoiceId(open[0]?.id || '');
    } catch (err) {
      toast.error('Could not record payment', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 16, alignItems: 'start' }}>
      <Card title="Find a student" icon="search">
        <StudentPicker value={student} onSelect={setStudent} />
        {student ? (
          <div className="mt-3">
            <div className="row-between mb-2">
              <h4>Open invoices</h4>
              <Badge tone={invoices.length ? 'warning' : 'success'}>{invoices.length ? `${invoices.length} unpaid` : 'all clear'}</Badge>
            </div>
            {invoices.length === 0 ? <EmptyState icon="check" title="No dues" text="This student has no outstanding invoices." /> : (
              <div>
                {invoices.map((inv) => (
                  <label key={inv.id} className={cxInvoice(invoiceId === inv.id)} style={{ display: 'block', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 8, cursor: 'pointer', background: invoiceId === inv.id ? 'var(--accent-soft)' : 'transparent', borderColor: invoiceId === inv.id ? 'var(--accent)' : 'var(--line)' }}>
                    <input type="radio" name="invoice" checked={invoiceId === inv.id} onChange={() => setInvoiceId(inv.id)} style={{ marginRight: 8 }} />
                    <span className="strong">{inv.invoice_no}</span>
                    <span className="fs-12 muted"> · due {formatDate(inv.due_date)} · {inv.period || ''}</span>
                    <div className="fs-13 mt-1">
                      Total {formatMoney(inv.total, currency)} · Paid {formatMoney(inv.amount_paid, currency)} · <strong>Balance {formatMoney(inv.balance, currency)}</strong>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        ) : <p className="fs-13 muted mt-2">Search for a student to see their dues and collect a payment.</p>}
      </Card>

      <Card title="Record a payment" icon="card">
        <Input label="Amount" type="number" min="0" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} hint={selected ? `Balance: ${formatMoney(selected.balance, currency)}` : 'Leave blank to record against the ledger'} />
        <Select
          label="Method"
          value={form.method}
          onChange={(e) => setForm({ ...form, method: e.target.value })}
          options={['cash', 'upi', 'card', 'netbanking', 'cheque', 'bank_transfer', 'dd', 'other'].map((m) => ({ value: m, label: m.replace(/_/g, ' ') }))}
        />
        <Input label="Transaction reference" placeholder="UPI ref / cheque no." value={form.txn_ref} onChange={(e) => setForm({ ...form, txn_ref: e.target.value })} />
        <Input label="Payment date" type="date" value={form.paid_at} onChange={(e) => setForm({ ...form, paid_at: e.target.value })} />
        <Textarea label="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <Button block variant="primary" size="lg" icon="check" loading={busy} onClick={submit} disabled={!student || !form.amount}>Record payment</Button>
        {receipt ? (
          <div className="mt-3">
            <Alert tone="success" title={`Receipt ${receipt.receipt_no}`}>
              {formatMoney(receipt.amount, currency)} recorded.
              <div className="mt-2">
                <Button size="sm" variant="outline" icon="download" onClick={() => openFile(`/fees/payments/${receipt.id}/receipt`)}>Open receipt PDF</Button>
              </div>
            </Alert>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

const cxInvoice = (active) => (active ? 'strong' : '');

function PaymentsTab() {
  const toast = useToast();
  const { school, can } = useApp();
  const currency = school?.currency_symbol || '₹';
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const [method, setMethod] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refundFor, setRefundFor] = useState(null);
  const [refund, setRefund] = useState({ amount: '', reason: '' });
  const limit = 25;

  const load = async () => {
    setLoading(true);
    try {
      setData(await get('/fees/payments', { q: debounced, method, page, limit }));
    } catch (err) {
      toast.error('Could not load payments', err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [debounced, method, page]);

  const doRefund = async () => {
    try {
      await post(`/fees/payments/${refundFor.id}/refund`, { amount: Number(refund.amount), reason: refund.reason });
      toast.success('Refund recorded');
      setRefundFor(null);
      setRefund({ amount: '', reason: '' });
      load();
    } catch (err) {
      toast.error('Could not refund', err.message);
    }
  };

  return (
    <>
      <div className="row row-wrap gap-1 mb-2">
        <SearchField value={q} onChange={setQ} placeholder="Receipt no., student, txn ref…" />
        <select className="select" style={{ width: 'auto' }} value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">All methods</option>
          {['cash', 'upi', 'card', 'netbanking', 'cheque', 'bank_transfer', 'dd', 'other'].map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
        </select>
        <span className="grow" />
        {data?.totals ? <span className="fs-12 muted">Collected {formatMoney(data.totals.collected, currency)}</span> : null}
        {can('fees.export') ? <Button variant="outline" icon="download" onClick={() => downloadFile('/fees/payments/export', null, 'payments.csv')}>Export</Button> : null}
      </div>
      <Card flush>
        <DataTable
          loading={loading}
          rows={data?.items || []}
          columns={[
            { key: 'receipt_no', header: 'Receipt', render: (r) => <strong>{r.receipt_no || '—'}</strong> },
            { key: 'full_name', header: 'Student', render: (r) => (<div><div>{r.full_name || '—'}</div><div className="fs-12 muted">{r.class_name || ''} · {r.admission_no || ''}</div></div>) },
            { key: 'invoice_no', header: 'Invoice' },
            { key: 'paid_at', header: 'Date', render: (r) => formatDate(r.paid_at || r.created_at) },
            { key: 'method', header: 'Method', render: (r) => <span style={{ textTransform: 'capitalize' }}>{String(r.method || '').replace(/_/g, ' ')}</span> },
            { key: 'amount', header: 'Amount', align: 'num', render: (r) => <strong className="tnum">{formatMoney(r.amount, currency)}</strong> },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'actions',
              header: '',
              align: 'actions',
              render: (r) => (
                <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                  <Button size="sm" variant="ghost" icon="download" onClick={() => openFile(`/fees/payments/${r.id}/receipt`)} aria-label="Receipt" />
                  {can('fees.refund') && ['success', 'partially_refunded'].includes(r.status) ? (
                    <Button size="sm" variant="ghost" onClick={() => { setRefundFor(r); setRefund({ amount: String(r.amount), reason: '' }); }}>Refund</Button>
                  ) : null}
                </div>
              ),
            },
          ]}
          emptyTitle="No payments recorded"
          footer={<Pagination page={page} pageCount={data?.pages || 1} total={data?.total || 0} pageSize={limit} onChange={setPage} />}
        />
      </Card>

      <Modal
        open={!!refundFor}
        onClose={() => setRefundFor(null)}
        title="Process a refund"
        subtitle={refundFor ? `${refundFor.receipt_no} · ${formatMoney(refundFor.amount, currency)}` : ''}
        size="sm"
        footer={<><Button variant="ghost" onClick={() => setRefundFor(null)}>Cancel</Button><Button variant="danger" onClick={doRefund} disabled={!refund.amount || refund.reason.length < 3}>Refund</Button></>}
      >
        <Input label="Amount" type="number" required value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} />
        <Textarea label="Reason" rows={3} required value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} />
      </Modal>
    </>
  );
}

function SetupTab() {
  const { can, school } = useApp();
  const toast = useToast();
  const currency = school?.currency_symbol || '₹';
  const { classes, currentSession } = useAcademic();
  const { data: headsData, reload: reloadHeads } = useResource('/fees/heads');
  const { data: structuresData, reload: reloadStructures } = useResource('/fees/structures');
  const [headOpen, setHeadOpen] = useState(false);
  const [headForm, setHeadForm] = useState({ name: '', code: '', type: 'annual', description: '' });
  const [structOpen, setStructOpen] = useState(false);
  const [structForm, setStructForm] = useState({ name: '', class_id: '', description: '', items: [{ fee_head_id: '', amount: '', frequency: 'monthly', due_day: 10 }] });
  const [busy, setBusy] = useState(false);

  const addHead = async () => {
    setBusy(true);
    try {
      await post('/fees/heads', headForm);
      toast.success('Fee head created');
      setHeadOpen(false);
      setHeadForm({ name: '', code: '', type: 'annual', description: '' });
      reloadHeads(true);
    } catch (err) {
      toast.error('Could not create fee head', err.message);
    } finally {
      setBusy(false);
    }
  };

  const addStructure = async () => {
    setBusy(true);
    try {
      const items = structForm.items.filter((i) => i.fee_head_id && i.amount !== '');
      await post('/fees/structures', {
        name: structForm.name,
        class_id: structForm.class_id || null,
        description: structForm.description,
        sessionId: currentSession?.id,
        items: items.map((i) => ({ fee_head_id: i.fee_head_id, amount: Number(i.amount), frequency: i.frequency, due_day: Number(i.due_day) || 10 })),
      });
      toast.success('Fee structure created');
      setStructOpen(false);
      setStructForm({ name: '', class_id: '', description: '', items: [{ fee_head_id: '', amount: '', frequency: 'monthly', due_day: 10 }] });
      reloadStructures(true);
    } catch (err) {
      toast.error('Could not create structure', err.message);
    } finally {
      setBusy(false);
    }
  };

  const heads = headsData?.items || [];

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
      <Card
        title="Fee heads"
        icon="list"
        actions={can('fees.structure') ? <Button size="sm" variant="primary" icon="plus" onClick={() => setHeadOpen(true)}>New head</Button> : null}
      >
        {heads.length === 0 ? <EmptyState icon="list" title="No fee heads" /> : (
          <div className="stack-sm">
            {heads.map((h) => (
              <div key={h.id} className="row-between" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                <div>
                  <div className="strong fs-13">{h.name}</div>
                  <div className="fs-12 muted">{String(h.type || '').replace(/_/g, ' ')} {h.code ? `· ${h.code}` : ''}</div>
                </div>
                {can('fees.structure') ? (
                  <Button size="sm" variant="ghost" icon="trash" aria-label="Delete" onClick={async () => {
                    try { await del(`/fees/heads/${h.id}`); toast.success('Fee head deleted'); reloadHeads(true); } catch (err) { toast.error('Could not delete', err.message); }
                  }} />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Fee structures"
        icon="invoices"
        actions={can('fees.structure') ? <Button size="sm" variant="primary" icon="plus" onClick={() => setStructOpen(true)}>New structure</Button> : null}
      >
        {(structuresData?.items || []).length === 0 ? <EmptyState icon="invoices" title="No fee structures" text="Create a structure to define what each class pays." /> : (
          <div className="stack-sm">
            {structuresData.items.map((s) => (
              <div key={s.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <div className="row-between">
                  <div>
                    <div className="strong fs-13">{s.name}</div>
                    <div className="fs-12 muted">{s.class_name || 'All classes'} · {s.assigned} students assigned</div>
                  </div>
                  <div className="right">
                    <div className="strong tnum fs-13">{formatMoney(s.gross, currency)}</div>
                    <div className="fs-12 muted">per year</div>
                  </div>
                </div>
                <div className="row row-wrap gap-1 mt-1">
                  {(s.items || []).map((i) => <Badge key={i.id} tone="outline">{i.head_name} · {formatMoney(i.amount, currency)}</Badge>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={headOpen}
        onClose={() => setHeadOpen(false)}
        title="New fee head"
        size="sm"
        busy={busy}
        footer={<><Button variant="ghost" onClick={() => setHeadOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={addHead} disabled={!headForm.name}>Create</Button></>}
      >
        <Input label="Name" required placeholder="Tuition fee" value={headForm.name} onChange={(e) => setHeadForm({ ...headForm, name: e.target.value })} />
        <div className="field-row">
          <Input label="Code" value={headForm.code} onChange={(e) => setHeadForm({ ...headForm, code: e.target.value })} />
          <Select label="Frequency" value={headForm.type} onChange={(e) => setHeadForm({ ...headForm, type: e.target.value })} options={['one_time', 'monthly', 'quarterly', 'annual', 'custom'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') }))} />
        </div>
        <Textarea label="Description" rows={2} value={headForm.description} onChange={(e) => setHeadForm({ ...headForm, description: e.target.value })} />
      </Modal>

      <Modal
        open={structOpen}
        onClose={() => setStructOpen(false)}
        title="New fee structure"
        size="lg"
        busy={busy}
        footer={<><Button variant="ghost" onClick={() => setStructOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={addStructure} disabled={!structForm.name || !structForm.items.some((i) => i.fee_head_id && i.amount !== '')}>Create structure</Button></>}
      >
        <div className="field-row">
          <Input label="Structure name" required placeholder="Class 8 — 2026-27" value={structForm.name} onChange={(e) => setStructForm({ ...structForm, name: e.target.value })} />
          <Select label="Class" placeholder="All classes" options={classes.map((c) => ({ value: c.id, label: c.name }))} value={structForm.class_id} onChange={(e) => setStructForm({ ...structForm, class_id: e.target.value })} />
        </div>
        <label className="label mb-1">Components</label>
        {structForm.items.map((item, i) => (
          <div key={i} className="row gap-1 mb-1" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <select className="select" style={{ flex: 2, minWidth: 140 }} value={item.fee_head_id} onChange={(e) => setStructForm((prev) => ({ ...prev, items: prev.items.map((x, idx) => (idx === i ? { ...x, fee_head_id: e.target.value } : x)) }))}>
              <option value="">Fee head…</option>
              {heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            <input className="input" type="number" placeholder="Amount" style={{ width: 110 }} value={item.amount} onChange={(e) => setStructForm((prev) => ({ ...prev, items: prev.items.map((x, idx) => (idx === i ? { ...x, amount: e.target.value } : x)) }))} />
            <select className="select" style={{ width: 130 }} value={item.frequency} onChange={(e) => setStructForm((prev) => ({ ...prev, items: prev.items.map((x, idx) => (idx === i ? { ...x, frequency: e.target.value } : x)) }))}>
              {['monthly', 'quarterly', 'annual', 'one_time', 'custom'].map((f) => <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>)}
            </select>
            <Button size="sm" variant="ghost" icon="trash" onClick={() => setStructForm((prev) => ({ ...prev, items: prev.items.filter((_, idx) => idx !== i) }))} aria-label="Remove" />
          </div>
        ))}
        <Button size="sm" variant="ghost" icon="plus" onClick={() => setStructForm((prev) => ({ ...prev, items: [...prev.items, { fee_head_id: '', amount: '', frequency: 'monthly', due_day: 10 }] }))}>Add component</Button>
        <Textarea label="Description" rows={2} value={structForm.description} onChange={(e) => setStructForm({ ...structForm, description: e.target.value })} />
      </Modal>
    </div>
  );
}

function ExpensesTab() {
  const { can, school } = useApp();
  const toast = useToast();
  const currency = school?.currency_symbol || '₹';
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category: '', description: '', amount: '', expense_date: new Date().toISOString().slice(0, 10), paid_to: '', method: 'cash', voucher_no: '' });
  const [busy, setBusy] = useState(false);
  const limit = 25;

  const load = async () => {
    setLoading(true);
    try {
      setData(await get('/fees/expenses', { page, limit }));
    } catch (err) {
      toast.error('Could not load expenses', err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [page]);

  const save = async () => {
    setBusy(true);
    try {
      await post('/fees/expenses', { ...form, amount: Number(form.amount) });
      toast.success('Expense recorded');
      setOpen(false);
      setForm({ category: '', description: '', amount: '', expense_date: new Date().toISOString().slice(0, 10), paid_to: '', method: 'cash', voucher_no: '' });
      load();
    } catch (err) {
      toast.error('Could not save expense', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="row row-wrap gap-1 mb-2">
        <span className="fs-13 muted">{data?.total || 0} expenses · total {formatMoney(data?.amount || 0, currency)}</span>
        <span className="grow" />
        {can('fees.expense') ? <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>Record expense</Button> : null}
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: 16, alignItems: 'start' }}>
        <Card flush>
          <DataTable
            loading={loading}
            rows={data?.items || []}
            columns={[
              { key: 'expense_date', header: 'Date', render: (r) => formatDate(r.expense_date) },
              { key: 'category', header: 'Category' },
              { key: 'description', header: 'Description', render: (r) => r.description || '—' },
              { key: 'paid_to', header: 'Paid to', render: (r) => r.paid_to || '—' },
              { key: 'amount', header: 'Amount', align: 'num', render: (r) => formatMoney(r.amount, currency) },
              { key: 'method', header: 'Method', render: (r) => String(r.method || '').replace(/_/g, ' ') },
              {
                key: 'actions',
                header: '',
                align: 'actions',
                render: (r) => (can('fees.expense') ? (
                  <Button size="sm" variant="ghost" icon="trash" aria-label="Delete" onClick={async () => { await del(`/fees/expenses/${r.id}`); toast.success('Expense deleted'); load(); }} />
                ) : null),
              },
            ]}
            emptyTitle="No expenses recorded"
            footer={<Pagination page={page} pageCount={data?.pages || 1} total={data?.total || 0} pageSize={limit} onChange={setPage} />}
          />
        </Card>
        <Card title="By category" icon="chart">
          <HBars data={(data?.byCategory || []).map((c) => ({ label: c.category, value: Math.round(c.total) }))} format={(v) => formatMoney(v, currency)} color="var(--warning)" />
        </Card>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record an expense"
        size="sm"
        busy={busy}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!form.category || !form.amount}>Save</Button></>}
      >
        <Input label="Category" required placeholder="Salaries / Utilities / Maintenance" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <Input label="Amount" type="number" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        <Input label="Date" type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
        <Input label="Paid to" value={form.paid_to} onChange={(e) => setForm({ ...form, paid_to: e.target.value })} />
        <div className="field-row">
          <Select label="Method" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} options={['cash', 'upi', 'bank_transfer', 'cheque', 'card'].map((m) => ({ value: m, label: m.replace(/_/g, ' ') }))} />
          <Input label="Voucher no." value={form.voucher_no} onChange={(e) => setForm({ ...form, voucher_no: e.target.value })} />
        </div>
        <Textarea label="Description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Modal>
    </>
  );
}

function DefaultersTab() {
  const { school } = useApp();
  const currency = school?.currency_symbol || '₹';
  const { data, loading } = useResource('/fees/defaulters');
  const rows = data?.items || [];
  return (
    <Card flush title="Outstanding balances" subtitle={`${rows.length} students with dues`}>
      <DataTable
        loading={loading}
        rows={rows}
        sortable
        columns={[
          { key: 'full_name', header: 'Student', render: (r) => (<Link to={`/app/students/${r.id}`} className="person" style={{ textDecoration: 'none' }}><Avatar name={r.full_name} size="sm" /><div className="person-meta"><div className="person-name">{r.full_name}</div><div className="person-sub">{r.class_name || ''} {r.section_name || ''} · {r.admission_no}</div></div></Link>) },
          { key: 'phone', header: 'Phone', render: (r) => r.phone || '—' },
          { key: 'net_amount', header: 'Billed', align: 'num', render: (r) => formatMoney(r.net_amount, currency) },
          { key: 'paid_amount', header: 'Paid', align: 'num', render: (r) => formatMoney(r.paid_amount, currency) },
          { key: 'due_amount', header: 'Due', align: 'num', render: (r) => <strong style={{ color: 'var(--danger)' }}>{formatMoney(r.due_amount, currency)}</strong> },
          { key: 'oldest_due', header: 'Oldest due', render: (r) => formatDate(r.oldest_due) },
          { key: 'a', header: '', align: 'actions', render: (r) => <Link className="btn btn-sm btn-outline" to={`/app/fees?tab=collect&studentId=${r.id}`}>Collect</Link> },
        ]}
        emptyTitle="No outstanding balances"
        emptyText="Every student is up to date."
      />
    </Card>
  );
}

export default function Fees() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  const setTab = (value) => { const next = new URLSearchParams(params); next.set('tab', value); setParams(next, { replace: true }); };

  return (
    <div className="page">
      <PageHeader title="Fees & billing" subtitle="Invoices, collections, fee structures, expenses and outstanding balances." />
      <Card flush>
        <div style={{ padding: '0 14px' }}>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'overview', label: 'Overview' },
              { value: 'invoices', label: 'Invoices' },
              { value: 'collect', label: 'Collect payment' },
              { value: 'payments', label: 'Payments' },
              { value: 'defaulters', label: 'Defaulters' },
              { value: 'setup', label: 'Fee setup' },
              { value: 'expenses', label: 'Expenses' },
            ]}
          />
        </div>
        <div style={{ padding: 16 }}>
          {tab === 'overview' ? <OverviewTab goTo={setTab} /> : null}
          {tab === 'invoices' ? <InvoicesTab initialStatus={params.get('status') || ''} /> : null}
          {tab === 'collect' ? <CollectTab /> : null}
          {tab === 'payments' ? <PaymentsTab /> : null}
          {tab === 'defaulters' ? <DefaultersTab /> : null}
          {tab === 'setup' ? <SetupTab /> : null}
          {tab === 'expenses' ? <ExpensesTab /> : null}
        </div>
      </Card>
    </div>
  );
}
