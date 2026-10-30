import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { db, getSetting, getAllSettings, setSetting, nowIso, newId } from '../db/index.js';
import { ApiError, badRequest } from './errors.js';

/* ----------------------------------- email ---------------------------------- */

export function emailConfig(schoolId) {
  return getAllSettings(schoolId, 'integrations').email || {};
}

export function isEmailConfigured(schoolId) {
  const cfg = emailConfig(schoolId);
  return Boolean(cfg.enabled && cfg.host && cfg.user && cfg.pass && cfg.fromEmail);
}

function mailTransport(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: Number(cfg.port || 587),
    secure: Boolean(cfg.secure),
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    connectionTimeout: 10_000,
  });
}

export async function sendEmailNow(schoolId, { to, subject, html, text }) {
  const cfg = emailConfig(schoolId);
  if (!isEmailConfigured(schoolId)) throw badRequest('Email is not configured. Add SMTP details in Settings → Integrations.');
  const transport = mailTransport(cfg);
  const info = await transport.sendMail({
    from: `"${cfg.fromName || 'School'}" <${cfg.fromEmail}>`,
    to,
    subject,
    text: text || undefined,
    html: html || undefined,
  });
  return info.messageId;
}

export async function verifyEmail(schoolId) {
  const cfg = emailConfig(schoolId);
  if (!cfg.host) throw badRequest('SMTP host is required');
  const transport = mailTransport(cfg);
  await transport.verify();
  return true;
}

/* ------------------------------------ sms ----------------------------------- */

export function smsConfig(schoolId) {
  return getAllSettings(schoolId, 'integrations').sms || {};
}

export function isSmsConfigured(schoolId) {
  const cfg = smsConfig(schoolId);
  return Boolean(cfg.enabled && cfg.provider && cfg.apiKey);
}

export async function sendSmsNow(schoolId, { to, message }) {
  const cfg = smsConfig(schoolId);
  if (!isSmsConfigured(schoolId)) throw badRequest('SMS is not configured. Add an SMS provider in Settings → Integrations.');
  const phone = String(to).replace(/\s/g, '');

  if (cfg.provider === 'twilio') {
    const body = new URLSearchParams({ To: phone, From: cfg.senderId || '', Body: message });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.apiKey}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) throw new Error(`Twilio responded ${res.status}: ${await res.text()}`);
    return 'twilio';
  }

  // Generic HTTP provider: url template with {{to}} and {{message}} placeholders.
  const url = String(cfg.apiUrl || '')
    .replace(/\{\{to\}\}/g, encodeURIComponent(phone))
    .replace(/\{\{message\}\}/g, encodeURIComponent(message))
    .replace(/\{\{sender\}\}/g, encodeURIComponent(cfg.senderId || ''))
    .replace(/\{\{apikey\}\}/g, encodeURIComponent(cfg.apiKey));
  if (!/^https?:\/\//i.test(url)) throw badRequest('SMS API URL must be an absolute http(s) URL');
  const res = await fetch(url, {
    method: cfg.method || 'GET',
    headers: cfg.authHeader ? { [cfg.authHeaderName || 'Authorization']: cfg.authHeader } : undefined,
  });
  if (!res.ok) throw new Error(`SMS provider responded ${res.status}`);
  return 'http';
}

/* --------------------------------- outbox ---------------------------------- */

export function enqueueMessage(schoolId, { channel, recipient, subject = null, body }) {
  if (!recipient) return null;
  const id = newId('out');
  db.prepare(
    'INSERT INTO outbox (id, school_id, channel, recipient, subject, body, status, created_at) VALUES (?,?,?,?,?,?,?,?)',
  ).run(id, schoolId, channel, recipient, subject, body, 'queued', nowIso());
  return id;
}

export async function processOutbox(schoolId, { limit = 20 } = {}) {
  const rows = db.prepare(
    "SELECT * FROM outbox WHERE school_id = ? AND status = 'queued' ORDER BY created_at LIMIT ?",
  ).all(schoolId, limit);
  if (!rows.length) return { processed: 0, sent: 0, failed: 0, skipped: 0 };
  const stats = { processed: 0, sent: 0, failed: 0, skipped: 0 };
  for (const row of rows) {
    stats.processed += 1;
    const configured = row.channel === 'email' ? isEmailConfigured(schoolId) : row.channel === 'sms' ? isSmsConfigured(schoolId) : false;
    if (!configured) {
      db.prepare("UPDATE outbox SET status='skipped', error=?, attempts=attempts+1 WHERE id=?").run(
        row.channel === 'push' ? 'Push requires a browser subscription (in-app notifications delivered instead)' : `${row.channel} provider not configured`,
        row.id,
      );
      stats.skipped += 1;
      continue;
    }
    try {
      if (row.channel === 'email') {
        await sendEmailNow(schoolId, { to: row.recipient, subject: row.subject, text: row.body, html: `<p>${String(row.body).replace(/\n/g, '<br/>')}</p>` });
      } else {
        await sendSmsNow(schoolId, { to: row.recipient, message: row.body });
      }
      db.prepare("UPDATE outbox SET status='sent', sent_at=?, attempts=attempts+1, error=NULL WHERE id=?").run(nowIso(), row.id);
      stats.sent += 1;
    } catch (err) {
      db.prepare("UPDATE outbox SET status='failed', error=?, attempts=attempts+1 WHERE id=?").run(String(err.message).slice(0, 400), row.id);
      stats.failed += 1;
    }
  }
  return stats;
}

/* --------------------------------- payments -------------------------------- */

export function paymentConfig(schoolId) {
  const cfg = getAllSettings(schoolId, 'payments').razorpay || {};
  return {
    provider: 'razorpay',
    enabled: Boolean(cfg.enabled),
    keyId: cfg.keyId || '',
    keySecretSet: Boolean(cfg.keySecret),
    webhookSecretSet: Boolean(cfg.webhookSecret),
    ...cfg,
  };
}

export function isGatewayReady(schoolId) {
  const cfg = getAllSettings(schoolId, 'payments').razorpay || {};
  return Boolean(cfg.enabled && cfg.keyId && cfg.keySecret);
}

export async function razorpayRequest(schoolId, path, { method = 'GET', body = null } = {}) {
  const cfg = getAllSettings(schoolId, 'payments').razorpay || {};
  if (!cfg.keyId || !cfg.keySecret) throw badRequest('Razorpay keys are not configured');
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(502, data?.error?.description || `Razorpay error ${res.status}`, data?.error || null);
  }
  return data;
}

export async function createRazorpayOrder(schoolId, { amount, receipt, notes }) {
  const amountPaise = Math.round(Number(amount) * 100);
  if (!Number.isFinite(amountPaise) || amountPaise < 100) throw badRequest('Amount must be at least 1.00');
  return razorpayRequest(schoolId, '/orders', {
    method: 'POST',
    body: { amount: amountPaise, currency: 'INR', receipt: String(receipt).slice(0, 40), notes: notes || {}, payment_capture: 1 },
  });
}

export async function fetchRazorpayPayment(schoolId, paymentId) {
  return razorpayRequest(schoolId, `/payments/${encodeURIComponent(paymentId)}`);
}

/** Razorpay checkout callback signature: HMAC_SHA256(`${order_id}|${payment_id}`, keySecret) */
export function verifyCheckoutSignature(schoolId, { orderId, paymentId, signature }) {
  const cfg = getAllSettings(schoolId, 'payments').razorpay || {};
  if (!cfg.keySecret) return false;
  const expected = crypto.createHmac('sha256', cfg.keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  return timingSafeEqual(expected, signature);
}

export function verifyWebhookSignature(schoolId, rawBody, signature) {
  const cfg = getAllSettings(schoolId, 'payments').razorpay || {};
  if (!cfg.webhookSecret) return false;
  const expected = crypto.createHmac('sha256', cfg.webhookSecret).update(rawBody).digest('hex');
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function maskSecret(value) {
  if (!value) return '';
  const str = String(value);
  return str.length <= 6 ? '••••••' : `${str.slice(0, 4)}••••${str.slice(-3)}`;
}

export { setSetting };
