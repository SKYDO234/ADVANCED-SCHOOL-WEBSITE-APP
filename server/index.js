import './env.js';
import app from './app.js';
import { db } from './db/index.js';
import { startSchedulers } from './lib/scheduler.js';

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`[school-erp] listening on http://${HOST}:${PORT}`);
  console.log(`[school-erp] db: ${db.file}`);
});

startSchedulers();

function shutdown(signal) {
  console.log(`\n[school-erp] ${signal} received, shutting down`);
  server.close(() => {
    try { db.close(); } catch { /* noop */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
