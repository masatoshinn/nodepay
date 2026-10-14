import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config.js';

export interface AccessPayload {
  sub: string;
  email: string;
  role: 'MERCHANT' | 'ADMIN';
  type: 'access';
}

export function signAccessToken(payload: Omit<AccessPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'access' }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessPayload;
  if (decoded.type !== 'access') throw new Error('wrong token type');
  return decoded;
}

export function signRefreshToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = crypto.randomBytes(48).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000);
  return { token, tokenHash, expiresAt };
}
