import fs from 'node:fs';
import path from 'node:path';
import { db, nowIso, newId, BACKUP_DIR, getSetting, getAllSettings } from '../db/index.js';
import { processOutbox, isEmailConfigured, isSmsConfigured } from './integrations.js';
import { applyLateFees } from './fees.js';

let timer = null;
let lastBackupCheck = 0;

async function tick() {
  try {
    const schools = db.prepare('SELECT id, name FROM schools WHERE is_active = 1').all();
    for (const school of schools) {
      if (isEmailConfigured(school.id) || isSmsConfigured(school.id)) {
        await processOutbox(school.id, { limit: 40 });
      }
    }
  } catch (err) {
    console.error('[scheduler] outbox error', err.message);
  }

  try {
    const schools = db.prepare('SELECT id FROM schools WHERE is_active = 1').all();
    for (const school of schools) applyLateFees(school.id);
  } catch (err) {
    console.error('[scheduler] late fee error', err.message);
  }

  // Automatic backups (at most one check per hour, honouring the configured interval).
  if (Date.now() - lastBackupCheck > 3_600_000) {
    lastBackupCheck = Date.now();
    try {
      autoBackup();
    } catch (err) {
      console.error('[scheduler] backup error', err.message);
    }
  }
}

function autoBackup() {
  const school = db.prepare("SELECT id FROM schools ORDER BY created_at LIMIT 1").get();
  if (!school) return;
  const retention = getAllSettings(school.id, 'retention');
  if (retention.autoBackupEnabled === false) return;
  const hours = Number(retention.backupEveryHours || 24);
  const last = db.prepare("SELECT created_at FROM backups ORDER BY created_at DESC LIMIT 1").get();
  if (last && Date.now() - new Date(last.created_at).getTime() < hours * 3_600_000) return;

  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const filename = `auto-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`;
  const target = path.join(BACKUP_DIR, filename);
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  const size = fs.statSync(target).size;
  db.prepare('INSERT INTO backups (id, school_id, filename, size, kind, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(newId('bak'), school.id, filename, size, 'scheduled', null, nowIso());

  // Keep the newest 30 scheduled backups.
  const scheduled = db.prepare("SELECT * FROM backups WHERE kind = 'scheduled' ORDER BY created_at DESC").all();
  scheduled.slice(30).forEach((b) => {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, b.filename));
    } catch { /* ignore */ }
    db.prepare('DELETE FROM backups WHERE id = ?').run(b.id);
  });
  console.log(`[scheduler] automatic backup created: ${filename}`);
}

export function startSchedulers() {
  if (timer) return timer;
  timer = setInterval(tick, 5 * 60_000);
  timer.unref?.();
  setTimeout(tick, 8_000).unref?.();
  console.log('[scheduler] background jobs started (outbox, late fees, backups)');
  return timer;
}

export function stopSchedulers() {
  if (timer) clearInterval(timer);
  timer = null;
}
