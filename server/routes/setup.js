import { Router } from 'express';
import { z } from 'zod';
import { db, newId, nowIso, tx } from '../db/index.js';
import { validateBody } from '../lib/validate.js';
import { hashPassword, passwordPolicy, validatePassword } from '../lib/auth.js';
import { bootstrapSchool, createAcademicSession, DEFAULT_THEME } from '../lib/defaults.js';
import { setSetting } from '../db/index.js';
import { badRequest, conflict } from '../lib/errors.js';
import { systemAudit } from '../lib/audit.js';
import { asyncHandler } from '../lib/errors.js';

const router = Router();

router.get('/status', (_req, res) => {
  const school = db.prepare('SELECT * FROM schools ORDER BY created_at LIMIT 1').get();
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  res.json({
    needsSetup: !school || userCount === 0,
    hasSchool: Boolean(school),
    school: school
      ? {
        id: school.id,
        name: school.name,
        logo_url: school.logo_url,
        tagline: school.tagline,
        is_demo: Boolean(school.is_demo),
        currency_symbol: school.currency_symbol,
      }
      : null,
    demo: Boolean(school?.is_demo),
    version: '1.0.0',
  });
});

const setupSchema = z.object({
  schoolName: z.string().min(2).max(120),
  schoolCode: z.string().min(2).max(20).regex(/^[A-Za-z0-9-]+$/, 'Use letters, numbers or dashes'),
  tagline: z.string().max(160).optional().default(''),
  address: z.string().max(240).optional().default(''),
  city: z.string().max(80).optional().default(''),
  state: z.string().max(80).optional().default(''),
  pincode: z.string().max(12).optional().default(''),
  phone: z.string().max(30).optional().default(''),
  email: z.string().email(),
  website: z.string().max(120).optional().default(''),
  affiliation: z.string().max(120).optional().default(''),
  currency: z.string().max(6).optional().default('INR'),
  currencySymbol: z.string().max(4).optional().default('₹'),
  timezone: z.string().max(60).optional().default('Asia/Kolkata'),
  sessionName: z.string().min(4).max(40),
  sessionStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sessionEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  principalName: z.string().min(2).max(120),
  principalEmail: z.string().email(),
  principalPassword: z.string().min(8).max(200),
  principalPhone: z.string().max(30).optional().default(''),
});

const runSetup = tx((data) => {
  const at = nowIso();
  const schoolId = newId('sch');
  db.prepare(
    `INSERT INTO schools (id, name, code, tagline, address, city, state, pincode, phone, email, website,
      affiliation, currency, currency_symbol, timezone, principal_name, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    schoolId, data.schoolName, data.schoolCode, data.tagline, data.address, data.city, data.state,
    data.pincode, data.phone, data.email, data.website, data.affiliation, data.currency,
    data.currencySymbol, data.timezone, data.principalName, at, at,
  );

  const { roleIds } = bootstrapSchool(schoolId);
  const sessionId = createAcademicSession(schoolId, {
    name: data.sessionName,
    start_date: data.sessionStart,
    end_date: data.sessionEnd,
    is_current: true,
  });

  const userId = newId('usr');
  db.prepare(
    `INSERT INTO users (id, school_id, email, password_hash, full_name, phone, role, role_id, designation, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    userId, schoolId, data.principalEmail.toLowerCase(), hashPassword(data.principalPassword),
    data.principalName, data.principalPhone, 'principal', roleIds.principal, 'Principal', 'active', at, at,
  );

  setSetting(schoolId, 'theme', 'config', DEFAULT_THEME);
  setSetting(schoolId, 'academic', 'currentSessionId', sessionId);

  systemAudit({
    schoolId, userId, actorName: data.principalName, action: 'setup', module: 'settings',
    summary: `School "${data.schoolName}" created`, meta: { sessionId },
  });

  return { schoolId, userId, sessionId };
});

router.post('/', validateBody(setupSchema), asyncHandler(async (req, res) => {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM schools').get().c;
  if (existing > 0) throw conflict('Setup has already been completed for this installation');
  const data = req.data;

  const policy = passwordPolicy('setup');
  const problems = validatePassword(data.principalPassword, { ...policy, minLength: 8 });
  if (problems.length) throw badRequest(problems.join('. '));

  if (new Date(data.sessionEnd) <= new Date(data.sessionStart)) {
    throw badRequest('Session end date must be after the start date');
  }

  const result = runSetup(data);
  res.status(201).json({
    ok: true,
    schoolId: result.schoolId,
    message: 'School created. You can now sign in as the principal.',
  });
}));

export default router;
