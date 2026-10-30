import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, onUnauthorized, post } from './api.js';

const AppCtx = createContext(null);
const THEME_KEY = 'sm_theme_mode';

export function can(user, permission) {
  if (!user) return false;
  if (user.role === 'principal') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

export function canAny(user, permissions = []) {
  return permissions.some((p) => can(user, p));
}

export function applyTheme(theme, modeOverride) {
  const root = document.documentElement;
  const mode = modeOverride || theme?.mode || 'light';
  root.dataset.theme = mode;
  if (theme?.density) root.dataset.density = theme.density === 'compact' ? 'compact' : 'comfortable';
  if (theme?.accent) root.style.setProperty('--accent', theme.accent);
  if (theme?.accentSoft) root.style.setProperty('--accent-soft', theme.accentSoft);
  if (theme?.radius) root.style.setProperty('--radius', theme.radius);
  if (theme?.font) root.style.setProperty('--font', `"${theme.font}", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif`);
}

export function AppProvider({ children }) {
  const [status, setStatus] = useState('loading'); // loading | setup | anonymous | ready
  const [user, setUser] = useState(null);
  const [school, setSchool] = useState(null);
  const [theme, setThemeState] = useState({ mode: 'light', accent: '#1f3b73' });
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) || ''; } catch { return ''; }
  });
  const [meta, setMeta] = useState(null);
  const [publicSite, setPublicSite] = useState(null);
  const [setupStatus, setSetupStatus] = useState(null);
  const booted = useRef(false);

  const loadBootstrap = useCallback(async () => {
    const data = await api('/meta/bootstrap');
    setUser(data.user);
    setSchool(data.school);
    setThemeState({ ...(data.theme || {}), reportCard: data.theme?.reportCard });
    setMeta(data);
    setStatus('ready');
    return data;
  }, []);

  const loadPublic = useCallback(async () => {
    const [site, setup] = await Promise.all([
      api('/public/site').catch(() => null),
      api('/setup/status').catch(() => null),
    ]);
    if (site) setPublicSite(site);
    if (setup) setSetupStatus(setup);
    if (setup?.needsSetup) {
      setStatus('setup');
      return { site, setup };
    }
    setStatus('anonymous');
    return { site, setup };
  }, []);

  const boot = useCallback(async () => {
    try {
      await loadBootstrap();
    } catch (err) {
      if (err.status === 401) {
        setUser(null);
        setMeta(null);
        await loadPublic();
      } else {
        setStatus('anonymous');
      }
    } finally {
      booted.current = true;
    }
  }, [loadBootstrap, loadPublic]);

  useEffect(() => { boot(); }, [boot]);

  // Global 401 → session ended.
  useEffect(() => onUnauthorized(() => {
    setUser(null);
    setStatus('anonymous');
  }), []);

  // Keep the document theme in sync.
  useEffect(() => {
    applyTheme(theme, mode);
  }, [theme, mode]);

  // Document title / favicon branding.
  useEffect(() => {
    const name = school?.name || publicSite?.school?.name;
    if (name) document.title = `${name} · School ERP`;
    const favicon = school?.favicon_url || school?.logo_url;
    if (favicon) {
      let link = document.querySelector('link[rel="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = favicon;
    }
  }, [school, publicSite]);

  const login = useCallback(async (email, password, totp, schoolCode) => {
    const result = await post('/auth/login', { email, password, ...(totp ? { totp } : {}), ...(schoolCode ? { schoolCode } : {}) });
    await loadBootstrap();
    return result;
  }, [loadBootstrap]);

  const logout = useCallback(async () => {
    try { await post('/auth/logout'); } catch { /* ignore */ }
    setUser(null);
    setMeta(null);
    setStatus('anonymous');
    await loadPublic();
  }, [loadPublic]);

  const refresh = useCallback(async () => {
    try { return await loadBootstrap(); } catch { return null; }
  }, [loadBootstrap]);

  const setTheme = useCallback((next) => {
    setThemeState((prev) => ({ ...prev, ...next }));
  }, []);

  const toggleMode = useCallback(() => {
    setMode((prev) => {
      const current = prev || theme.mode || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, [theme.mode]);

  const value = useMemo(() => ({
    status,
    user,
    school: school || publicSite?.school || null,
    theme,
    mode: mode || theme.mode || 'light',
    meta,
    publicSite,
    setupStatus,
    permissions: user?.permissions || [],
    can: (perm) => can(user, perm),
    canAny: (perms) => canAny(user, perms),
    login,
    logout,
    refresh,
    setTheme,
    toggleMode,
    reloadPublic: loadPublic,
    setSetupStatus,
    setPublicSite,
    setStatus,
  }), [status, user, school, theme, mode, meta, publicSite, setupStatus, login, logout, refresh, setTheme, toggleMode, loadPublic]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

export function useAuthUser() {
  return useApp().user;
}

export function usePermission(permission) {
  const { user } = useApp();
  return can(user, permission);
}
