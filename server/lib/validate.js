import { z } from 'zod';
import { badRequest } from './errors.js';

/** Parse the JSON body and expose it as req.data. */
export const validateBody = (schema) => (req, _res, next) => {
  try {
    req.data = schema.parse(req.body ?? {});
    next();
  } catch (err) {
    next(err);
  }
};

export const validateQuery = (schema) => (req, _res, next) => {
  try {
    req.query = { ...req.query, ...schema.parse(req.query ?? {}) };
    next();
  } catch (err) {
    next(err);
  }
};

export const idSchema = z.string().min(1).max(64);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal('').transform(() => null));
export const money = z.coerce.number().min(0).max(100_000_000);

export function pagination(req, { defaultLimit = 25, maxLimit = 200 } = {}) {
  const rawLimit = Number(req.query.limit);
  const rawPage = Number(req.query.page);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : defaultLimit;
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  return { limit, page, offset: (page - 1) * limit };
}

const SAFE_SORT = /^[a-z_][a-z0-9_]*$/i;

function isSortable(col, allowed) {
  return SAFE_SORT.test(col) && (!allowed || allowed.includes(col));
}

export function sorting(req, allowed, fallback) {
  const col = typeof req.query.sort === 'string' && isSortable(req.query.sort, allowed) ? req.query.sort : fallback;
  const dir = String(req.query.dir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return { clause: `${col} ${dir}`, column: col, dir };
}

export function searchTerm(req) {
  const q = req.query.q ?? req.query.search;
  if (typeof q !== 'string') return null;
  const trimmed = q.trim();
  return trimmed.length ? trimmed : null;
}

export function requireField(condition, message) {
  if (!condition) throw badRequest(message);
}

export const json = (value, fallback) => {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

export const toBool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

export function csvEscape(value) {
  const str = value == null ? '' : String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}
