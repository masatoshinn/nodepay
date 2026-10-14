import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import { prisma } from './prisma.js';
import { decrypt, hmac } from './crypto.js';
import { webhookQueue, WEBHOOK_MAX_ATTEMPTS } from './queues.js';

export const WEBHOOK_EVENTS = [
  'invoice.detected',
  'invoice.confirmed',
  'invoice.expired',
  'invoice.underpaid',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/**
 * Fan an event out to every active endpoint of the merchant.
 * Each (endpoint, eventId) pair is unique → duplicate emits are no-ops (replay protection).
 */
export async function emitEvent(userId: string, event: WebhookEvent, data: Record<string, unknown>) {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { userId, active: true, OR: [{ events: { has: event } }, { events: { isEmpty: true } }] },
  });
  if (!endpoints.length) return;

  const eventId = randomUUID();
  const payload = { id: eventId, event, createdAt: new Date().toISOString(), data };

  for (const ep of endpoints) {
    try {
      const delivery = await prisma.webhookDelivery.upsert({
        where: { endpointId_eventId: { endpointId: ep.id, eventId } },
        create: {
          endpointId: ep.id,
          userId,
          eventId,
          event,
          payload: payload as object,
          nextAttemptAt: new Date(),
        },
        update: {},
      });
      await webhookQueue.add(
        'deliver',
        { deliveryId: delivery.id },
        {
          attempts: WEBHOOK_MAX_ATTEMPTS,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 500,
          removeOnFail: false,
        }
      );
    } catch (e) {
      console.error('[webhook enqueue]', e);
    }
  }
}

/** HMAC-SHA256 signed body. Header format: t=<unix>,v1=<hex> — ts binding prevents replay. */
export function signPayload(body: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000).toString();
  return `t=${t},v1=${hmac(`${t}.${body}`, secret)}`;
}

/** Process one delivery job (called by worker). Throws on failure to trigger backoff. */
export async function processDelivery(job: Job<{ deliveryId: string }>) {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: job.data.deliveryId },
    include: { endpoint: true },
  });
  if (!delivery) return;
  if (delivery.status === 'DELIVERED') return;

  const attempts = delivery.attempts + 1;
  const body = JSON.stringify(delivery.payload);
  const secret = decrypt(delivery.endpoint.secretEnc);
  const started = Date.now();

  try {
    const res = await fetch(delivery.endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'NodePay-Webhooks/1.0',
        'X-BazilPay-Event': delivery.event,
        'X-BazilPay-Delivery': delivery.id,
        'X-BazilPay-Signature': signPayload(body, secret),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const text = (await res.text()).slice(0, 1000);
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        attempts,
        responseCode: res.status,
        response: text,
        status: res.ok ? 'DELIVERED' : undefined,
        deliveredAt: res.ok ? new Date() : undefined,
        error: res.ok ? null : `HTTP ${res.status}`,
        nextAttemptAt: res.ok ? null : new Date(Date.now() + backoffMs(attempts)),
      },
    });
    if (!res.ok) throw new Error(`endpoint responded ${res.status} in ${Date.now() - started}ms`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const final = job.attemptsMade + 1 >= (job.opts.attempts ?? WEBHOOK_MAX_ATTEMPTS);
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        attempts,
        error: message,
        status: final ? 'FAILED' : 'PENDING',
        nextAttemptAt: final ? null : new Date(Date.now() + backoffMs(attempts)),
      },
    });
    throw e;
  }
}

export function backoffMs(attempt: number): number {
  return Math.min(60_000 * 30, 5_000 * 2 ** Math.max(0, attempt - 1));
}

/** manual retry from the dashboard */
export async function retryDelivery(deliveryId: string) {
  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
  if (!delivery) throw new Error('delivery not found');
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: { status: 'PENDING', error: null, nextAttemptAt: new Date() },
  });
  await webhookQueue.add(
    'deliver',
    { deliveryId },
    { attempts: WEBHOOK_MAX_ATTEMPTS, backoff: { type: 'exponential', delay: 5_000 }, removeOnFail: false }
  );
}
