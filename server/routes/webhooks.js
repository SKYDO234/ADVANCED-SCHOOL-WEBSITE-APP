import { Router } from 'express';
import { db, nowIso } from '../db/index.js';
import { verifyWebhookSignature } from '../lib/integrations.js';
import { applySuccessfulPayment } from '../lib/fees.js';
import { systemAudit } from '../lib/audit.js';

const router = Router();

/**
 * Razorpay webhook receiver.
 * Signature is verified against the RAW body using the school's webhook secret.
 * Payments are only ever marked successful from this server-side path (or the
 * equivalent server-side verification endpoint) — never from a browser response.
 */
router.post('/razorpay', (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  const event = safeJson(rawBody);

  if (!event) return res.status(400).json({ error: 'Invalid JSON payload' });

  const orderId = event?.payload?.payment?.entity?.order_id
    || event?.payload?.order?.entity?.id
    || null;
  const paymentEntity = event?.payload?.payment?.entity || null;

  const localPayment = orderId
    ? db.prepare('SELECT * FROM payments WHERE gateway_order_id = ?').get(orderId)
    : (paymentEntity?.id ? db.prepare('SELECT * FROM payments WHERE gateway_payment_id = ?').get(paymentEntity.id) : null);
  if (!localPayment) {
    return res.status(202).json({ ok: true, ignored: 'unknown order' });
  }

  if (!verifyWebhookSignature(localPayment.school_id, rawBody, signature)) {
    systemAudit({
      schoolId: localPayment.school_id, actorName: 'razorpay', action: 'webhook_rejected',
      module: 'fees', summary: 'Rejected Razorpay webhook with invalid signature',
      meta: { event: event.event, orderId },
    });
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const eventName = String(event.event || '');
  if (eventName === 'payment.captured' || eventName === 'order.paid') {
    applySuccessfulPayment({
      paymentId: localPayment.id,
      gatewayPaymentId: paymentEntity?.id || localPayment.gateway_payment_id,
      rawPayload: event,
      source: 'webhook',
    });
    return res.json({ ok: true, status: 'captured' });
  }

  if (eventName === 'payment.failed') {
    db.prepare("UPDATE payments SET status = 'failed', failure_reason = ?, raw = ?, updated_at = ? WHERE id = ?")
      .run(paymentEntity?.error_description || 'Gateway reported failure', JSON.stringify(event).slice(0, 4000), nowIso(), localPayment.id);
    systemAudit({
      schoolId: localPayment.school_id, actorName: 'razorpay', action: 'payment_failed', module: 'fees',
      summary: `Gateway payment ${paymentEntity?.id} failed`,
    });
    return res.json({ ok: true, status: 'failed' });
  }

  return res.json({ ok: true, ignored: eventName });
});

function safeJson(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return null;
  }
}

export default router;
