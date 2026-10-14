import type { RequestHandler } from 'express';
import { prisma } from '../lib/prisma.js';
import { unauthorized, forbidden } from '../lib/errors.js';
import { sha256, timingSafeEqual } from '../lib/crypto.js';

/**
 * Merchant API authentication.
 * Headers: X-API-Key: <publicKey>   X-API-Secret: <secret>
 * The stored secret is only kept as a SHA-256 hash (shown once at creation).
 */
export const requireApiKey: RequestHandler = async (req, _res, next) => {
  try {
    const publicKey = req.headers['x-api-key'];
    const secret = req.headers['x-api-secret'];
    if (typeof publicKey !== 'string' || typeof secret !== 'string') {
      throw unauthorized('X-API-Key and X-API-Secret headers are required');
    }
    const key = await prisma.apiKey.findUnique({ where: { publicKey } });
    if (!key || key.revokedAt) throw unauthorized('Invalid API key');
    if (!timingSafeEqual(sha256(secret), key.secretHash)) throw unauthorized('Invalid API secret');

    const user = await prisma.user.findUnique({ where: { id: key.userId } });
    if (!user) throw unauthorized('Invalid API key');
    if (user.status === 'SUSPENDED') throw forbidden('Account suspended');

    req.user = { id: user.id, email: user.email, role: user.role };
    req.apiKeyId = key.id;
    // fire-and-forget last-used stamp
    prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    next();
  } catch (e) {
    next(e);
  }
};
