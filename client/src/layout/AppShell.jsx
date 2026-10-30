import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../store.jsx';
import { visibleNav } from '../nav.js';
import { api, assetUrl, post, useDebounced } from '../api.js';
import {
  Avatar, Button, Input, Menu, MenuItem, Modal, cx, initials, useToast,
} from '../ui/index.jsx';
import Icon from '../ui/Icon.jsx';

function ChangePasswordModal({ open, onClose }) {
  const toast = useToast();
  const { logout } = useApp();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.newPassword !== form.confirm) return setError('The new passwords do not match');
    setBusy(true);
    try {
      await post('/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      toast.success('Password updated', 'Other devices have been signed out.');
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change password"
      subtitle="Use at least 8 characters with letters and numbers."
      size="sm"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>Update password</Button>
        </>
      )}
    >
      <form onSubmit={submit}>
        <Input label="Current password" type="password" required value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} autoComplete="current-password" />
        <Input label="New password" type="password" required value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} autoComplete="new-password" />
        <Input label="Confirm new password" type="password" required value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} autoComplete="new-password" error={error} />
      </form>
    </Modal>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q, 280);
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const navigate = useNavigate();
  const boxRef = useRef(null);

  useEffect(() => {
    let alive = true;
    if (debounced.trim().length < 2) {
      setResults([]);
      return () => { alive = false; };
    }
    api('/meta/search', { params: { q: debounced.trim() } })
      .then((data) => { if (alive) { setResults(data.results || []); setCursor(0); } })
      .catch(() => { if (alive) setResults([]); });
    return () => { alive = false; };
  }, [debounced]);

  useEffect(() => {
    const onClick = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const go = (item) => {
    if (!item) return;
    navigate(item.to);
    setOpen(false);
    setQ('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => (c + 1) % results.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => (c - 1 + results.length) % results.length); }
    if (e.key === 'Enter') { e.preventDefault(); go(results[cursor]); }
  };

  return (
    <div className="topbar-search" ref={boxRef}>
      <Icon name="search" />
      <input
        className="input"
        placeholder="Search students, staff, invoices…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        aria-label="Global search"
      />
      {open && q.trim().length >= 2 ? (
        <div className="search-results">
          {results.length === 0 ? (
            <div className="empty" style={{ padding: 20 }}>
              <span className="fs-13">No matches for “{q}”</span>
            </div>
          ) : results.map((r, i) => (
            <div
              key={`${r.type}-${r.id}`}
              role="button"
              tabIndex={-1}
              className={cx('search-result', i === cursor && 'hl')}
              onMouseEnter={() => setCursor(i)}
              onClick={() => go(r)}
            >
              <Icon name={r.type === 'student' ? 'students' : r.type === 'employee' ? 'teachers' : r.type === 'invoice' ? 'invoices' : 'book'} size={16} />
              <div style={{ minWidth: 0 }}>
                <div className="strong truncate" style={{ fontWeight: 560 }}>{r.title}</div>
                <div className="fs-12 muted truncate">{r.subtitle}</div>
              </div>
              <span className="sr-type">{r.type}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function AppShell() {
  const { user, school, logout, mode, toggleMode, theme, meta } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const groups = useMemo(() => visibleNav(user), [user]);

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const title = useMemo(() => {
    const all = groups.flatMap((g) => g.items);
    const matches = all.filter((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)));
    matches.sort((a, b) => b.to.length - a.to.length);
    return matches[0]?.label || 'Workspace';
  }, [groups, location.pathname]);

  const unread = meta?.stats?.notifications || 0;
  const unreadMessages = meta?.stats?.unreadMessages || 0;

  return (
    <div className="shell">
      {mobileOpen ? <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} role="presentation" /> : null}
      <aside className={cx('sidebar', mobileOpen && 'open')}>
        <div className="sidebar-brand">
          <span className="brand-mark">
            {school?.logo_url ? <img src={assetUrl(school.logo_url)} alt="" /> : initials(school?.name || 'School')}
          </span>
          <div className="brand-text">
            <div className="brand-name">{school?.name || 'School ERP'}</div>
            <div className="brand-sub">{school?.tagline || 'Administration workspace'}</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {groups.map((group) => (
            <div className="nav-section" key={group.heading}>
              <div className="nav-heading">{group.heading}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => cx('nav-item', isActive && 'active')}
                >
                  <Icon name={item.icon} />
                  <span className="grow truncate">{item.label}</span>
                  {item.to === '/app/communication' && unread ? <span className="nav-badge">{unread > 9 ? '9+' : unread}</span> : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          {theme?.showPublicWebsite !== false ? (
            <Link to="/" className="nav-item" style={{ fontSize: 12.8 }}>
              <Icon name="globe" />
              <span>View public website</span>
            </Link>
          ) : null}
          <div className="fs-12" style={{ color: 'rgba(199,210,228,0.55)', padding: '8px 10px 2px' }}>
            v1.0 · {new Date().getFullYear()}
          </div>
        </div>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <button type="button" className="icon-btn only-mobile" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <span className="topbar-title hide-mobile">{title}</span>
          <GlobalSearch />
          <div className="topbar-actions">
            <button type="button" className="icon-btn" onClick={toggleMode} aria-label="Toggle dark mode" title="Toggle theme">
              <Icon name={mode === 'dark' ? 'sun' : 'moon'} />
            </button>
            <Link to="/app/communication?tab=notifications" className="icon-btn" aria-label="Notifications" title="Notifications">
              <Icon name="bell" />
              {unread ? <span className="count">{unread > 9 ? '9+' : unread}</span> : null}
            </Link>
            <Menu
              trigger={(
                <button type="button" className="profile-btn" aria-label="Account menu">
                  <Avatar name={user?.full_name} src={user?.avatar_url} size="sm" />
                  <span className="hide-mobile" style={{ textAlign: 'left' }}>
                    <span className="pname" style={{ display: 'block' }}>{user?.full_name}</span>
                    <span className="prole">{user?.designation || user?.role}</span>
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
              <MenuItem icon="key" onClick={() => setPwOpen(true)}>Change password</MenuItem>
              <MenuItem icon={mode === 'dark' ? 'sun' : 'moon'} onClick={toggleMode}>{mode === 'dark' ? 'Light mode' : 'Dark mode'}</MenuItem>
              {user?.role === 'principal' || (user?.permissions || []).includes('settings.view') ? (
                <MenuItem icon="settings" onClick={() => navigate('/app/settings')}>Settings</MenuItem>
              ) : null}
              {unreadMessages ? (
                <MenuItem icon="messages" onClick={() => navigate('/app/communication?tab=messages')}>Messages ({unreadMessages})</MenuItem>
              ) : null}
              <div className="menu-sep" />
              <MenuItem icon="logout" danger onClick={() => logout()}>Sign out</MenuItem>
            </Menu>
          </div>
        </header>

        <main className="grow">
          <Outlet />
        </main>
      </div>

      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}
