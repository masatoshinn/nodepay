import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { h, notFound, badRequest } from '../lib/errors.js';
import { validateBody } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { sha256 } from '../lib/crypto.js';
import { audit } from '../lib/audit.js';

export const apiKeysRouter = Router();
apiKeysRouter.use(requireAuth);

const serialize = (k: {
  id: string;
  name: string;
  publicKey: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}) => ({
  id: k.id,
  name: k.name,
  publicKey: k.publicKey,
  lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
  revokedAt: k.revokedAt?.toISOString() ?? null,
  createdAt: k.createdAt.toISOString(),
});

apiKeysRouter.get(
  '/',
  h(async (req, res) => {
    const keys = await prisma.apiKey.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ apiKeys: keys.map(serialize) });
  })
);

apiKeysRouter.post(
  '/',
  validateBody(z.object({ name: z.string().min(1).max(60) })),
  h(async (req, res) => {
    const publicKey = 'npk_' + randomBytes(16).toString('hex');
    const secret = 'nps_' + randomBytes(24).toString('base64url');
    const key = await prisma.apiKey.create({
      data: {
        userId: req.user!.id,
        name: req.body.name,
        publicKey,
        secretHash: sha256(secret),
      },
    });
    await audit(req, 'apikey.create', key.id);
    // secret is shown exactly once — only the hash is stored
    res.status(201).json({ apiKey: serialize(key), secret });
  })
);

apiKeysRouter.post(
  '/:id/regenerate',
  h(async (req, res) => {
    const key = await prisma.apiKey.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!key) throw notFound('API key not found');
    if (key.revokedAt) throw badRequest('Key is revoked');
    const secret = 'nps_' + randomBytes(24).toString('base64url');
    await prisma.apiKey.update({ where: { id: key.id }, data: { secretHash: sha256(secret) } });
    await audit(req, 'apikey.regenerate', key.id);
    res.json({ apiKey: serialize(key), secret });
  })
);

apiKeysRouter.delete(
  '/:id',
  h(async (req, res) => {
    const key = await prisma.apiKey.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!key) throw notFound('API key not found');
    await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
    await audit(req, 'apikey.revoke', key.id);
    res.json({ ok: true });
  })
);
