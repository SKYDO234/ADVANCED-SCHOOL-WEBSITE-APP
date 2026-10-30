import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, UPLOAD_DIR, db, getSetting } from './db/index.js';
import { authenticate, requireAuth } from './lib/auth.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { clientIp } from './lib/auth.js';

import setupRoutes from './routes/setup.js';
import authRoutes from './routes/auth.js';
import metaRoutes from './routes/meta.js';
import userRoutes from './routes/users.js';
import academicRoutes from './routes/academics.js';
import studentRoutes from './routes/students.js';
import employeeRoutes from './routes/employees.js';
import attendanceRoutes from './routes/attendance.js';
import examRoutes from './routes/exams.js';
import feeRoutes from './routes/fees.js';
import libraryRoutes from './routes/library.js';
import transportRoutes from './routes/transport.js';
import homeworkRoutes from './routes/homework.js';
import communicationRoutes from './routes/communication.js';
import reportRoutes from './routes/reports.js';
import settingsRoutes from './routes/settings.js';
import dashboardRoutes from './routes/dashboard.js';
import portalRoutes from './routes/portal.js';
import websiteRoutes, { publicRouter } from './routes/website.js';
import webhookRoutes from './routes/webhooks.js';
import uploadRoutes from './routes/uploads.js';
import payrollRoutes from './routes/payroll.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(compression());
app.use(cookieParser());

/* ---------------------------------- CORS ---------------------------------- */
// Only needed when the SPA is hosted on a different origin (e.g. Netlify calling
// the API directly). With the Netlify proxy in `_redirects` requests stay
// same-origin and no CORS headers are required. Set CORS_ORIGINS to a
// comma-separated list of trusted origins (or "*") to enable it.
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || '')
  .split(',').map((origin) => origin.trim()).filter(Boolean);
if (CORS_ORIGINS.length) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (CORS_ORIGINS.includes('*') || CORS_ORIGINS.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
}

/* ------------------------------ rate limiting ----------------------------- */
const buckets = new Map();
export function rateLimit({ windowMs = 60_000, max = 60, key = (req) => clientIp(req) || 'anon', message = 'Too many requests. Please slow down.' } = {}) {
  return (req, res, next) => {
    const bucketKey = `${key(req)}:${Math.floor(Date.now() / windowMs)}`;
    const hits = (buckets.get(bucketKey) || 0) + 1;
    buckets.set(bucketKey, hits);
    if (buckets.size > 5000) buckets.clear();
    if (hits > max) return res.status(429).json({ error: message });
    next();
  };
}

/* ------------------------------- raw webhooks ----------------------------- */
app.use('/api/webhooks', express.raw({ type: '*/*', limit: '2mb' }), webhookRoutes);
app.use('/api', express.json({ limit: '2mb' }), express.urlencoded({ extended: true, limit: '2mb' }));

/* --------------------------------- public --------------------------------- */
app.use('/api/public', rateLimit({ windowMs: 60_000, max: 120 }), publicRouter);
app.use('/api/setup', setupRoutes);
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60_000, max: 30, key: (req) => `${clientIp(req)}:login` }));
app.use('/api/auth', authRoutes);

/* -------------------------------- protected ------------------------------- */
app.use('/api', authenticate);
app.use('/api', requireAuth);
app.use('/api/meta', metaRoutes);
app.use('/api/users', userRoutes);
app.use('/api/academics', academicRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/fees', feeRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/transport', transportRoutes);
app.use('/api/homework', homeworkRoutes);
app.use('/api/communication', communicationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/website', websiteRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/payroll', payrollRoutes);

app.use('/api', notFoundHandler);

/* ------------------------------ static assets ----------------------------- */
// Branding files are public (used on the login page); everything else needs a session.
const PUBLIC_UPLOADS = /^\/(branding|website)\//;
app.use('/uploads', (req, res, next) => {
  if (PUBLIC_UPLOADS.test(req.path)) return next();
  return authenticate(req, res, () => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    return next();
  });
}, express.static(UPLOAD_DIR, { maxAge: '7d', index: false }));

const clientDist = path.join(ROOT_DIR, 'client', 'dist');
const indexHtml = path.join(clientDist, 'index.html');
if (fs.existsSync(indexHtml)) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
    res.sendFile(indexHtml);
  });
} else {
  app.get('/', (_req, res) => {
    res.type('html').send(`<!doctype html><html><body style="font-family:system-ui;padding:40px;max-width:640px;margin:auto">
      <h1>School ERP API is running</h1>
      <p>The web client has not been built yet. Run <code>npm run build</code> then restart, or run the Vite dev server.</p>
      <p><a href="/api/setup/status">Setup status</a></p></body></html>`);
  });
}

app.use(errorHandler);

export default app;
