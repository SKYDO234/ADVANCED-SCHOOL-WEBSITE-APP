import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, patch, post, put, useDebounced, useResource } from '../api.js';
import { useApp } from '../store.jsx';
import {
  Alert, Avatar, Badge, Button, Card, Checkbox, DataTable, EmptyState, Input, Loading, Modal, PageHeader, Pagination,
  SearchField, Select, StatusBadge, Tabs, Textarea, formatDateTime, relativeTime, useToast,
} from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';

function CreateUserModal({ open, onClose, onDone, roles }) {
  const toast = useToast();
  const [form, setForm] = useState({ full_name: '', email: '', username: '', role: 'teacher', role_id: '', department: '', designation: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);

  useEffect(() => {
    if (open) { setError(''); setCreated(null); setForm({ full_name: '', email: '', username: '', role: 'teacher', role_id: '', department: '', designation: '', password: '' }); }
  }, [open]);

  const save = async () => {
    setBusy(true);
    try {
      const res = await post('/users', { ...form, username: form.username || undefined, role_id: form.role_id || null, password: form.password || undefined });
      setCreated(res);
      toast.success('Account created');
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <Modal open={open} onClose={() => { setCreated(null); onClose(); }} title="Account created" size="sm" footer={<Button variant="primary" onClick={() => { setCreated(null); onClose(); }}>Done</Button>}>
        <Alert tone="success" title="Share these credentials">
          <div className="stack-sm mt-2">
            <div className="row-between"><span>Email</span><strong>{form.email}</strong></div>
            <div className="row-between"><span>Temporary password</span><strong>{created.temporaryPassword || created.password || '(set by admin)'}</strong></div>
          </div>
        </Alert>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a user account"
      subtitle="Use roles to control what each person can see and do."
      size="sm"
      busy={busy}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!form.full_name || !form.email}>Create account</Button></>}
    >
      {error ? <div className="mb-2"><Alert tone="danger">{error}</Alert></div> : null}
      <Input label="Full name" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
      <div className="field-row">
        <Input label="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Input label="Username (optional)" placeholder="e.g. priya.sharma" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') })} hint="Lets this person sign in without typing an email" />
      </div>
      <div className="field-row">
        <Select
          label="Role"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value, role_id: roles.find((r) => r.base_role === e.target.value)?.id || '' })}
          options={[{ value: 'teacher', label: 'Teacher' }, { value: 'staff', label: 'Staff' }, { value: 'student', label: 'Student' }, { value: 'parent', label: 'Parent' }, ...(roles.some((r) => r.base_role === 'principal') ? [{ value: 'principal', label: 'Principal' }] : [])]}
        />
        <Select label="Custom role" placeholder="Base role permissions" options={roles.filter((r) => !r.is_system).map((r) => ({ value: r.id, label: r.name }))} value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })} />
      </div>
      <div className="field-row">
        <Input label="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
        <Input label="Designation" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
      </div>
      <Input label="Initial password" placeholder="Leave blank to auto-generate" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
    </Modal>
  );
}

function PermissionsModal({ user, onClose, catalog, onSaved }) {
  const toast = useToast();
  const [state, setState] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    get(`/users/${user.id}`).then((res) => {
      const overrides = {};
      (res.overrides || []).forEach((o) => { overrides[o.permission] = o.allowed ? 'allow' : 'deny'; });
      setState({ ...res, overrides });
    }).catch(() => {});
  }, [user]);

  const cycle = (permission) => setState((prev) => {
    const current = prev.overrides?.[permission] || 'default';
    const next = current === 'default' ? 'allow' : current === 'allow' ? 'deny' : 'default';
    return { ...prev, overrides: { ...prev.overrides, [permission]: next } };
  });

  const save = async () => {
    setBusy(true);
    try {
      const overrides = Object.entries(state.overrides || {})
        .filter(([, v]) => v !== 'default')
        .map(([permission, v]) => ({ permission, allowed: v === 'allow' }));
      await put(`/users/${user.id}/permissions`, { overrides });
      toast.success('Permissions updated');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error('Could not save', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title={`Permissions · ${user?.full_name || ''}`}
      subtitle="Role permissions apply by default. Grant or deny individual permissions to override."
      size="xl"
      busy={busy}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save permissions</Button></>}
    >
      {!state.role ? <Loading /> : (
        <>
          <Alert tone="info">Current role: <strong>{state.role_name || state.role}</strong>. Click a permission to cycle default → allow → deny.</Alert>
          <div className="mt-3" style={{ maxHeight: '55vh', overflow: 'auto' }}>
            {catalog.map((module) => (
              <div key={module.module} className="mb-2">
                <div className="fs-12 muted strong" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>{module.label}</div>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 4 }}>
                  {module.perms.map(([action, label]) => {
                    const permission = `${module.module}.${action}`;
                    const value = state.overrides?.[permission] || 'default';
                    return (
                      <button
                        key={permission}
                        type="button"
                        className="row-between"
                        onClick={() => cycle(permission)}
                        style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '5px 9px', background: value === 'allow' ? 'var(--success-bg)' : value === 'deny' ? 'var(--danger-bg)' : 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: 12.6 }}
                      >
                        <span>{label}</span>
                        <span className="fs-12 muted">{value === 'default' ? 'role' : value}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

function RoleEditor({ open, role, catalog, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', key: '', base_role: 'staff', description: '', permissions: [] });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(role ? { name: role.name, key: role.key, base_role: role.base_role, description: role.description || '', permissions: role.permissions || [] } : { name: '', key: '', base_role: 'staff', description: '', permissions: [] });
  }, [open, role]);

  const toggle = (permission) => setForm((prev) => ({
    ...prev,
    permissions: prev.permissions.includes(permission) ? prev.permissions.filter((p) => p !== permission) : [...prev.permissions, permission],
  }));

  const save = async () => {
    setBusy(true);
    try {
      if (role) await patch(`/users/meta/roles/${role.id}`, form);
      else await post('/users/meta/roles', form);
      toast.success(role ? 'Role updated' : 'Role created');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error('Could not save role', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={role ? `Edit role · ${role.name}` : 'Create a custom role'} size="lg" busy={busy}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!form.name || !form.key}>Save role</Button></>}>
      <div className="field-row">
        <Input label="Role name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label="Key" required disabled={Boolean(role)} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })} hint="Lowercase identifier, e.g. accountant" />
        <Select label="Base role" value={form.base_role} onChange={(e) => setForm({ ...form, base_role: e.target.value })} options={[{ value: 'teacher', label: 'Teacher' }, { value: 'staff', label: 'Staff' }, { value: 'student', label: 'Student' }, { value: 'parent', label: 'Parent' }]} />
      </div>
      <Textarea label="Description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <div style={{ maxHeight: '46vh', overflow: 'auto' }}>
        {catalog.map((module) => (
          <div key={module.module} className="mb-2">
            <div className="row-between">
              <span className="fs-12 muted strong" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>{module.label}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
                const all = module.perms.map(([a]) => `${module.module}.${a}`);
                const hasAll = all.every((p) => form.permissions.includes(p));
                setForm((prev) => ({ ...prev, permissions: hasAll ? prev.permissions.filter((p) => !all.includes(p)) : [...new Set([...prev.permissions, ...all])] }));
              }}>{module.perms.every(([a]) => form.permissions.includes(`${module.module}.${a}`)) ? 'Clear all' : 'Select all'}</button>
            </div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 2 }}>
              {module.perms.map(([action, label]) => {
                const permission = `${module.module}.${action}`;
                return (
                  <Checkbox key={permission} label={label} checked={form.permissions.includes(permission)} onChange={() => toggle(permission)} />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export default function Users() {
  const { can, user: me } = useApp();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'users';
  const setTab = (value) => { const next = new URLSearchParams(params); next.set('tab', value); setParams(next, { replace: true }); };
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [permUser, setPermUser] = useState(null);
  const [roleEditor, setRoleEditor] = useState(null);
  const { data: rolesData, reload: reloadRoles } = useResource('/users/meta/roles');
  const limit = 25;
  const roles = rolesData?.items || [];
  const catalog = rolesData?.catalog || [];

  const load = async () => {
    setLoading(true);
    try {
      setData(await get('/users', { q: debounced, role, page, limit }));
    } catch (err) {
      toast.error('Could not load users', err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [debounced, role, page]);

  const toggleStatus = async (row) => {
    try {
      await post(`/users/${row.id}/status`, { status: row.status === 'active' ? 'suspended' : 'active' });
      toast.success(`Account ${row.status === 'active' ? 'suspended' : 'reactivated'}`);
      load();
    } catch (err) {
      toast.error('Could not update account', err.message);
    }
  };

  const resetPassword = async (row) => {
    try {
      const res = await post(`/users/${row.id}/reset-password`, {});
      toast.success('Password reset', `Temporary password: ${res.temporaryPassword}`);
    } catch (err) {
      toast.error('Could not reset password', err.message);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Users & roles"
        subtitle="Every person who can sign in, and exactly what they are allowed to do."
        actions={can('settings.users') ? <Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>Create account</Button> : null}
      />

      <Card flush>
        <div style={{ padding: '0 14px' }}>
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'users', label: 'User accounts' }, { value: 'roles', label: 'Roles & permissions', count: roles.length }]} />
        </div>
        <div style={{ padding: 16 }}>
          {tab === 'users' ? (
            <>
              <div className="row row-wrap gap-1 mb-2">
                <SearchField value={q} onChange={setQ} placeholder="Name, email, phone…" />
                <select className="select" style={{ width: 'auto' }} value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="">All roles</option>
                  {['principal', 'teacher', 'staff', 'student', 'parent'].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <span className="grow" />
                <span className="fs-12 muted">{data?.total || 0} accounts</span>
              </div>
              <DataTable
                loading={loading}
                rows={data?.items || []}
                columns={[
                  { key: 'full_name', header: 'User', render: (r) => (<div className="person"><Avatar name={r.full_name} src={r.avatar_url} size="sm" /><div className="person-meta"><div className="person-name">{r.full_name}{r.id === me?.id ? ' (you)' : ''}</div><div className="person-sub">{r.email}</div></div></div>) },
                  { key: 'role', header: 'Role', render: (r) => <Badge tone={r.role === 'principal' ? 'accent' : 'outline'}>{r.role_name || r.role}</Badge> },
                  { key: 'last_login_at', header: 'Last sign in', render: (r) => (r.last_login_at ? relativeTime(r.last_login_at) : <span className="muted">Never</span>) },
                  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                  {
                    key: 'actions',
                    header: '',
                    align: 'actions',
                    render: (r) => (
                      <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                        {can('settings.permissions') && r.role !== 'principal' ? <Button size="sm" variant="ghost" onClick={() => setPermUser(r)}>Permissions</Button> : null}
                        {can('settings.users') && r.id !== me?.id ? (
                          <>
                            <Button size="sm" variant="ghost" icon="key" onClick={() => resetPassword(r)} aria-label="Reset password" />
                            <Button size="sm" variant="ghost" onClick={() => toggleStatus(r)}>{r.status === 'active' ? 'Suspend' : 'Activate'}</Button>
                          </>
                        ) : null}
                      </div>
                    ),
                  },
                ]}
                emptyTitle="No accounts"
                footer={<Pagination page={page} pageCount={data?.pages || 1} total={data?.total || 0} pageSize={limit} onChange={setPage} />}
              />
            </>
          ) : null}

          {tab === 'roles' ? (
            <>
              <div className="row-between mb-2">
                <span className="fs-13 muted">Roles bundle permissions. Users inherit their role and can be granted or denied extras.</span>
                {can('settings.permissions') ? <Button size="sm" variant="primary" icon="plus" onClick={() => setRoleEditor({ new: true })}>New role</Button> : null}
              </div>
              {roles.length === 0 ? <Loading /> : (
                <div className="grid grid-2">
                  {roles.map((r) => (
                    <Card key={r.id} title={r.name} subtitle={`${r.userCount} user(s) · ${r.permissions.length} permissions`} actions={<Badge tone={r.is_system ? 'outline' : 'accent'}>{r.is_system ? 'system' : 'custom'}</Badge>}>
                      <p className="fs-13 ink-2" style={{ marginTop: 0 }}>{r.description || 'No description'}</p>
                      <div className="row row-wrap gap-1">
                        {r.permissions.slice(0, 8).map((p) => <Badge key={p} tone="outline">{p}</Badge>)}
                        {r.permissions.length > 8 ? <Badge tone="outline">+{r.permissions.length - 8}</Badge> : null}
                      </div>
                      <div className="row gap-1 mt-2">
                        {can('settings.permissions') ? <Button size="sm" variant="outline" icon="edit" onClick={() => setRoleEditor(r)}>Edit permissions</Button> : null}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
      </Card>

      <CreateUserModal open={createOpen} roles={roles} onClose={() => setCreateOpen(false)} onDone={load} />
      <PermissionsModal user={permUser} catalog={catalog} onClose={() => setPermUser(null)} onSaved={load} />
      <RoleEditor open={!!roleEditor} role={roleEditor?.new ? null : roleEditor} catalog={catalog} onClose={() => setRoleEditor(null)} onSaved={reloadRoles} />
    </div>
  );
}
