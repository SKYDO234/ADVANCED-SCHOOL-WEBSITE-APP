import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { UPLOAD_DIR } from '../db/index.js';
import { ApiError } from './errors.js';

const ALLOWED = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
]);

const SAFE_EXT = /\.(png|jpe?g|webp|gif|svg|pdf|docx?|xlsx?|pptx?|txt|csv)$/i;

function storageFor(bucket) {
  return multer.diskStorage({
    destination(_req, _file, cb) {
      const dir = path.join(UPLOAD_DIR, bucket);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req, file, cb) {
      const ext = (path.extname(file.originalname) || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      cb(null, `${stamp}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  });
}

function fileFilter(_req, file, cb) {
  if (!ALLOWED.has(file.mimetype) || !SAFE_EXT.test(file.originalname)) {
    return cb(new ApiError(415, `Unsupported file type: ${file.mimetype || file.originalname}`));
  }
  cb(null, true);
}

export function uploader(bucket = 'general', { maxMb = 10, multiple = false, field = 'file' } = {}) {
  const instance = multer({
    storage: storageFor(bucket),
    limits: { fileSize: maxMb * 1024 * 1024, files: multiple ? 8 : 1 },
    fileFilter,
  });
  return multiple ? instance.array(field, 8) : instance.single(field);
}

export function publicUrl(file) {
  if (!file) return null;
  const rel = path.relative(UPLOAD_DIR, file.path).split(path.sep).join('/');
  return `/uploads/${rel}`;
}

/** CSV parse that handles quoted fields, BOM, CRLF and both comma/semicolon. */
export function parseCsv(text) {
  const clean = String(text).replace(/^\uFEFF/, '');
  const delimiter = (clean.split('\n')[0].match(/;/g) || []).length > (clean.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  if (!header) return { headers: [], records: [] };
  const headers = header.map((h) => String(h).trim().toLowerCase().replace(/\s+/g, '_'));
  const records = body.map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? '').trim()])));
  return { headers, records };
}
