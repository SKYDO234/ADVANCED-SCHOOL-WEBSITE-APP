import { useEffect, useState } from 'react';
import { get, openFile, patch, post } from '../api.js';
import { useApp } from '../store.jsx';
import {
  Alert, Badge, Button, Card, DataTable, EmptyState, Input, Loading, Modal, PageHeader, Pagination, Select, Stat,
  formatDate, formatMoney, useToast,
} from '../ui/index.jsx';

const METHODS = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'upi', label: 'UPI' },
];

function monthLabel(month) {
  if (!month) return '';
  const [year, m] = month.split('-');
  return `${new Date(Number(year), Number(m) - 1, 1).toLocaleString('en', { month: 'long' })} ${year}`;
}

export default function Payroll() {
  const { can, school } = useApp();
  const toast = useToast();
  const currency = school?.currency_symbol || '₹';
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [genOpen, setGenOpen] = useState(false);
  const [genMonth, setGenMonth] = useState(new Date().toISOString().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [editForm, setEditForm] = useState({ basic: 0, allowances: 0, deductions: 0, remarks: '' });
  const [payRow, setPayRow] = useState(null);
  const [payForm, setPayForm] = useState({ method: 'bank_transfer', paid_on: new Date().toISOString().slice(0, 10) });
  const limit = 25;

  const load = async () => {
    setLoading(true);
    try { setData(await get('/payroll', { month, status, page, limit })); } catch (err) { toast.error('Could not load payroll', err.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [month, status, page]);

  const generate = async () => {
    setBusy(true);
    try {
      const res = await post('/payroll/generate', { month: genMonth, onlyActive: true });
      toast.success('Payroll generated', `${res.created ?? 0} created · ${res.skipped ?? 0} already existed`);
      setMonth(genMonth);
      setGenOpen(false);
      load();
    } catch (err) { toast.error('Could not generate payroll', err.message); } finally { setBusy(false); }
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      await patch(`/payroll/${editRow.id}`, { ...editForm, basic: Number(editForm.basic), allowances: Number(editForm.allowances), deductions: Number(editForm.deductions) });
      toast.success('Payroll adjusted');
      setEditRow(null);
      load();
    } catch (err) { toast.error('Could not save', err.message); } finally { setBusy(false); }
  };

  const markPaid = async () => {
    setBusy(true);
    try {
      await post(`/payroll/${payRow.id}/pay`, payForm);
      toast.success('Marked as paid');
      setPayRow(null);
      load();
    } catch (err) { toast.error('Could not mark paid', err.message); } finally { setBusy(false); }
  };

  const summary = data?.summary || {};

  return (
    <div className="page">
      <PageHeader
        title="Payroll"
        subtitle="Generate monthly salary sheets, adjust amounts and record payments."
        actions={can('payroll.manage') ? <Button variant="primary" icon="plus" onClick={() => setGenOpen(true)}>Generate payroll</Button> : null}
      />

      <div className="grid grid-4 mb-3">
        <Stat label="Total payroll" value={formatMoney(summary.total || 0, currency)} meta={monthLabel(data?.month)} icon="money" />
        <Stat label="Paid" value={formatMoney(summary.paid || 0, currency)} tone="var(--success)" icon="check" />
        <Stat label="Pending" value={formatMoney(summary.pending || 0, currency)} tone="var(--warning)" icon="clock" />
        <Stat label="Records" value={summary.records || 0} icon="users" />
      </div>

      <Card flush>
        <div style={{ padding: 16 }}>
          <div className="row row-wrap gap-1 mb-2">
            <select className="select" style={{ width: 'auto' }} value={month} onChange={(e) => { setMonth(e.target.value); setPage(1); }}>
              {[month, ...(data?.months || [])].filter((m, i, arr) => m && arr.indexOf(m) === i).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              <option value="all">All months</option>
            </select>
            <select className="select" style={{ width: 'auto' }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
            </select>
            <span className="grow" />
            <Button size="sm" variant="outline" icon="download" onClick={() => openFile('/payroll/export', { month })}>Export</Button>
          </div>

          {loading ? <Loading /> : (data?.items || []).length === 0 ? (
            <EmptyState icon="money" title={`No payroll for ${monthLabel(month)}`} text="Generate the salary sheet for this month to get started."
              action={can('payroll.manage') ? <Button variant="primary" onClick={() => { setGenMonth(month === 'all' ? new Date().toISOString().slice(0, 7) : month); setGenOpen(true); }}>Generate payroll</Button> : null} />
          ) : (
            <DataTable
              rows={data.items}
              columns={[
                { key: 'full_name', header: 'Employee', render: (r) => (<div><div className="strong">{r.full_name}</div><div className="fs-12 muted">{r.employee_code} · {r.designation || r.department || ''}</div></div>) },
                { key: 'month', header: 'Month', render: (r) => monthLabel(r.month) },
                { key: 'basic', header: 'Basic', align: 'num', render: (r) => formatMoney(r.basic, currency) },
                { key: 'allowances', header: 'Allowances', align: 'num', render: (r) => formatMoney(r.allowances, currency) },
                { key: 'deductions', header: 'Deductions', align: 'num', render: (r) => formatMoney(r.deductions, currency) },
                { key: 'net', header: 'Net pay', align: 'num', render: (r) => <strong>{formatMoney(r.net, currency)}</strong> },
                { key: 'status', header: 'Status', render: (r) => <Badge tone={r.status === 'paid' ? 'success' : 'warning'}>{r.status}</Badge> },
                {
                  key: 'actions', header: '', align: 'actions',
                  render: (r) => can('payroll.manage') && r.status !== 'paid' ? (
                    <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                      <Button size="sm" variant="ghost" icon="edit" aria-label="Adjust" onClick={() => { setEditRow(r); setEditForm({ basic: r.basic, allowances: r.allowances, deductions: r.deductions, remarks: r.remarks || '' }); }} />
                      <Button size="sm" variant="outline" onClick={() => { setPayRow(r); setPayForm({ method: 'bank_transfer', paid_on: new Date().toISOString().slice(0, 10) }); }}>Mark paid</Button>
                    </div>
                  ) : r.status === 'paid' ? <span className="fs-12 muted">paid {formatDate(r.paid_on)}</span> : null,
                },
              ]}
              footer={<Pagination page={page} pageCount={data?.pages || 1} total={data?.total || 0} pageSize={limit} onChange={setPage} />}
            />
          )}
        </div>
      </Card>

      <Modal open={genOpen} onClose={() => setGenOpen(false)} title="Generate payroll" size="sm" busy={busy}
        footer={<><Button variant="ghost" onClick={() => setGenOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={generate}>Generate sheet</Button></>}>
        <Alert tone="info">Basic salary comes from each employee’s profile. Allowances default to 10% and deductions to 12% — you can adjust individual rows afterwards.</Alert>
        <Input label="Month" type="month" value={genMonth} onChange={(e) => setGenMonth(e.target.value)} />
      </Modal>

      <Modal open={!!editRow} onClose={() => setEditRow(null)} title={`Adjust ${editRow?.full_name || ''}`} size="sm" busy={busy}
        footer={<><Button variant="ghost" onClick={() => setEditRow(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={saveEdit}>Save</Button></>}>
        <div className="field-row">
          <Input label="Basic" type="number" value={editForm.basic} onChange={(e) => setEditForm({ ...editForm, basic: e.target.value })} />
          <Input label="Allowances" type="number" value={editForm.allowances} onChange={(e) => setEditForm({ ...editForm, allowances: e.target.value })} />
          <Input label="Deductions" type="number" value={editForm.deductions} onChange={(e) => setEditForm({ ...editForm, deductions: e.target.value })} />
        </div>
        <div className="fs-13 strong">Net pay: {formatMoney((Number(editForm.basic) || 0) + (Number(editForm.allowances) || 0) - (Number(editForm.deductions) || 0), currency)}</div>
        <Input label="Remarks" value={editForm.remarks} onChange={(e) => setEditForm({ ...editForm, remarks: e.target.value })} />
      </Modal>

      <Modal open={!!payRow} onClose={() => setPayRow(null)} title={`Pay ${payRow?.full_name || ''}`} size="sm" busy={busy}
        footer={<><Button variant="ghost" onClick={() => setPayRow(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={markPaid}>Confirm payment</Button></>}>
        <div className="fs-13 mb-2">Net payable: <strong>{formatMoney(payRow?.net || 0, currency)}</strong> for {monthLabel(payRow?.month)}.</div>
        <div className="field-row">
          <Select label="Method" value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })} options={METHODS} />
          <Input label="Paid on" type="date" value={payForm.paid_on} onChange={(e) => setPayForm({ ...payForm, paid_on: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
}
