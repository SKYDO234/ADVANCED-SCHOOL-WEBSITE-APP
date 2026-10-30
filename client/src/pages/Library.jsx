import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { del, downloadFile, get, patch, post, useDebounced } from '../api.js';
import { useApp } from '../store.jsx';
import {
  Alert, Avatar, Badge, Button, Card, DataTable, EmptyState, Input, Loading, Modal, PageHeader, Pagination,
  SearchField, Select, StatusBadge, Tabs, Textarea, formatDate, formatMoney, useToast,
} from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';

function BookModal({ open, onClose, book, categories, onDone }) {
  const toast = useToast();
  const [form, setForm] = useState({ title: '', author: '', isbn: '', publisher: '', category_id: '', edition: '', rack: '', total_copies: 1, price: 0 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(book ? { ...book, category_id: book.category_id || '' } : { title: '', author: '', isbn: '', publisher: '', category_id: '', edition: '', rack: '', total_copies: 1, price: 0 });
  }, [open, book]);

  const save = async () => {
    setBusy(true);
    try {
      if (book) await patch(`/library/books/${book.id}`, form);
      else await post('/library/books', { ...form, category_id: form.category_id || null });
      toast.success(book ? 'Book updated' : 'Book added');
      onDone?.();
      onClose();
    } catch (err) {
      toast.error('Could not save book', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={book ? 'Edit book' : 'Add a book'} size="lg" busy={busy}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!form.title}>Save book</Button></>}>
      <div className="field-row">
        <Input label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Input label="Author" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
      </div>
      <div className="field-row">
        <Input label="ISBN" value={form.isbn} onChange={(e) => setForm({ ...form, isbn: e.target.value })} />
        <Input label="Publisher" value={form.publisher} onChange={(e) => setForm({ ...form, publisher: e.target.value })} />
        <Select label="Category" placeholder="Uncategorised" options={categories.map((c) => ({ value: c.id, label: c.name }))} value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} />
      </div>
      <div className="field-row">
        <Input label="Edition" value={form.edition} onChange={(e) => setForm({ ...form, edition: e.target.value })} />
        <Input label="Rack" value={form.rack} onChange={(e) => setForm({ ...form, rack: e.target.value })} />
        <Input label="Copies" type="number" min="1" value={form.total_copies} onChange={(e) => setForm({ ...form, total_copies: e.target.value })} />
        <Input label="Price" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
      </div>
    </Modal>
  );
}

function IssueModal({ open, onClose, books, onDone }) {
  const toast = useToast();
  const [form, setForm] = useState({ book_id: '', borrower_type: 'student', borrower_id: '', due_date: '', remarks: '' });
  const [q, setQ] = useState('');
  const debounced = useDebounced(q, 260);
  const [borrowers, setBorrowers] = useState({ students: [], employees: [] });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const due = new Date();
    due.setDate(due.getDate() + 14);
    setForm({ book_id: books[0]?.id || '', borrower_type: 'student', borrower_id: '', due_date: due.toISOString().slice(0, 10), remarks: '' });
    setQ('');
    setBorrowers({ students: [], employees: [] });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (debounced.trim().length < 2) { setBorrowers({ students: [], employees: [] }); return; }
    get('/library/borrowers', { q: debounced.trim() }).then(setBorrowers).catch(() => {});
  }, [debounced]);

  const list = form.borrower_type === 'student' ? borrowers.students : borrowers.employees;

  const submit = async () => {
    setBusy(true);
    try {
      await post('/library/issues', { ...form, borrower_id: form.borrower_id });
      toast.success('Book issued');
      onDone?.();
      onClose();
    } catch (err) {
      toast.error('Could not issue book', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Issue a book" size="sm" busy={busy}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit} disabled={!form.book_id || !form.borrower_id}>Issue book</Button></>}>
      <Select label="Book" options={books.map((b) => ({ value: b.id, label: `${b.title} (${b.available_copies} available)` }))} value={form.book_id} onChange={(e) => setForm({ ...form, book_id: e.target.value })} />
      <Select label="Borrower type" value={form.borrower_type} onChange={(e) => setForm({ ...form, borrower_type: e.target.value, borrower_id: '' })} options={[{ value: 'student', label: 'Student' }, { value: 'employee', label: 'Employee' }]} />
      <SearchField value={q} onChange={setQ} placeholder={form.borrower_type === 'student' ? 'Search student…' : 'Search employee…'} className="w-100" />
      {list.length ? (
        <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 9, margin: '8px 0' }}>
          {list.map((p) => (
            <div key={p.id} role="button" tabIndex={-1} className="search-result" style={{ background: form.borrower_id === p.id ? 'var(--accent-soft)' : undefined }} onClick={() => setForm({ ...form, borrower_id: p.id })}>
              <div>
                <div className="strong fs-13">{p.full_name}</div>
                <div className="fs-12 muted">{p.admission_no || p.employee_code} {p.class_name ? `· ${p.class_name}` : p.department ? `· ${p.department}` : ''}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <Input label="Due date" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
      <Textarea label="Remarks" rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
    </Modal>
  );
}

function ReturnModal({ issue, onClose, onDone }) {
  const toast = useToast();
  const [form, setForm] = useState({ fine: '', fine_paid: true, condition: 'good' });
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (issue) setForm({ fine: '', fine_paid: true, condition: 'good' }); }, [issue]);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await post(`/library/issues/${issue.id}/return`, { fine: Number(form.fine) || 0, fine_paid: form.fine_paid, condition: form.condition });
      toast.success('Book returned', res.fine ? `Fine ${res.fine} recorded` : 'No fine due');
      onDone?.();
      onClose();
    } catch (err) {
      toast.error('Could not return book', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!issue} onClose={onClose} title="Return a book" subtitle={issue?.title} size="sm" busy={busy}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Confirm return</Button></>}>
      {issue?.days_overdue ? <Alert tone="warning">This book is {issue.days_overdue} day(s) overdue. Leave the fine blank to calculate automatically.</Alert> : null}
      <Input label="Fine amount" type="number" placeholder="Auto-calculated if blank" value={form.fine} onChange={(e) => setForm({ ...form, fine: e.target.value })} />
      <Select label="Condition" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} options={[{ value: 'good', label: 'Good' }, { value: 'damaged', label: 'Damaged' }, { value: 'lost', label: 'Lost' }]} />
      <label className="checkbox"><input type="checkbox" checked={form.fine_paid} onChange={(e) => setForm({ ...form, fine_paid: e.target.checked })} /><span>Fine collected</span></label>
    </Modal>
  );
}

export default function Library() {
  const { can, school } = useApp();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'catalogue';
  const setTab = (value) => { const next = new URLSearchParams(params); next.set('tab', value); setParams(next, { replace: true }); };
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const [availability, setAvailability] = useState('');
  const [page, setPage] = useState(1);
  const [books, setBooks] = useState(null);
  const [issues, setIssues] = useState(null);
  const [issueStatus, setIssueStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [bookModal, setBookModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [issueModal, setIssueModal] = useState(false);
  const [returning, setReturning] = useState(null);
  const [categories, setCategories] = useState([]);
  const currency = school?.currency_symbol || '₹';
  const limit = 20;

  const loadBooks = async () => {
    setLoading(true);
    try { setBooks(await get('/library/books', { q: debounced, availability, page, limit })); } catch (err) { toast.error('Could not load books', err.message); } finally { setLoading(false); }
  };
  const loadIssues = async () => {
    setLoading(true);
    try { setIssues(await get('/library/issues', { q: debounced, status: issueStatus, page, limit })); } catch (err) { toast.error('Could not load loans', err.message); } finally { setLoading(false); }
  };
  useEffect(() => { get('/library/categories').then((res) => setCategories(res.items || [])).catch(() => {}); }, []);
  useEffect(() => { if (tab === 'catalogue') loadBooks(); else loadIssues(); /* eslint-disable-next-line */ }, [tab, debounced, availability, issueStatus, page]);
  useEffect(() => { setPage(1); }, [debounced, availability, issueStatus, tab]);

  const stats = issues?.stats || {};

  return (
    <div className="page">
      <PageHeader
        title="Library"
        subtitle="Catalogue, issues, returns and fines."
        actions={(
          <>
            {can('library.export') ? <Button variant="outline" icon="download" onClick={() => downloadFile('/library/export/books', null, 'library-books.csv')}>Export catalogue</Button> : null}
            {can('library.issue') ? <Button variant="outline" icon="send" onClick={() => setIssueModal(true)}>Issue book</Button> : null}
            {can('library.manage') ? <Button variant="primary" icon="plus" onClick={() => { setEditing(null); setBookModal(true); }}>Add book</Button> : null}
          </>
        )}
      />

      <Card flush>
        <div style={{ padding: '0 14px' }}>
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'catalogue', label: 'Catalogue', count: books?.total }, { value: 'loans', label: 'Issued & returned' }]} />
        </div>
        <div style={{ padding: 16 }}>
          <div className="row row-wrap gap-1 mb-2">
            <SearchField value={q} onChange={setQ} placeholder={tab === 'catalogue' ? 'Title, author, ISBN…' : 'Book or borrower…'} />
            {tab === 'catalogue' ? (
              <select className="select" style={{ width: 'auto' }} value={availability} onChange={(e) => setAvailability(e.target.value)}>
                <option value="">All copies</option>
                <option value="available">Available</option>
                <option value="out">Out of stock</option>
              </select>
            ) : (
              <select className="select" style={{ width: 'auto' }} value={issueStatus} onChange={(e) => setIssueStatus(e.target.value)}>
                <option value="">All loans</option>
                <option value="issued">Issued</option>
                <option value="overdue">Overdue</option>
                <option value="returned">Returned</option>
              </select>
            )}
            <span className="grow" />
            {tab === 'loans' ? (
              <div className="row gap-1 fs-12 muted">
                <span>{stats.books || 0} titles</span>·<span>{stats.issued || 0} issued</span>·<span style={{ color: 'var(--danger)' }}>{stats.overdue || 0} overdue</span>
              </div>
            ) : null}
          </div>

          {tab === 'catalogue' ? (
            <DataTable
              loading={loading}
              rows={books?.items || []}
              columns={[
                { key: 'title', header: 'Title', render: (r) => (<div><div className="strong">{r.title}</div><div className="fs-12 muted">{r.author || '—'} · {r.category_name || 'Uncategorised'}</div></div>) },
                { key: 'isbn', header: 'ISBN', render: (r) => r.isbn || '—' },
                { key: 'rack', header: 'Rack', render: (r) => r.rack || '—' },
                { key: 'available_copies', header: 'Available', align: 'num', render: (r) => <Badge tone={r.available_copies > 0 ? 'success' : 'danger'}>{r.available_copies}/{r.total_copies}</Badge> },
                { key: 'issued_count', header: 'On loan', align: 'num' },
                { key: 'price', header: 'Price', align: 'num', render: (r) => formatMoney(r.price, currency) },
                {
                  key: 'actions',
                  header: '',
                  align: 'actions',
                  render: (r) => (
                    <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                      {can('library.manage') ? <Button size="sm" variant="ghost" icon="edit" onClick={() => { setEditing(r); setBookModal(true); }} aria-label="Edit" /> : null}
                      {can('library.manage') ? <Button size="sm" variant="ghost" icon="trash" aria-label="Delete" onClick={async () => { if (!window.confirm(`Delete ${r.title}?`)) return; try { await del(`/library/books/${r.id}`); toast.success('Book deleted'); loadBooks(); } catch (err) { toast.error('Could not delete', err.message); } }} /> : null}
                    </div>
                  ),
                },
              ]}
              emptyTitle="No books"
              emptyText="Add books to start lending."
              footer={<Pagination page={page} pageCount={books?.pages || 1} total={books?.total || 0} pageSize={limit} onChange={setPage} />}
            />
          ) : (
            <DataTable
              loading={loading}
              rows={issues?.items || []}
              columns={[
                { key: 'title', header: 'Book', render: (r) => (<div><div className="strong">{r.title}</div><div className="fs-12 muted">{r.author || ''}</div></div>) },
                { key: 'borrower_name', header: 'Borrower', render: (r) => (<div><div>{r.borrower_name}</div><div className="fs-12 muted">{r.borrower_code || ''} {r.class_name ? `· ${r.class_name}` : ''}</div></div>) },
                { key: 'issue_date', header: 'Issued', render: (r) => formatDate(r.issue_date) },
                { key: 'due_date', header: 'Due', render: (r) => formatDate(r.due_date) },
                { key: 'status', header: 'Status', render: (r) => (<div className="row gap-1"><StatusBadge status={r.status} />{r.days_overdue ? <Badge tone="danger">{r.days_overdue}d late</Badge> : null}</div>) },
                { key: 'fine', header: 'Fine', align: 'num', render: (r) => (Number(r.fine) ? <span style={{ color: r.fine_paid ? 'inherit' : 'var(--danger)' }}>{formatMoney(r.fine, currency)}</span> : '—') },
                {
                  key: 'actions',
                  header: '',
                  align: 'actions',
                  render: (r) => (
                    <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                      {can('library.issue') && ['issued', 'overdue'].includes(r.status) ? <Button size="sm" variant="outline" onClick={() => setReturning(r)}>Return</Button> : null}
                      {can('library.fine') && Number(r.fine) && !r.fine_paid ? (
                        <Button size="sm" variant="ghost" onClick={async () => { try { await post(`/library/issues/${r.id}/fine`, { fine_paid: true }); toast.success('Fine marked paid'); loadIssues(); } catch (err) { toast.error('Could not update fine', err.message); } }}>Fine paid</Button>
                      ) : null}
                    </div>
                  ),
                },
              ]}
              emptyTitle="No loans"
              emptyText="Issue a book to get started."
              footer={<Pagination page={page} pageCount={issues?.pages || 1} total={issues?.total || 0} pageSize={limit} onChange={setPage} />}
            />
          )}
        </div>
      </Card>

      <BookModal open={bookModal} book={editing} categories={categories} onClose={() => { setBookModal(false); setEditing(null); }} onDone={() => { loadBooks(); get('/library/categories').then((r) => setCategories(r.items || [])); }} />
      <IssueModal open={issueModal} books={books?.items || []} onClose={() => setIssueModal(false)} onDone={loadIssues} />
      <ReturnModal issue={returning} onClose={() => setReturning(null)} onDone={loadIssues} />
    </div>
  );
}
