import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, openFile, post } from '../api.js';
import { useApp } from '../store.jsx';
import {
  Alert, Avatar, Badge, Button, Card, DataTable, Input, Loading, Modal, PageHeader, Select, StatusBadge, Textarea,
  formatDate, formatMoney, useToast,
} from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';

export default function InvoiceDetail() {
  const { id } = useParams();
  const { can, school } = useApp();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ amount: '', method: 'cash', txn_ref: '', notes: '', paid_at: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [lateOpen, setLateOpen] = useState(false);
  const [late, setLate] = useState({ amount: '', reason: '' });
  const currency = school?.currency_symbol || '₹';

  const load = async () => {
    try {
      const res = await get(`/fees/invoices/${id}`);
      setData(res);
      setPayForm((prev) => ({ ...prev, amount: String(res.invoice.balance) }));
      setError(null);
    } catch (err) {
      setError(err);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);
  if (error) return <div className="page"><Alert tone="danger" title="Invoice not found">{error.message}</Alert></div>;
  if (!data) return <div className="page"><Loading label="Loading invoice…" /></div>;

  const { invoice, student, items = [], payments = [], refunds = [] } = data;

  const collect = async () => {
    setBusy(true);
    try {
      const res = await post('/fees/payments', { invoice_id: invoice.id, amount: Number(payForm.amount), method: payForm.method, txn_ref: payForm.txn_ref, notes: payForm.notes, paid_at: payForm.paid_at });
      toast.success('Payment recorded', `Receipt ${res.receipt_no}`);
      setPayOpen(false);
      await load();
      openFile(`/fees/payments/${res.id}/receipt`);
    } catch (err) {
      toast.error('Could not record payment', err.message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await post(`/fees/invoices/${invoice.id}/cancel`, { reason });
      toast.success('Invoice cancelled');
      setCancelOpen(false);
      await load();
    } catch (err) {
      toast.error('Could not cancel', err.message);
    } finally {
      setBusy(false);
    }
  };

  const addLate = async () => {
    setBusy(true);
    try {
      await post(`/fees/invoices/${invoice.id}/late-fee`, { amount: Number(late.amount), reason: late.reason });
      toast.success('Late fee added');
      setLateOpen(false);
      setLate({ amount: '', reason: '' });
      await load();
    } catch (err) {
      toast.error('Could not add late fee', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to="/app/fees">Fees</Link>
        <Icon name="chevronRight" size={12} />
        <Link to="/app/fees?tab=invoices">Invoices</Link>
        <Icon name="chevronRight" size={12} />
        <span>{invoice.invoice_no}</span>
      </div>
      <PageHeader
        title={`Invoice ${invoice.invoice_no}`}
        subtitle={`${student?.full_name || ''} · ${student?.class_name || ''} ${student?.section_name || ''} · Issued ${formatDate(invoice.issue_date)}`}
        actions={(
          <>
            <Button variant="outline" icon="download" onClick={() => openFile(`/fees/invoices/${invoice.id}/pdf`)}>Invoice PDF</Button>
            {can('fees.collect') && Number(invoice.balance) > 0 && invoice.status !== 'cancelled' ? <Button variant="primary" icon="fees" onClick={() => setPayOpen(true)}>Collect payment</Button> : null}
            {can('fees.invoice_edit') && !['paid', 'cancelled'].includes(invoice.status) ? <Button variant="ghost" icon="plus" onClick={() => setLateOpen(true)}>Late fee</Button> : null}
            {can('fees.invoice_delete') && Number(invoice.amount_paid) === 0 && invoice.status !== 'cancelled' ? <Button variant="ghost" icon="close" onClick={() => setCancelOpen(true)}>Cancel invoice</Button> : null}
          </>
        )}
      />

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <Card flush title="Line items" actions={<StatusBadge status={invoice.status} />}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.description}</td>
                    <td className="num">{item.quantity}</td>
                    <td className="num">{formatMoney(item.amount, currency)}</td>
                    <td className="num strong">{formatMoney(Number(item.amount) * Number(item.quantity || 1), currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-body" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="stack-sm" style={{ maxWidth: 320, marginLeft: 'auto' }}>
              <div className="row-between"><span className="muted">Subtotal</span><span className="tnum">{formatMoney(invoice.subtotal, currency)}</span></div>
              {Number(invoice.discount) ? <div className="row-between"><span className="muted">Discount</span><span className="tnum">− {formatMoney(invoice.discount, currency)}</span></div> : null}
              {Number(invoice.late_fee) ? <div className="row-between"><span className="muted">Late fee</span><span className="tnum">{formatMoney(invoice.late_fee, currency)}</span></div> : null}
              <div className="row-between strong" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}><span>Total</span><span className="tnum">{formatMoney(invoice.total, currency)}</span></div>
              <div className="row-between"><span className="muted">Paid</span><span className="tnum" style={{ color: 'var(--success)' }}>{formatMoney(invoice.amount_paid, currency)}</span></div>
              <div className="row-between strong"><span>Balance</span><span className="tnum" style={{ color: Number(invoice.balance) > 0 ? 'var(--danger)' : 'var(--success)' }}>{formatMoney(invoice.balance, currency)}</span></div>
            </div>
          </div>
        </Card>

        <div className="col gap-3">
          <Card title="Student" icon="students">
            <div className="row gap-2">
              <Avatar name={student?.full_name} size="lg" />
              <div className="grow">
                <div className="strong">{student?.full_name}</div>
                <div className="fs-13 muted">{student?.class_name} {student?.section_name} · {student?.admission_no}</div>
                <div className="fs-13">{student?.phone || student?.email || ''}</div>
              </div>
            </div>
            <Link className="btn btn-sm btn-ghost mt-2" to={`/app/students/${student?.id}`}>Open student profile</Link>
          </Card>

          <Card title="Invoice details" icon="invoices">
            <div className="stack-sm fs-13">
              <div className="row-between"><span className="muted">Period</span><span>{invoice.period || '—'}</span></div>
              <div className="row-between"><span className="muted">Issued</span><span>{formatDate(invoice.issue_date)}</span></div>
              <div className="row-between"><span className="muted">Due</span><span>{formatDate(invoice.due_date)}</span></div>
              <div className="row-between"><span className="muted">Payments</span><span>{payments.length}</span></div>
              <div className="row-between"><span className="muted">Refunds</span><span>{formatMoney(refunds.reduce((s, r) => s + Number(r.amount || 0), 0), currency)}</span></div>
            </div>
            {invoice.notes ? <div className="mt-2 fs-12 muted prewrap">{invoice.notes}</div> : null}
          </Card>

          <Card title="Payment history" icon="receipt">
            {payments.length === 0 ? <p className="fs-13 muted">No payments yet.</p> : (
              <div>
                {payments.map((p) => (
                  <div key={p.id} className="file-row">
                    <span className="file-icon"><Icon name="check" size={15} /></span>
                    <div className="grow">
                      <div className="fs-13 strong">{p.receipt_no || '—'}</div>
                      <div className="fs-12 muted">{formatDate(p.paid_at || p.created_at)} · {String(p.method || '').replace(/_/g, ' ')} {p.txn_ref ? `· ${p.txn_ref}` : ''}</div>
                    </div>
                    <span className="tnum strong">{formatMoney(p.amount, currency)}</span>
                    <Button size="sm" variant="ghost" icon="download" onClick={() => openFile(`/fees/payments/${p.id}/receipt`)} aria-label="Receipt" />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title="Collect payment"
        subtitle={`Balance ${formatMoney(invoice.balance, currency)}`}
        size="sm"
        busy={busy}
        footer={<><Button variant="ghost" onClick={() => setPayOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={collect} disabled={!payForm.amount}>Record payment</Button></>}
      >
        <Input label="Amount" type="number" required value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
        <Select label="Method" value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })} options={['cash', 'upi', 'card', 'netbanking', 'cheque', 'bank_transfer', 'dd', 'other'].map((m) => ({ value: m, label: m.replace(/_/g, ' ') }))} />
        <Input label="Reference" value={payForm.txn_ref} onChange={(e) => setPayForm({ ...payForm, txn_ref: e.target.value })} />
        <Input label="Date" type="date" value={payForm.paid_at} onChange={(e) => setPayForm({ ...payForm, paid_at: e.target.value })} />
        <Textarea label="Notes" rows={2} value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} />
      </Modal>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this invoice"
        size="sm"
        busy={busy}
        footer={<><Button variant="ghost" onClick={() => setCancelOpen(false)}>Keep invoice</Button><Button variant="danger" loading={busy} onClick={cancel} disabled={reason.length < 3}>Cancel invoice</Button></>}
      >
        <Alert tone="warning">Cancelling sets the balance to zero and updates the student ledger. This cannot be undone.</Alert>
        <Textarea label="Reason" rows={3} required value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>

      <Modal
        open={lateOpen}
        onClose={() => setLateOpen(false)}
        title="Add a late fee"
        size="sm"
        busy={busy}
        footer={<><Button variant="ghost" onClick={() => setLateOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={addLate} disabled={!late.amount}>Add late fee</Button></>}
      >
        <Input label="Amount" type="number" required value={late.amount} onChange={(e) => setLate({ ...late, amount: e.target.value })} />
        <Textarea label="Reason" rows={2} placeholder="Late payment penalty" value={late.reason} onChange={(e) => setLate({ ...late, reason: e.target.value })} />
      </Modal>
    </div>
  );
}
