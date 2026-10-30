/**
 * Delete the local database (and optionally uploads). Use with care:
 *   npm run db:reset
 */
import fs from 'node:fs';
import path from 'node:path';
import { DB_FILE, DATA_DIR } from './index.js';

const args = process.argv.slice(2);
const onlyConfirm = args.includes('--yes') || args.includes('-y');

if (!onlyConfirm) {
  console.log('This will delete the local database:\n  ' + DB_FILE);
  console.log('\nRe-run with --yes to confirm:  npm run db:reset -- --yes');
  process.exit(0);
}

for (const suffix of ['', '-wal', '-shm']) {
  const file = DB_FILE + suffix;
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

if (args.includes('--uploads')) {
  const uploads = path.join(DATA_DIR, 'uploads');
  if (fs.existsSync(uploads)) fs.rmSync(uploads, { recursive: true, force: true });
  console.log('Uploads removed.');
}

console.log('Database reset. The next start will create an empty database and show the setup wizard.');
