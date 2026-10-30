import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Absolute base URL of the API (no trailing slash).
 *
 * Local build / same-origin hosting: leave empty and requests go to `/api`.
 * Netlify: either proxy `/api` and `/uploads` to the API host (see netlify.toml
 * and scripts/netlify-redirects.mjs) or set VITE_API_BASE to an absolute API
 * origin such as `https://school-api.onrender.com` at build time.
 */
const ENV = (typeof import.meta !== 'undefined' && import.meta.env) || {};
export const API_BASE = String(ENV.VITE_API_BASE || '').replace(/\/+$/, '');

/** Resolve a stored file/asset URL (e.g. `/uploads/logo.png`) against the API host. */
export function assetUrl(url) {
  if (!url) return url;
  const value = String(url);
  if (/^(https?:)?\/\//.test(value) || value.startsWith('data:') || value.startsWith('blob:')) return value;
  return `${API_BASE}${value.startsWith('/') ? '' : '/'}${value}`;
}

const unauthorizedHandlers = new Set();
export function onUnauthorized(fn) {
  unauthorizedHandlers.add(fn);
  return () => unauthorizedHandlers.delete(fn);
}

export class ApiError extends Error {
  constructor(message, status, details, code) {
    super(message);
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

function buildQuery(params) {
  if (!params) return '';
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) value.forEach((v) => search.append(key, v));
    else search.set(key, String(value));
  });
  const str = search.toString();
  return str ? `?${str}` : '';
}

export async function api(path, { method = 'GET', body, formData, params, signal, raw = false } = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}/api${path}${buildQuery(params)}`;
  const headers = {};
  let payload;
  if (formData) payload = formData;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: payload, signal, credentials: 'include' });
  if (raw) return res;

  const contentType = res.headers.get('content-type') || '';
  let data = null;
  if (res.status !== 204) {
    if (contentType.includes('application/json')) {
      data = await res.json().catch(() => null);
    } else {
      data = await res.text();
    }
  }

  if (!res.ok) {
    if (res.status === 401) unauthorizedHandlers.forEach((fn) => fn(data));
    const message = (data && data.error) || `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data?.details, data?.code);
  }
  return data;
}

export const get = (path, params, opts) => api(path, { ...opts, params });
export const post = (path, body, opts) => api(path, { ...opts, method: 'POST', body });
export const patch = (path, body, opts) => api(path, { ...opts, method: 'PATCH', body });
export const put = (path, body, opts) => api(path, { ...opts, method: 'PUT', body });
export const del = (path, opts) => api(path, { ...opts, method: 'DELETE' });
export const upload = (path, file, params, fields = {}) => {
  const formData = new FormData();
  formData.append('file', file);
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null) formData.append(key, value);
  });
  return api(path, { method: 'POST', formData, params });
};

/** Open a file (PDF/CSV) response in a new tab. */
export function openFile(path, params) {
  window.open(`${API_BASE}/api${path}${buildQuery(params)}`, '_blank', 'noopener');
}

/** Trigger a browser download for a file endpoint. */
export async function downloadFile(path, params, filename) {
  const res = await api(path, { params, raw: true });
  if (!res.ok) {
    let msg = 'Download failed';
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new ApiError(msg, res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'download';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Data fetching hook with loading/error/reload and race-condition safety. */
export function useResource(path, params = null, { enabled = true, initial = null } = {}) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);
  const key = JSON.stringify(params ?? {});
  const mounted = useRef(true);
  const first = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async (silent = false) => {
    if (!path || !enabled) return null;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const result = await api(path, { params });
      if (mounted.current) setData(result);
      return result;
    } catch (err) {
      if (mounted.current && err.name !== 'AbortError') setError(err);
      return null;
    } finally {
      if (mounted.current) setLoading(false);
      first.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, enabled]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, enabled]);

  return { data, setData, loading, error, reload: load };
}

export function useDebounced(value, delay = 320) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useMutation() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (fn) => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);
  return { run, loading, error };
}
