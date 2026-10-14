import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { prisma } from '../lib/prisma.js';
import { h, badRequest, unauthorized, conflict } from '../lib/errors.js';
import { signAccessToken, signRefreshToken } from '../lib/jwt.js';
import { encrypt, decrypt, sha256 } from '../lib/crypto.js';
import { validateBody } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { audit } from '../lib/audit.js';

export const authRouter = Router();
authenticator.options = { window: 1 };

const credentials = z.object({
  email: z.string().email().max(200).transform((s) => s.toLowerCase()),
  password: z.string().min(8).max(200),
});

function publicUser(u: {
  id: string;
  email: string;
  name: string | null;
  role: string;
  plan: string;
  totpEnabled: boolean;
  createdAt: Date;
  feeBps: number;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    plan: u.plan,
    totpEnabled: u.totpEnabled,
    feeBps: u.feeBps,
    createdAt: u.createdAt.toISOString(),
  };
}

async function issueTokens(user: { id: string; email: string; role: 'MERCHANT' | 'ADMIN' }) {
  const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  const { token, tokenHash, expiresAt } = signRefreshToken();
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });
  return { accessToken, refreshToken: token, refreshExpiresAt: expiresAt.toISOString() };
}

authRouter.post(
  '/signup',
  authLimiter,
  validateBody(credentials.extend({ name: z.string().max(100).optional() })),
  h(async (req, res) => {
    const { email, password, name } = req.body;
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) throw conflict('An account with this email already exists');
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({ data: { email, passwordHash, name } });
    const tokens = await issueTokens(user);
    await audit(req, 'auth.signup', user.id);
    res.status(201).json({ user: publicUser(user), ...tokens });
  })
);

authRouter.post(
  '/login',
  authLimiter,
  validateBody(credentials.extend({ totp: z.string().length(6).optional() })),
  h(async (req, res) => {
    const { email, password, totp } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    // constant-ish response to avoid user enumeration
    const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !ok) throw unauthorized('Invalid email or password');
    if (user.status === 'SUSPENDED') throw unauthorized('Account suspended');

    if (user.totpEnabled) {
      if (!totp) throw badRequest('2FA code required');
      const secret = decrypt(user.totpSecret!);
      if (!authenticator.verify({ token: totp, secret })) throw unauthorized('Invalid 2FA code');
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const tokens = await issueTokens(user);
    await audit(req, 'auth.login', user.id);
    res.json({ user: publicUser(user), ...tokens });
  })
);

authRouter.post(
  '/refresh',
  authLimiter,
  validateBody(z.object({ refreshToken: z.string().min(10) })),
  h(async (req, res) => {
    const tokenHash = sha256(req.body.refreshToken);
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw unauthorized('Invalid refresh token');
    }
    // rotation: revoke the used token
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    const tokens = await issueTokens(stored.user);
    res.json(tokens);
  })
);

authRouter.post(
  '/logout',
  h(async (req, res) => {
    const refreshToken = z.string().min(10).parse(req.body?.refreshToken);
    await prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    res.json({ ok: true });
  })
);

authRouter.get(
  '/me',
  requireAuth,
  h(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    res.json({ user: publicUser(user) });
  })
);

// ---------------------------------------------------------------------------
// TOTP 2FA
// ---------------------------------------------------------------------------

authRouter.post(
  '/2fa/setup',
  requireAuth,
  h(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (user.totpEnabled) throw badRequest('2FA already enabled');
    const secret = authenticator.generateSecret();
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: encrypt(secret) },
    });
    const otpauth = authenticator.keyuri(user.email, 'NodePay', secret);
    res.json({ secret, otpauth });
  })
);

authRouter.post(
  '/2fa/enable',
  requireAuth,
  validateBody(z.object({ code: z.string().length(6) })),
  h(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!user.totpSecret) throw badRequest('Run 2FA setup first');
    const secret = decrypt(user.totpSecret);
    if (!authenticator.verify({ token: req.body.code, secret })) throw badRequest('Invalid code');
    await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
    await audit(req, 'auth.2fa.enable');
    res.json({ ok: true });
  })
);

authRouter.post(
  '/2fa/disable',
  requireAuth,
  validateBody(z.object({ code: z.string().length(6) })),
  h(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!user.totpEnabled || !user.totpSecret) throw badRequest('2FA is not enabled');
    const secret = decrypt(user.totpSecret);
    if (!authenticator.verify({ token: req.body.code, secret })) throw badRequest('Invalid code');
    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: false, totpSecret: null },
    });
    await audit(req, 'auth.2fa.disable');
    res.json({ ok: true });
  })
);

// session list (security visibility)
authRouter.get(
  '/sessions',
  requireAuth,
  h(async (req, res) => {
    const sessions = await prisma.refreshToken.findMany({
      where: { userId: req.user!.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, expiresAt: true, ip: true, userAgent: true },
    });
    res.json({ sessions });
  })
);
