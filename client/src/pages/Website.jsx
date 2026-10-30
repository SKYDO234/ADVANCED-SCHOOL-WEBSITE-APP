import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { assetUrl, del, get, patch, post, put, upload, useDebounced } from '../api.js';
import { useApp } from '../store.jsx';
import {
  Alert, Badge, Button, Card, Checkbox, DataTable, EmptyState, FileDrop, Input, Loading, Modal, PageHeader, Pagination,
  SearchField, Select, Stat, Tabs, Textarea, formatDate, formatDateTime, useToast,
} from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';

function ContentTab({ settings, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({});
  const [stats, setStats] = useState([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setForm(settings || {});
    setStats(Array.isArray(settings?.stats) ? settings.stats : [{ label: 'Students', value: '1,200' }, { label: 'Teachers', value: '80' }, { label: 'Years', value: '25' }]);
  }, [settings]);

  const save = async () => {
    setBusy(true);
    try {
      await put('/website/settings', { ...form, stats: stats.filter((s) => s.label && s.value) });
      toast.success('Website content saved');
      onSaved();
    } catch (err) { toast.error('Could not save', err.message); } finally { setBusy(false); }
  };

  const uploadHero = async (file) => {
    setUploading(true);
    try {
      const res = await upload('/uploads', file, { bucket: 'website' });
      setForm((prev) => ({ ...prev, heroImage: res.url }));
      toast.success('Hero image uploaded');
    } catch (err) { toast.error('Upload failed', err.message); } finally { setUploading(false); }
  };

  return (
    <div className="col gap-3">
      <Card title="Home page hero" subtitle="The first thing visitors see on your public website." actions={<Button size="sm" variant="primary" loading={busy} onClick={save}>Save content</Button>}>
        <div className="field-row">
          <Input label="Hero title" value={form.heroTitle || ''} onChange={(e) => setForm({ ...form, heroTitle: e.target.value })} />
          <Input label="Hero subtitle" value={form.heroSubtitle || ''} onChange={(e) => setForm({ ...form, heroSubtitle: e.target.value })} />
        </div>
        {form.heroImage ? <img src={assetUrl(form.heroImage)} alt="Hero" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 12, marginBottom: 10 }} /> : null}
        <FileDrop accept="image/*" onFile={uploadHero} uploading={uploading} label="Upload a hero image (JPG or PNG, up to 10 MB)" />
        <Textarea label="About the school" rows={5} className="mt-2" value={form.aboutText || ''} onChange={(e) => setForm({ ...form, aboutText: e.target.value })} />
      </Card>

      <Card title="Highlight numbers" subtitle="Shown as big counters on the home page.">
        <div className="stack-sm">
          {stats.map((s, i) => (
            <div key={i} className="row gap-1">
              <input className="input" placeholder="Label" value={s.label} onChange={(e) => setStats(stats.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <input className="input" style={{ maxWidth: 130 }} placeholder="Value" value={s.value} onChange={(e) => setStats(stats.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" icon="trash" aria-label="Remove" onClick={() => setStats(stats.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
        <Button size="sm" variant="outline" icon="plus" className="mt-2" onClick={() => setStats([...stats, { label: '', value: '' }])} disabled={stats.length >= 6}>Add counter</Button>
      </Card>

      <Card title="Contact & admissions" subtitle="Parents reach you through these details.">
        <div className="field-row">
          <Input label="Contact phone" value={form.contactPhone || ''} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
          <Input label="Contact email" value={form.contactEmail || ''} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
          <div style={{ paddingTop: 24 }}><Checkbox label="Admissions are open" checked={form.admissionsOpen !== false} onChange={(e) => setForm({ ...form, admissionsOpen: e.target.checked })} /></div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><Button variant="primary" loading={busy} onClick={save}>Save change</Button></div>
      </Card>
    </div>
  );
}

function PagesTab({ onChanged }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ slug: '', title: '', content: '', is_published: true, show_in_nav: true });
  const [busy, setBusy] = useState(false);

  const load = () => get('/website/pages').then(setData).catch((err) => toast.error('Could not load pages', err.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const openEdit = (page) => {
    setEditing(page);
    setForm({ slug: page?.slug || '', title: page?.title || '', content: page?.content || '', is_published: page ? !!page.is_published : true, show_in_nav: page ? !!page.show_in_nav : true });
    setOpen(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      if (editing) await patch(`/website/pages/${editing.id}`, { title: form.title, content: form.content, is_published: form.is_published, show_in_nav: form.show_in_nav });
      else await post('/website/pages', { slug: form.slug, title: form.title });
      toast.success(editing ? 'Page updated' : 'Page created');
      setOpen(false);
      load();
      onChanged?.();
    } catch (err) { toast.error('Could not save page', err.message); } finally { setBusy(false); }
  };

  const toggle = async (page, key) => {
    try {
      await patch(`/website/pages/${page.id}`, { [key]: !page[key] });
      load();
    } catch (err) { toast.error('Could not update', err.message); }
  };

  return (
    <Card title="Website pages" subtitle="Pages appear in the public navigation when published." actions={<Button size="sm" variant="primary" icon="plus" onClick={() => openEdit(null)}>New page</Button>}>
      {!data ? <Loading /> : (
        <DataTable
          rows={data.items}
          columns={[
            { key: 'title', header: 'Page', render: (r) => (<div><div className="strong">{r.title}</div><div className="fs-12 muted">/{r.slug}</div></div>) },
            { key: 'blocks', header: 'Blocks', render: (r) => (r.blocks || []).length },
            { key: 'is_published', header: 'Published', render: (r) => <Badge tone={r.is_published ? 'success' : 'outline'}>{r.is_published ? 'live' : 'draft'}</Badge> },
            { key: 'show_in_nav', header: 'In menu', render: (r) => <Badge tone={r.show_in_nav ? 'accent' : 'outline'}>{r.show_in_nav ? 'yes' : 'no'}</Badge> },
            { key: 'updated_at', header: 'Updated', render: (r) => formatDate(r.updated_at) },
            {
              key: 'actions', header: '', align: 'actions',
              render: (r) => (
                <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                  <Button size="sm" variant="outline" onClick={() => openEdit(r)}>Edit</Button>
                  <Button size="sm" variant="ghost" icon={r.is_published ? 'eyeOff' : 'eye'} aria-label="Toggle publish" onClick={() => toggle(r, 'is_published')} />
                  {r.slug !== 'home' ? <Button size="sm" variant="ghost" icon="trash" aria-label="Delete" onClick={async () => { if (!window.confirm(`Delete ${r.title}?`)) return; try { await del(`/website/pages/${r.id}`); toast.success('Page deleted'); load(); } catch (err) { toast.error('Could not delete', err.message); } }} /> : null}
                </div>
              ),
            },
          ]}
        />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit page' : 'New page'} size="lg" busy={busy}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!form.title || (!editing && !form.slug)}>{editing ? 'Save page' : 'Create page'}</Button></>}>
        <div className="field-row">
          <Input label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Input label="Slug" required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} disabled={!!editing} hint={editing ? 'Slugs cannot change once created.' : 'Appears in the URL: /p/slug'} />
        </div>
        <Textarea label="Page content" rows={12} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} hint="Plain text or simple HTML. Blank lines become paragraphs." />
        <div className="row gap-3">
          <Checkbox label="Published" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} />
          <Checkbox label="Show in navigation" checked={form.show_in_nav} onChange={(e) => setForm({ ...form, show_in_nav: e.target.checked })} />
        </div>
      </Modal>
    </Card>
  );
}

function NewsTab({ onChanged }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title: '', excerpt: '', body: '', category: 'news', is_published: true, cover_url: '' });
  const [busy, setBusy] = useState(false);

  const load = () => get('/public/news').then((res) => setItems(res.items || [])).catch(() => setItems([]));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const openEdit = (post) => { setEditing(post || null); setForm(post ? { ...post, cover_url: post.cover_url || '' } : { title: '', excerpt: '', body: '', category: 'news', is_published: true, cover_url: '' }); setOpen(true); };

  const save = async () => {
    setBusy(true);
    try {
      if (editing) await patch(`/website/news/${editing.id}`, form);
      else await post('/website/news', form);
      toast.success(editing ? 'Post updated' : 'Post published');
      setOpen(false);
      load();
      onChanged?.();
    } catch (err) { toast.error('Could not save post', err.message); } finally { setBusy(false); }
  };

  return (
    <Card title="News & events" subtitle="Announcements shown on the public website." actions={<Button size="sm" variant="primary" icon="plus" onClick={() => openEdit(null)}>New post</Button>}>
      {!items ? <Loading /> : items.length === 0 ? <EmptyState icon="communication" title="No posts yet" text="Publish school news, events and achievements." /> : (
        <div className="grid grid-2">
          {items.map((n) => (
            <div key={n.id} className="card card-pad">
              {n.cover_url ? <img src={assetUrl(n.cover_url)} alt="" style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 9, marginBottom: 8 }} /> : null}
              <div className="row-between">
                <Badge tone="outline">{n.category}</Badge>
                <span className="fs-12 muted">{formatDate(n.published_at)}</span>
              </div>
              <div className="strong mt-1">{n.title}</div>
              <p className="fs-13 ink-2" style={{ margin: '4px 0' }}>{n.excerpt || (n.body || '').slice(0, 120)}</p>
              <div className="row gap-1">
                <Button size="sm" variant="outline" onClick={() => openEdit(n)}>Edit</Button>
                <Button size="sm" variant="ghost" icon="trash" aria-label="Delete" onClick={async () => { if (!window.confirm('Delete this post?')) return; try { await del(`/website/news/${n.id}`); toast.success('Post deleted'); load(); } catch (err) { toast.error('Could not delete', err.message); } }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit post' : 'New post'} size="lg" busy={busy}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={form.title.length < 3}>{editing ? 'Save post' : 'Publish post'}</Button></>}>
        <Input label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <div className="field-row">
          <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} options={['news', 'event', 'notice', 'achievement'].map((c) => ({ value: c, label: c }))} />
          <Input label="Cover image URL" value={form.cover_url || ''} onChange={(e) => setForm({ ...form, cover_url: e.target.value })} />
        </div>
        <Textarea label="Excerpt" rows={2} value={form.excerpt || ''} onChange={(e) => setForm({ ...form, excerpt: e.target.value })} />
        <Textarea label="Body" rows={8} value={form.body || ''} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        <Checkbox label="Published" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} />
      </Modal>
    </Card>
  );
}

function InquiriesTab() {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [noteFor, setNoteFor] = useState(null);
  const [note, setNote] = useState('');
  const limit = 20;

  const load = async () => {
    setLoading(true);
    try { setData(await get('/website/inquiries', { status, q: debounced, page, limit })); } catch (err) { toast.error('Could not load inquiries', err.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status, debounced, page]);

  const setInquiryStatus = async (row, value) => {
    try { await patch(`/website/inquiries/${row.id}`, { status: value }); toast.success('Inquiry updated'); load(); } catch (err) { toast.error('Could not update', err.message); }
  };

  const counts = Object.fromEntries((data?.counts || []).map((c) => [c.status, c.c]));
  return (
    <>
      <div className="grid grid-4 mb-3">
        <Stat label="New inquiries" value={counts.new || 0} icon="communication" />
        <Stat label="Contacted" value={counts.contacted || 0} icon="messages" />
        <Stat label="Enrolled" value={counts.enrolled || 0} icon="userCheck" />
        <Stat label="Rejected" value={counts.rejected || 0} icon="close" />
      </div>
      <Card title="Admission inquiries" subtitle="Submitted through the public admissions form.">
        <div className="row row-wrap gap-1 mb-2">
          <SearchField value={q} onChange={setQ} placeholder="Search name or phone…" />
          <select className="select" style={{ width: 'auto' }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All</option><option value="new">New</option><option value="contacted">Contacted</option><option value="enrolled">Enrolled</option><option value="rejected">Rejected</option>
          </select>
          <span className="grow" />
          <span className="fs-12 muted">{data?.total || 0} inquiries</span>
        </div>
        <DataTable
          loading={loading}
          rows={data?.items || []}
          columns={[
            { key: 'student_name', header: 'Student', render: (r) => (<div><div className="strong">{r.student_name}</div><div className="fs-12 muted">{r.class_applied ? `Class ${r.class_applied}` : 'Class not specified'}</div></div>) },
            { key: 'parent_name', header: 'Parent', render: (r) => r.parent_name || '—' },
            { key: 'phone', header: 'Contact', render: (r) => (<div><div className="fs-13">{r.phone}</div><div className="fs-12 muted">{r.email || ''}</div></div>) },
            { key: 'created_at', header: 'Received', render: (r) => formatDate(r.created_at) },
            {
              key: 'status', header: 'Status',
              render: (r) => (
                <select className="select" style={{ width: 'auto', height: 30, fontSize: 12 }} value={r.status} onChange={(e) => setInquiryStatus(r, e.target.value)}>
                  <option value="new">New</option><option value="contacted">Contacted</option><option value="enrolled">Enrolled</option><option value="rejected">Rejected</option>
                </select>
              ),
            },
            { key: 'notes', header: 'Notes', render: (r) => <span className="fs-12 muted truncate" style={{ maxWidth: 180, display: 'block' }}>{r.notes || '—'}</span> },
            { key: 'actions', header: '', align: 'actions', render: (r) => <Button size="sm" variant="ghost" icon="edit" aria-label="Add note" onClick={() => { setNoteFor(r); setNote(r.notes || ''); }} /> },
          ]}
          emptyTitle="No inquiries"
          emptyText="Inquiries submitted from the website will appear here."
          footer={<Pagination page={page} pageCount={data?.pages || 1} total={data?.total || 0} pageSize={limit} onChange={setPage} />}
        />
      </Card>

      <Modal open={!!noteFor} onClose={() => setNoteFor(null)} title={`Note for ${noteFor?.student_name || ''}`} size="sm"
        footer={<><Button variant="ghost" onClick={() => setNoteFor(null)}>Cancel</Button>
          <Button variant="primary" onClick={async () => { try { await patch(`/website/inquiries/${noteFor.id}`, { notes: note }); toast.success('Note saved'); setNoteFor(null); load(); } catch (err) { toast.error('Could not save note', err.message); } }}>Save note</Button></>}>
        <Textarea label="Admissions note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
    </>
  );
}

function MessagesTab() {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const load = () => get('/website/contact-messages').then((res) => setItems(res.items || [])).catch(() => setItems([]));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (!items) return <Loading />;
  return (
    <Card title="Contact messages" subtitle="Messages sent from the website contact form.">
      {items.length === 0 ? <EmptyState icon="messages" title="No messages" /> : (
        <div className="stack-sm">
          {items.map((m) => (
            <div key={m.id} className="card card-pad">
              <div className="row-between">
                <div>
                  <div className="strong">{m.subject || 'General enquiry'}</div>
                  <div className="fs-12 muted">{m.name} · {m.email || m.phone} · {formatDateTime(m.created_at)}</div>
                </div>
                <select className="select" style={{ width: 'auto', height: 30, fontSize: 12 }} value={m.status} onChange={async (e) => { try { await patch(`/website/contact-messages/${m.id}`, { status: e.target.value }); toast.success('Message updated'); load(); } catch (err) { toast.error('Could not update', err.message); } }}>
                  <option value="new">New</option><option value="read">Read</option><option value="replied">Replied</option><option value="archived">Archived</option>
                </select>
              </div>
              <p className="fs-13 ink-2 prewrap" style={{ margin: '8px 0 0' }}>{m.message}</p>
              {m.email ? <a className="btn btn-sm btn-outline mt-2" href={`mailto:${m.email}`}><Icon name="send" size={14} /> Reply by email</a> : null}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function Website() {
  const { can, publicSite, reloadPublic } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'content';
  const setTab = (value) => { const next = new URLSearchParams(params); next.set('tab', value); setParams(next, { replace: true }); };
  const [data, setData] = useState(null);

  const load = () => get('/website/pages').then((res) => setData(res)).catch(() => setData({ items: [], settings: {} }));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="page">
      <PageHeader
        title="Website & CMS"
        subtitle="Everything parents see on your public site — content, pages, news and enquiries."
        actions={<Button variant="outline" icon="globe" onClick={() => window.open('/', '_blank')}>View website</Button>}
      />
      {!data ? <Loading label="Loading website…" /> : (
        <Card flush>
          <div style={{ padding: '0 14px' }}>
            <Tabs value={tab} onChange={setTab} tabs={[
              { value: 'content', label: 'Home content' },
              { value: 'pages', label: 'Pages' },
              { value: 'news', label: 'News & events' },
              ...(can('website.admissions') ? [{ value: 'inquiries', label: 'Admissions' }, { value: 'messages', label: 'Messages' }] : []),
            ]} />
          </div>
          <div style={{ padding: 16 }}>
            {tab === 'content' ? <ContentTab settings={data.settings} onSaved={() => { load(); reloadPublic?.(); }} /> : null}
            {tab === 'pages' ? <PagesTab onChanged={reloadPublic} /> : null}
            {tab === 'news' ? <NewsTab onChanged={reloadPublic} /> : null}
            {tab === 'inquiries' ? <InquiriesTab /> : null}
            {tab === 'messages' ? <MessagesTab /> : null}
          </div>
        </Card>
      )}
      {publicSite?.website?.admissionsOpen === false ? <Alert tone="info" className="mt-3" title="Admissions are closed">The admissions form on the website is currently disabled.</Alert> : null}
    </div>
  );
}
