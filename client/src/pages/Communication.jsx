import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { del, get, post, useDebounced, useResource } from '../api.js';
import { useApp } from '../store.jsx';
import { useAcademic } from '../lib/academic.js';
import {
  Avatar, Badge, Button, Card, EmptyState, Input, Loading, Modal, PageHeader, Pagination,
  SearchField, Select, Tabs, Textarea, formatDateTime, relativeTime, useToast,
} from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';

function AnnouncementModal({ open, onClose, onDone }) {
  const toast = useToast();
  const { classes, sectionsFor } = useAcademic();
  const [form, setForm] = useState({ title: '', body: '', audience: 'all', class_id: '', section_id: '', priority: 'normal', send_email: false, send_sms: false, expires_at: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setForm({ title: '', body: '', audience: 'all', class_id: '', section_id: '', priority: 'normal', send_email: false, send_sms: false, expires_at: '' });
  }, [open]);

  const save = async () => {
    setBusy(true);
    try {
      const res = await post('/communication/announcements', {
        ...form,
        class_id: form.audience === 'class' ? form.class_id : null,
        section_id: form.audience === 'class' ? form.section_id || null : null,
        expires_at: form.expires_at || null,
      });
      toast.success('Announcement published', `Sent to ${res.recipients} people${res.queued ? ` · ${res.queued} queued for delivery` : ''}`);
      onDone?.();
      onClose();
    } catch (err) {
      toast.error('Could not publish', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New announcement" size="lg" busy={busy}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!form.title || !form.body || (form.audience === 'class' && !form.class_id)}>Publish</Button></>}>
      <Input label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <Textarea label="Message" rows={5} required value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
      <div className="field-row">
        <Select label="Audience" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} options={[
          { value: 'all', label: 'Everyone' }, { value: 'students', label: 'Students' }, { value: 'parents', label: 'Parents' },
          { value: 'teachers', label: 'Teachers' }, { value: 'staff', label: 'Staff' }, { value: 'class', label: 'A class' },
        ]} />
        <Select label="Priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} options={[{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }, { value: 'emergency', label: 'Emergency' }]} />
        <Input label="Expires on" type="date" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
      </div>
      {form.audience === 'class' ? (
        <div className="field-row">
          <Select label="Class" options={classes.map((c) => ({ value: c.id, label: c.name }))} value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value, section_id: '' })} />
          <Select label="Section" placeholder="Whole class" options={sectionsFor(form.class_id)} value={form.section_id} onChange={(e) => setForm({ ...form, section_id: e.target.value })} />
        </div>
      ) : null}
      <div className="row gap-3">
        <label className="checkbox"><input type="checkbox" checked={form.send_email} onChange={(e) => setForm({ ...form, send_email: e.target.checked })} /><span>Also send email</span></label>
        <label className="checkbox"><input type="checkbox" checked={form.send_sms} onChange={(e) => setForm({ ...form, send_sms: e.target.checked })} /><span>Also send SMS</span></label>
      </div>
    </Modal>
  );
}

function MessagesTab() {
  const toast = useToast();
  const { user } = useApp();
  const [threads, setThreads] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [thread, setThread] = useState(null);
  const [body, setBody] = useState('');
  const [compose, setCompose] = useState(false);
  const [contactQ, setContactQ] = useState('');
  const debounced = useDebounced(contactQ, 250);
  const [contacts, setContacts] = useState([]);
  const [composeForm, setComposeForm] = useState({ participant_id: '', subject: '', body: '' });
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  const loadThreads = () => get('/communication/threads').then((res) => {
    setThreads(res.items || []);
    if (!activeId && res.items?.length) setActiveId(res.items[0].id);
  }).catch(() => {});
  useEffect(() => { loadThreads(); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    if (!activeId) return;
    get(`/communication/threads/${activeId}`).then(setThread).catch(() => {});
  }, [activeId]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [thread]);
  useEffect(() => {
    if (!compose || debounced.trim().length < 2) { setContacts([]); return; }
    get('/communication/contacts', { q: debounced.trim() }).then((res) => setContacts(res.items || [])).catch(() => {});
  }, [debounced, compose]);

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      await post(`/communication/threads/${activeId}/messages`, { body: body.trim() });
      setBody('');
      const res = await get(`/communication/threads/${activeId}`);
      setThread(res);
      loadThreads();
    } catch (err) {
      toast.error('Could not send message', err.message);
    } finally {
      setSending(false);
    }
  };

  const startThread = async () => {
    setSending(true);
    try {
      const res = await post('/communication/threads', composeForm);
      toast.success('Message sent');
      setCompose(false);
      setComposeForm({ participant_id: '', subject: '', body: '' });
      await loadThreads();
      setActiveId(res.threadId);
    } catch (err) {
      toast.error('Could not start conversation', err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: '300px minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
      <Card flush title="Conversations" actions={<Button size="sm" variant="primary" icon="plus" onClick={() => setCompose(true)}>New</Button>}>
        {threads.length === 0 ? <EmptyState icon="messages" title="No conversations" text="Start a conversation with a teacher, parent or colleague." /> : (
          <div style={{ maxHeight: 520, overflow: 'auto' }}>
            {threads.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveId(t.id)}
                style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--line)', background: activeId === t.id ? 'var(--accent-soft)' : 'transparent', padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                <div className="row-between">
                  <span className="strong fs-13 truncate">{t.other_name || 'Conversation'}</span>
                  <span className="fs-12 muted nowrap">{relativeTime(t.last_at)}</span>
                </div>
                <div className="fs-12 muted truncate">{t.last_message || 'No messages yet'}</div>
                <div className="row gap-1 mt-1">
                  <Badge tone="outline">{t.other_role || 'user'}</Badge>
                  {t.unread ? <Badge tone="danger">{t.unread} new</Badge> : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card title={thread?.other?.full_name || 'Select a conversation'} subtitle={thread?.other?.designation || thread?.other?.role || ''} flush>
        {!thread ? <EmptyState icon="messages" title="Choose a conversation" /> : (
          <div style={{ display: 'flex', flexDirection: 'column', height: 520 }}>
            <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
              {(thread.messages || []).map((m) => {
                const mine = m.sender_id === user?.id;
                return (
                  <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
                    <div style={{ maxWidth: '72%', background: mine ? 'var(--accent)' : 'var(--bg-subtle)', color: mine ? '#fff' : 'inherit', padding: '9px 12px', borderRadius: 12, borderTopRightRadius: mine ? 3 : 12, borderTopLeftRadius: mine ? 12 : 3 }}>
                      <div style={{ fontSize: 13, whiteSpace: 'prewrap' }}>{m.body}</div>
                      <div style={{ fontSize: 10.5, opacity: 0.7, marginTop: 3 }}>{formatDateTime(m.created_at)}</div>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
            <div style={{ borderTop: '1px solid var(--line)', padding: 12 }} className="row gap-1">
              <input className="input grow" placeholder="Write a message…" value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
              <Button variant="primary" icon="send" loading={sending} onClick={send} disabled={!body.trim()}>Send</Button>
            </div>
          </div>
        )}
      </Card>

      <Modal open={compose} onClose={() => setCompose(false)} title="New message" size="sm" busy={sending}
        footer={<><Button variant="ghost" onClick={() => setCompose(false)}>Cancel</Button><Button variant="primary" loading={sending} onClick={startThread} disabled={!composeForm.participant_id || !composeForm.body}>Send</Button></>}>
        <SearchField value={contactQ} onChange={setContactQ} placeholder="Search people…" className="w-100" />
        {contacts.length ? (
          <div style={{ maxHeight: 170, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 9, margin: '8px 0' }}>
            {contacts.map((c) => (
              <div key={c.id} role="button" tabIndex={-1} className="search-result" style={{ background: composeForm.participant_id === c.id ? 'var(--accent-soft)' : undefined }} onClick={() => setComposeForm({ ...composeForm, participant_id: c.id })}>
                <Avatar name={c.full_name} size="sm" />
                <div><div className="strong fs-13">{c.full_name}</div><div className="fs-12 muted">{c.designation || c.role}</div></div>
              </div>
            ))}
          </div>
        ) : null}
        <Input label="Subject" value={composeForm.subject} onChange={(e) => setComposeForm({ ...composeForm, subject: e.target.value })} />
        <Textarea label="Message" rows={4} required value={composeForm.body} onChange={(e) => setComposeForm({ ...composeForm, body: e.target.value })} />
      </Modal>
    </div>
  );
}

function NotificationsTab() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const load = () => get('/communication/notifications', { limit: 60 }).then(setData).catch(() => setData({ items: [], unread: 0 }));
  useEffect(load, []);

  const markAll = async () => { await post('/communication/notifications/read-all'); load(); };
  const markOne =async (n) => { if (!n.read_at) { await post(`/communication/notifications/${n.id}/read`); load(); } };

  if (!data) return <Loading />;
  return (
    <Card title="Notifications" subtitle={`${data.unread} unread`} actions={<Button size="sm" variant="outline" icon="check" onClick={markAll} disabled={!data.unread}>Mark all read</Button>}>
      {data.items.length === 0 ? <EmptyState icon="bell" title="No notifications" /> : (
        <div>
          {data.items.map((n) => (
            <div key={n.id} className="file-row" style={{ background: n.read_at ? 'transparent' : 'var(--accent-soft)', padding: '9px 8px', borderRadius: 8 }} onClick={() => markOne(n)} role="presentation">
              <span className="file-icon"><Icon name={n.type === 'warning' ? 'alert' : n.type === 'success' ? 'check' : 'bell'} size={15} /></span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="fs-13 strong">{n.title}</div>
                <div className="fs-12 ink-2">{n.body}</div>
                <div className="fs-12 muted">{relativeTime(n.created_at)}</div>
              </div>
              <Button size="sm" variant="ghost" icon="trash" aria-label="Delete" onClick={async (e) => { e.stopPropagation(); await del(`/communication/notifications/${n.id}`); load(); }} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function Communication() {
  const { can } = useApp();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'announcements';
  const setTab = (value) => { const next = new URLSearchParams(params); next.set('tab', value); setParams(next, { replace: true }); };
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const limit = 15;

  const load = async () => {
    setLoading(true);
    try { setData(await get('/communication/announcements', { q: debounced, page, limit })); } catch (err) { toast.error('Could not load announcements', err.message); } finally { setLoading(false); }
  };
  useEffect(() => { if (tab === 'announcements') load(); /* eslint-disable-next-line */ }, [debounced, page, tab]);

  return (
    <div className="page">
      <PageHeader
        title="Communication"
        subtitle="Announcements, direct messages and notifications in one place."
        actions={can('communication.create') ? <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>New announcement</Button> : null}
      />
      <Card flush>
        <div style={{ padding: '0 14px' }}>
          <Tabs value={tab} onChange={setTab} tabs={[
            { value: 'announcements', label: 'Announcements' },
            { value: 'messages', label: 'Messages' },
            ...(can('communication.view') ? [{ value: 'notifications', label: 'Notifications' }] : []),
          ]} />
        </div>
        <div style={{ padding: 16 }}>
          {tab === 'announcements' ? (
            <>
              <div className="row row-wrap gap-1 mb-2">
                <SearchField value={q} onChange={setQ} placeholder="Search announcements…" />
                <span className="grow" />
                <span className="fs-12 muted">{data?.total || 0} announcements</span>
              </div>
              {loading ? <Loading /> : (data?.items || []).length === 0 ? <EmptyState icon="communication" title="No announcements" text="Publish an announcement to reach parents and staff instantly." /> : (
                <div className="stack-sm">
                  {data.items.map((a) => (
                    <div key={a.id} className="card card-pad" style={{ borderLeft: `3px solid ${a.priority === 'emergency' ? 'var(--danger)' : a.priority === 'high' ? 'var(--warning)' : 'var(--accent)'}` }}>
                      <div className="row-between">
                        <div className="row gap-1">
                          <strong>{a.title}</strong>
                          <Badge tone={a.priority === 'emergency' ? 'danger' : a.priority === 'high' ? 'warning' : 'outline'}>{a.priority}</Badge>
                          <Badge tone="outline">{a.audience === 'class' ? `${a.class_name || ''} ${a.section_name || ''}`.trim() : a.audience}</Badge>
                        </div>
                        <div className="row gap-1">
                          <span className="fs-12 muted">{formatDateTime(a.publish_at)}</span>
                          {can('communication.delete') ? (
                            <Button size="sm" variant="ghost" icon="trash" aria-label="Delete" onClick={async () => { if (!window.confirm(`Delete "${a.title}"?`)) return; try { await del(`/communication/announcements/${a.id}`); toast.success('Deleted'); load(); } catch (err) { toast.error('Could not delete', err.message); } }} />
                          ) : null}
                        </div>
                      </div>
                      <p className="fs-13 ink-2 prewrap" style={{ margin: '8px 0 4px' }}>{a.body}</p>
                      <div className="fs-12 muted">By {a.author_name || 'School'} · {a.send_email ? 'emailed' : ''}{a.send_sms ? ' · SMS' : ''}</div>
                    </div>
                  ))}
                </div>
              )}
              <Pagination page={page} pageCount={data?.pages || 1} total={data?.total || 0} pageSize={limit} onChange={setPage} />
            </>
          ) : null}
          {tab === 'messages' ? <MessagesTab /> : null}
          {tab === 'notifications' ? <NotificationsTab /> : null}
        </div>
      </Card>
      <AnnouncementModal open={open} onClose={() => setOpen(false)} onDone={load} />
    </div>
  );
}
