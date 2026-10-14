import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { h, notFound, badRequest } from '../lib/errors.js';
import { validateBody, validateQuery, getQuery } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { encrypt, decrypt, randomToken } from '../lib/crypto.js';
import { assertSafeWebhookUrl } from '../lib/ssrf.js';
import { WEBHOOK_EVENTS, retryDelivery } from '../lib/webhooks.js';
import { audit } from '../lib/audit.js';

export const webhooksRouter = Router();
webhooksRouter.use(requireAuth);

const epSchema = z.object({
  url: z.string().url().max(500),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(), // omitted = all events
  secret: z.string().min(16).max(100).optional(),
  active: z.boolean().optional(),
});

const serializeEndpoint = (e: {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: e.id,
  url: e.url,
  events: e.events,
  active: e.active,
  createdAt: e.createdAt.toISOString(),
  updatedAt: e.updatedAt.toISOString(),
});

webhooksRouter.get(
  '/',
  h(async (req, res) => {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { deliveries: true } } },
    });
    res.json({
      endpoints: endpoints.map((e) => ({
        ...serializeEndpoint(e),
        deliveryCount: e._count.deliveries,
      })),
      availableEvents: WEBHOOK_EVENTS,
    });
  })
);

webhooksRouter.post(
  '/',
  validateBody(epSchema),
  h(async (req, res) => {
    const url = assertSafeWebhookUrl(req.body.url);
    const secret = req.body.secret ?? randomBytes(24).toString('hex');
    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        userId: req.user!.id,
        url,
        secretEnc: encrypt(secret),
        events: req.body.events ?? [],
        active: req.body.active ?? true,
      },
    });
    await audit(req, 'webhook.create', endpoint.id, { url });
    // secret returned once for verifying signatures
    res.status(201).json({ endpoint: serializeEndpoint(endpoint), secret });
  })
);

webhooksRouter.patch(
  '/:id',
  validateBody(epSchema.partial()),
  h(async (req, res) => {
    const endpoint = await prisma.webhookEndpoint.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!endpoint) throw notFound('Endpoint not found');
    const data: Record<string, unknown> = {};
    if (req.body.url !== undefined) data.url = assertSafeWebhookUrl(req.body.url);
    if (req.body.events !== undefined) data.events = req.body.events;
    if (req.body.active !== undefined) data.active = req.body.active;
    const updated = await prisma.webhookEndpoint.update({ where: { id: endpoint.id }, data });
    await audit(req, 'webhook.update', endpoint.id);
    res.json({ endpoint: serializeEndpoint(updated) });
  })
);

webhooksRouter.post(
  '/:id/rotate-secret',
  h(async (req, res) => {
    const endpoint = await prisma.webhookEndpoint.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!endpoint) throw notFound('Endpoint not found');
    const secret = randomToken(24);
    await prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: { secretEnc: encrypt(secret) },
    });
    await audit(req, 'webhook.rotate_secret', endpoint.id);
    res.json({ endpoint: serializeEndpoint(endpoint), secret });
  })
);

webhooksRouter.delete(
  '/:id',
  h(async (req, res) => {
    const endpoint = await prisma.webhookEndpoint.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!endpoint) throw notFound('Endpoint not found');
    await prisma.webhookEndpoint.delete({ where: { id: endpoint.id } });
    await audit(req, 'webhook.delete', endpoint.id);
    res.json({ ok: true });
  })
);

// --- delivery logs ---------------------------------------------------------

const deliveryQuery = z.object({
  endpointId: z.string().optional(),
  status: z.enum(['PENDING', 'DELIVERED', 'FAILED']).optional(),
  event: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

webhooksRouter.get(
  '/deliveries',
  validateQuery(deliveryQuery),
  h(async (req, res) => {
    const q = getQuery<z.infer<typeof deliveryQuery>>(req);
    const deliveries = await prisma.webhookDelivery.findMany({
      where: {
        userId: req.user!.id,
        ...(q.endpointId ? { endpointId: q.endpointId } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.event ? { event: q.event } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: { endpoint: { select: { url: true } } },
    });
    res.json({
      deliveries: deliveries.map((d) => ({
        id: d.id,
        endpointId: d.endpointId,
        endpointUrl: d.endpoint.url,
        eventId: d.eventId,
        event: d.event,
        status: d.status,
        attempts: d.attempts,
        responseCode: d.responseCode,
        response: d.response,
        error: d.error,
        nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null,
        deliveredAt: d.deliveredAt?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
        payload: d.payload,
      })),
      nextCursor: deliveries.length === q.limit ? deliveries[deliveries.length - 1]?.id : null,
    });
  })
);

webhooksRouter.post(
  '/deliveries/:id/retry',
  h(async (req, res) => {
    const delivery = await prisma.webhookDelivery.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!delivery) throw notFound('Delivery not found');
    if (delivery.status === 'DELIVERED') throw badRequest('Delivery already succeeded');
    await retryDelivery(delivery.id);
    await audit(req, 'webhook.retry', delivery.id);
    res.json({ ok: true });
  })
);

/** show the signing secret for an endpoint (owner only, audited) */
webhooksRouter.get(
  '/:id/secret',
  h(async (req, res) => {
    const endpoint = await prisma.webhookEndpoint.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!endpoint) throw notFound('Endpoint not found');
    await audit(req, 'webhook.view_secret', endpoint.id);
    res.json({ secret: decrypt(endpoint.secretEnc) });
  })
);
