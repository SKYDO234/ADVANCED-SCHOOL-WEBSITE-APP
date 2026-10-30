import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '../..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, 'data');
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
export const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'school.db');

for (const dir of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const raw = new DatabaseSync(DB_FILE);
raw.exec('PRAGMA journal_mode = WAL');
raw.exec('PRAGMA foreign_keys = ON');
raw.exec('PRAGMA busy_timeout = 5000');
raw.exec('PRAGMA synchronous = NORMAL');

/** Node's SQLite bindings only accept null/number/bigint/string/Uint8Array. */
function sanitize(args) {
  return args.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString();
    if (typeof p === 'object' && !(p instanceof Uint8Array)) return JSON.stringify(p);
    if (typeof p === 'number' && !Number.isFinite(p)) return null;
    return p;
  });
}

const stmtCache = new Map();
function prepare(sql) {
  let stmt = stmtCache.get(sql);
  if (!stmt) {
    stmt = raw.prepare(sql);
    if (stmtCache.size > 400) stmtCache.clear();
    stmtCache.set(sql, stmt);
  }
  return {
    run: (...args) => stmt.run(...sanitize(args)),
    get: (...args) => stmt.get(...sanitize(args)),
    all: (...args) => stmt.all(...sanitize(args)),
  };
}

let depth = 0;
/** Synchronous transaction with savepoint support for nesting. */
export function transaction(fn) {
  return (...args) => {
    const savepoint = depth > 0 ? `sp_${depth}` : null;
    raw.exec(savepoint ? `SAVEPOINT ${savepoint}` : 'BEGIN');
    depth += 1;
    try {
      const result = fn(...args);
      raw.exec(savepoint ? `RELEASE ${savepoint}` : 'COMMIT');
      return result;
    } catch (err) {
      try {
        raw.exec(savepoint ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
      } catch { /* ignore rollback errors */ }
      throw err;
    } finally {
      depth -= 1;
    }
  };
}

export const db = {
  exec: (sql) => raw.exec(sql),
  prepare,
  transaction,
  pragma: (statement) => raw.exec(`PRAGMA ${statement}`),
  get open() { return raw.isOpen; },
  close: () => raw.close(),
  file: DB_FILE,
};

/** Additive migration helper — adds a column to databases created before it existed. */
function ensureColumn(table, column, definition) {
  const columns = raw.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) {
    raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  raw.exec(sql);
  raw.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');

  // Users can sign in with an email address or a short username (e.g. `admin`).
  ensureColumn('users', 'username', 'TEXT');
  raw.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username ON users (school_id, lower(username))');

  return db;
}

migrate();

export function newId(prefix = 'id') {
  const rand = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
  return `${prefix}_${Date.now().toString(36)}${rand}`.slice(0, 40);
}

export function nowIso() {
  return new Date().toISOString();
}

export const tx = (fn) => transaction(fn);

export function getSetting(schoolId, category, key, fallback = null) {
  const row = db
    .prepare('SELECT value FROM settings WHERE school_id = ? AND category = ? AND key = ?')
    .get(schoolId, category, key);
  if (!row || row.value == null) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function getAllSettings(schoolId, category) {
  const rows = db
    .prepare('SELECT key, value FROM settings WHERE school_id = ? AND category = ?')
    .all(schoolId, category);
  const out = {};
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return out;
}

export function setSetting(schoolId, category, key, value, userId = null) {
  const exists = db
    .prepare('SELECT id FROM settings WHERE school_id = ? AND category = ? AND key = ?')
    .get(schoolId, category, key);
  const payload = typeof value === 'string' ? value : JSON.stringify(value);
  if (exists) {
    db.prepare('UPDATE settings SET value = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(
      payload, userId, nowIso(), exists.id,
    );
  } else {
    db.prepare(
      'INSERT INTO settings (id, school_id, category, key, value, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)',
    ).run(newId('set'), schoolId, category, key, payload, userId, nowIso());
  }
}

export default db;
