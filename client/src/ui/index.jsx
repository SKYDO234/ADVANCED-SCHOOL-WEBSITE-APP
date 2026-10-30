import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { assetUrl } from '../api.js';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';

/* --------------------------------- helpers -------------------------------- */

export const cx = (...parts) => parts.filter(Boolean).join(' ');

export const initials = (name = '') =>
  String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';

export function formatMoney(value, currency = '₹') {
  const num = Number(value || 0);
  return `${currency}${num.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: num % 1 ? 2 : 0 })}`;
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-IN');
}

export function formatDate(value, opts = { day: '2-digit', month: 'short', year: 'numeric' }) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(String(value).length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-IN', opts);
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${formatDate(date)} · ${date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
}

export function relativeTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (Number.isNaN(diff)) return '—';
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} d ago`;
  return formatDate(date);
}

/* --------------------------------- buttons -------------------------------- */

export function Button({ variant, size, icon, iconRight, loading, block, children, className = '', type = 'button', ...rest }) {
  const classes = [
    'btn',
    variant ? `btn-${variant}` : '',
    size ? `btn-${size}` : '',
    block ? 'btn-block' : '',
    !children ? 'btn-icon' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner" /> : icon ? <Icon name={icon} /> : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} /> : null}
    </button>
  );
}

export function IconButton({ icon, label, size, className = '', ...rest }) {
  return (
    <button type="button" className={cx('btn', 'btn-ghost', 'btn-icon', size && `btn-${size}`, className)} aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

/* ---------------------------------- cards --------------------------------- */

export function Card({ title, subtitle, actions, children, flush, className = '', footer, icon }) {
  return (
    <section className={cx('card', flush && 'card-flush', className)}>
      {(title || actions) && (
        <header className="card-head">
          <div style={{ minWidth: 0 }}>
            <h3 className="row gap-1">
              {icon ? <Icon name={icon} size={16} /> : null}
              {title}
            </h3>
            {subtitle ? <div className="muted fs-12" style={{ marginTop: 2 }}>{subtitle}</div> : null}
          </div>
          {actions ? <div className="row gap-1">{actions}</div> : null}
        </header>
      )}
      <div className={flush ? '' : 'card-body'}>{children}</div>
      {footer ? <footer className="card-foot">{footer}</footer> : null}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, breadcrumb }) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        {breadcrumb ? (
          <div className="breadcrumb">
            {breadcrumb.map((item, i) => (
              <span key={`${item.label}-${i}`} className="row gap-1">
                {i > 0 ? <Icon name="chevronRight" size={12} /> : null}
                {item.href ? <a href={item.href}>{item.label}</a> : <span>{item.label}</span>}
              </span>
            ))}
          </div>
        ) : null}
        <h1>{title}</h1>
        {subtitle ? <div className="page-sub">{subtitle}</div> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Section({ title, subtitle, children, style }) {
  return (
    <div className="section" style={style}>
      <div className="section-inner">
        {title ? (
          <div className="section-head">
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/* --------------------------------- badges --------------------------------- */

const STATUS_TONES = {
  active: 'success', present: 'success', paid: 'success', completed: 'success', published: 'success',
  issued: 'warning', partial: 'warning', pending: 'warning', late: 'warning', marks_entry: 'warning',
  overdue: 'danger', absent: 'danger', inactive: 'danger', failed: 'danger', cancelled: 'danger', rejected: 'danger',
  draft: 'outline', archived: 'outline', returned: 'info', upcoming: 'info', excused: 'info',
  half_day: 'info', leave: 'info', generated: 'info',
};

export function Badge({ children, tone, dot, icon, className = '' }) {
  const key = String(children || '').toLowerCase().replace(/\s+/g, '_');
  const variant = tone || STATUS_TONES[key] || 'outline';
  return (
    <span className={cx('badge', `badge-${variant}`, className)}>
      {dot ? <span className="dot" style={{ background: 'currentColor' }} /> : null}
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

export function StatusBadge({ status, labels }) {
  if (!status) return <span className="muted">—</span>;
  const text = labels?.[status] || String(status).replace(/_/g, ' ');
  return <Badge>{text}</Badge>;
}

export function Chip({ children, onRemove }) {
  return (
    <span className="chip">
      {children}
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label="Remove">
          <Icon name="close" size={13} />
        </button>
      ) : null}
    </span>
  );
}

/* --------------------------------- avatars -------------------------------- */

export function Avatar({ name, src, size }) {
  const cls = cx('avatar', size && `avatar-${size}`);
  if (src) return <img className={cls} src={assetUrl(src)} alt={name || ''} />;
  return <span className={cls} aria-hidden="true">{initials(name)}</span>;
}

export function Person({ name, sub, src, size, avatar }) {
  return (
    <div className="person">
      {avatar || <Avatar name={name} src={src} size={size} />}
      <div className="person-meta">
        <div className="person-name">{name || '—'}</div>
        {sub ? <div className="person-sub">{sub}</div> : null}
      </div>
    </div>
  );
}

/* ---------------------------------- stats --------------------------------- */

export function Stat({ label, value, icon, meta, tone, trend }) {
  return (
    <div className="stat">
      <div className="row-between">
        <span className="stat-label">{label}</span>
        {icon ? <span className="stat-icon" style={tone ? { color: tone } : undefined}><Icon name={icon} /></span> : null}
      </div>
      <div className="stat-value">{value}</div>
      {meta || trend ? (
        <div className="stat-meta">
          {trend ? <Icon name={trend > 0 ? 'trendUp' : 'trendDown'} size={13} /> : null}
          {meta}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------- forms --------------------------------- */

export function Field({ label, required, hint, error, children, htmlFor, className = '' }) {
  return (
    <div className={cx('field', className)}>
      {label ? (
        <label className="label" htmlFor={htmlFor}>
          {label}
          {required ? <IcoReq /> : null}
        </label>
      ) : null}
      {children}
      {error ? <div className="error-text">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

function IcoReq() {
  return <span className="req" aria-hidden="true">*</span>;
}

export function Input({ label, hint, error, required, id, className = '', ...rest }) {
  const autoId = useId();
  const inputId = id || autoId;
  const el = <input id={inputId} className={cx('input', error && 'invalid', className)} {...rest} />;
  if (!label && !hint && !error) return el;
  return <Field label={label} hint={hint} error={error} required={required} htmlFor={inputId}>{el}</Field>;
}

export function Textarea({ label, hint, error, required, id, className = '', rows = 3, ...rest }) {
  const autoId = useId();
  const inputId = id || autoId;
  const el = <textarea id={inputId} rows={rows} className={cx('textarea', error && 'invalid', className)} {...rest} />;
  if (!label && !hint && !error) return el;
  return <Field label={label} hint={hint} error={error} required={required} htmlFor={inputId}>{el}</Field>;
}

export function Select({ label, hint, error, required, id, options = [], placeholder, children, className = '', ...rest }) {
  const autoId = useId();
  const inputId = id || autoId;
  const el = (
    <select id={inputId} className={cx('select', error && 'invalid', className)} {...rest}>
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((opt) => {
        const value = typeof opt === 'string' ? opt : opt.value;
        const text = typeof opt === 'string' ? opt : opt.label;
        return <option key={String(value)} value={value}>{text}</option>;
      })}
      {children}
    </select>
  );
  if (!label && !hint && !error) return el;
  return <Field label={label} hint={hint} error={error} required={required} htmlFor={inputId}>{el}</Field>;
}

export function Checkbox({ label, ...rest }) {
  return (
    <label className="checkbox">
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}

export function Switch({ label, checked, onChange, ...rest }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange?.(e.target.checked, e)} {...rest} />
      <span className="switch-track" />
      {label ? <span>{label}</span> : null}
    </label>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          className={cx(value === opt.value && 'active')}
          onClick={() => onChange?.(opt.value)}
          role="tab"
          aria-selected={value === opt.value}
        >
          {opt.icon ? <Icon name={opt.icon} size={14} style={{ marginRight: 5, verticalAlign: '-2px' }} /> : null}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function SearchField({ value, onChange, placeholder = 'Search…', className = '', ...rest }) {
  return (
    <div style={{ position: 'relative', minWidth: 200 }} className={className}>
      <Icon name="search" size={15} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--ink-3)' }} />
      <input
        className="input"
        style={{ paddingLeft: 34 }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        {...rest}
      />
    </div>
  );
}

/* --------------------------------- tables --------------------------------- */

function compare(a, b) {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export function DataTable({ columns, rows = [], keyField = 'id', loading, error, empty, emptyTitle, emptyText, emptyIcon, sortable: enableSort, footer, rowProps, className = '' }) {
  const [sort, setSort] = useState(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const sortedRows = [...rows].sort((a, b) => compare(col.sortValue ? col.sortValue(a) : a[sort.key], col.sortValue ? col.sortValue(b) : b[sort.key]));
    return sort.dir === 'desc' ? sortedRows.reverse() : sortedRows;
  }, [rows, sort, columns]);

  if (loading) {
    return <div className="loading-row"><span className="spinner" /> Loading…</div>;
  }
  if (error) {
    return <Alert tone="danger" title="Could not load data">{error.message}</Alert>;
  }
  if (!rows.length) {
    return empty || <EmptyState icon={emptyIcon} title={emptyTitle || 'Nothing here yet'} text={emptyText} />;
  }

  return (
    <div className="table-wrap">
      <table className={cx('data', className)}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cx(col.align === 'num' && 'num', col.align === 'actions' && 'actions', enableSort && col.sortable !== false && 'sortable')}
                style={col.width ? { width: col.width } : undefined}
                onClick={
                  enableSort && col.sortable !== false
                    ? () => setSort((prev) => (prev?.key === col.key ? { key: col.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key: col.key, dir: 'asc' }))
                    : undefined
                }
              >
                {col.header}
                {sort?.key === col.key ? <span className="muted"> {sort.dir === 'asc' ? '↑' : '↓'}</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr key={row[keyField] ?? index} {...(rowProps ? rowProps(row) : {})}>
              {columns.map((col) => (
                <td key={col.key} className={cx(col.align === 'num' && 'num', col.align === 'actions' && 'actions')}>
                  {col.render ? col.render(row, index) : row[col.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {footer ? <div className="table-foot">{footer}</div> : null}
    </div>
  );
}

export function Pagination({ page, pageCount, total, pageSize, onChange }) {
  if (!pageCount || pageCount <= 1) {
    return total ? <div className="table-foot"><span className="muted fs-12">{formatNumber(total)} record{total === 1 ? '' : 's'}</span></div> : null;
  }
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total || page * pageSize);
  const pages = [];
  for (let i = 1; i <= pageCount; i += 1) {
    if (i === 1 || i === pageCount || Math.abs(i - page) <= 1) pages.push(i);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }
  return (
    <div className="table-foot row-between">
      <span className="muted fs-12">
        {total ? `${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(total)}` : `Page ${page}`}
      </span>
      <div className="row gap-1">
        <Button size="sm" variant="ghost" icon="chevronLeft" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page" />
        {pages.map((p, i) =>
          p === '…' ? <span key={`e${i}`} className="muted">…</span> : (
            <button key={p} type="button" className={cx('btn', 'btn-sm', p === page ? 'btn-primary' : 'btn-ghost')} onClick={() => onChange(p)}>
              {p}
            </button>
          ),
        )}
        <Button size="sm" variant="ghost" icon="chevronRight" disabled={page >= pageCount} onClick={() => onChange(page + 1)} aria-label="Next page" />
      </div>
    </div>
  );
}

/* -------------------------------- overlays -------------------------------- */

function useEscape(handler, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') handler(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handler, active]);
}

export function Modal({ open, onClose, title, subtitle, children, footer, size, closeOnOverlay = true, busy }) {
  const onCloseRef = useCallback(() => { if (!busy) onClose?.(); }, [onClose, busy]);
  useEscape(onCloseRef, open);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && closeOnOverlay) onCloseRef(); }}>
      <div className={cx('modal', size && `modal-${size}`)} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Dialog'}>
        <div className="modal-head">
          <div style={{ minWidth: 0 }}>
            <h3>{title}</h3>
            {subtitle ? <div className="modal-sub">{subtitle}</div> : null}
          </div>
          <button type="button" className="modal-close" onClick={onCloseRef} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, subtitle, children, footer, width }) {
  useEscape(onClose, open);
  if (!open) return null;
  return createPortal(
    <>
      <div className="overlay" style={{ placeItems: 'stretch', padding: 0 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }} />
      <aside className="drawer" style={width ? { width: `min(${width}, 100vw)` } : undefined} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle ? <div className="modal-sub">{subtitle}</div> : null}
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="modal-body" style={{ flex: 1 }}>{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </aside>
    </>,
    document.body,
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title = 'Are you sure?', message, confirmLabel = 'Confirm', tone = 'danger', busy, children }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      busy={busy}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={tone} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </>
      )}
    >
      <p className="ink-2" style={{ margin: '0 0 8px' }}>{message}</p>
      {children}
    </Modal>
  );
}

/* --------------------------------- menus ---------------------------------- */

export function Menu({ trigger, children, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div onClick={() => setOpen((v) => !v)} role="presentation">{trigger}</div>
      {open ? (
        <div className="menu" style={align === 'left' ? { right: 'auto', left: 0 } : undefined} onClick={() => setOpen(false)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({ icon, children, danger, ...rest }) {
  return (
    <button type="button" className={cx('menu-item', danger && 'danger')} {...rest}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

/* --------------------------------- states --------------------------------- */

export function EmptyState({ icon = 'file', title, text, action, children }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} /></span>
      <h4>{title}</h4>
      {text ? <p>{text}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
      {children}
    </div>
  );
}

export function Alert({ tone = 'info', title, children, action }) {
  const icons = { info: 'info', success: 'success', warning: 'alert', danger: 'alert' };
  return (
    <div className={cx('alert', `alert-${tone}`)}>
      <Icon name={icons[tone] || 'info'} />
      <div className="grow">
        {title ? <strong>{title}</strong> : null}
        {title && children ? ' ' : null}
        {children}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ size = 18 }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}

export function Loading({ label = 'Loading…' }) {
  return <div className="loading-row"><span className="spinner" /> {label}</div>;
}

export function Skeleton({ height = 14, width = '100%', style }) {
  return <div className="skeleton" style={{ height, width, ...style }} />;
}

export function TableSkeleton({ rows = 6 }) {
  return (
    <div style={{ padding: 16 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={34} style={{ marginBottom: 8 }} />
      ))}
    </div>
  );
}

export function Progress({ value, max = 100, tone, small, label }) {
  const pct = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0));
  return (
    <div>
      {label ? <div className="row-between fs-12 muted" style={{ marginBottom: 4 }}><span>{label}</span><span className="tnum">{Math.round(pct)}%</span></div> : null}
      <div className={cx('progress', small && 'progress-sm')} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%`, background: tone || undefined }} />
      </div>
    </div>
  );
}

/* ---------------------------------- tabs ---------------------------------- */

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          className={cx('tab', value === tab.value && 'active')}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.count !== undefined ? <span className="muted"> ({tab.count})</span> : null}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------- toasts ---------------------------------- */

const ToastCtx = createContext(null);
let toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const remove = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    clearTimeout(timers.current[id]);
    delete timers.current[id];
  }, []);

  const push = useCallback((tone, title, message, opts = {}) => {
    const id = ++toastId;
    setToasts((list) => [...list.slice(-4), { id, tone, title, message }]);
    const ms = opts.duration ?? (tone === 'error' ? 8000 : 4200);
    if (ms) timers.current[id] = setTimeout(() => remove(id), ms);
    return id;
  }, [remove]);

  const toast = useMemo(() => ({
    success: (title, message, opts) => push('success', title, message, opts),
    error: (title, message, opts) => push('error', title, message, opts),
    info: (title, message, opts) => push('info', title, message, opts),
    warning: (title, message, opts) => push('warning', title, message, opts),
  }), [push]);

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      {createPortal(
        <div className="toast-host" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={cx('toast', `toast-${t.tone}`)}>
              <span className="toast-icon"><Icon name={t.tone === 'error' || t.tone === 'warning' ? 'alert' : t.tone === 'success' ? 'check' : 'info'} size={13} /></span>
              <div className="toast-body">
                <div className="toast-title">{t.title}</div>
                {t.message ? <div className="toast-msg">{t.message}</div> : null}
              </div>
              <button type="button" className="toast-close" onClick={() => remove(t.id)} aria-label="Dismiss"><Icon name="close" size={14} /></button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

/* ------------------------------ misc helpers ------------------------------ */

export function Tiles({ items }) {
  return (
    <div className="tile-nav">
      {items.map((item) => (
        <a key={item.label} className="tile" href={item.href}>
          {item.icon ? <span className="t-icon"><Icon name={item.icon} /></span> : null}
          <span className="t-label">{item.label}</span>
          {item.meta ? <span className="t-meta">{item.meta}</span> : null}
        </a>
      ))}
    </div>
  );
}

export function KeyValue({ items, columns = 2 }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: '10px 18px' }}>
      {items.filter(Boolean).map((item, i) => (
        <div key={`${item.label}-${i}`}>
          <div className="fs-12 muted">{item.label}</div>
          <div className="strong" style={{ fontWeight: 560, fontSize: 13.6 }}>{item.value ?? '—'}</div>
        </div>
      ))}
    </div>
  );
}

export function FileDrop({ onFile, accept = 'image/*,application/pdf', label = 'Click or drop a file here', uploading, currentUrl }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  return (
    <div>
      <div
        className={cx('dropzone', drag && 'drag')}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
      >
        {uploading ? <span className="row" style={{ justifyContent: 'center' }}><span className="spinner" /> Uploading…</span> : (
          <span className="col" style={{ alignItems: 'center', gap: 6 }}>
            <Icon name="upload" size={20} />
            {label}
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = '';
          }}
        />
      </div>
      {currentUrl ? (
        <div className="file-row">
          <span className="file-icon"><Icon name="file" size={16} /></span>
          <a className="grow truncate" href={currentUrl} target="_blank" rel="noreferrer">{currentUrl.split('/').pop()}</a>
          <a className="btn btn-sm btn-ghost" href={currentUrl} target="_blank" rel="noreferrer"><Icon name="eye" /></a>
        </div>
      ) : null}
    </div>
  );
}
