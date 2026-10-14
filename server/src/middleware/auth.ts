import type { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { unauthorized, forbidden } from '../lib/errors.js';
import type { Role, User } from '@prisma/client';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; email: string; role: Role };
      authUser?: User;
      apiKeyId?: string;
    }
  }
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized('Missing access token');
    const payload = verifyAccessToken(header.slice(7));
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw unauthorized('Invalid token');
    if (user.status === 'SUSPENDED') throw forbidden('Account suspended');
    req.user = { id: user.id, email: user.email, role: user.role };
    req.authUser = user;
    next();
  } catch (e) {
    if (e instanceof jwt.JsonWebTokenError || e instanceof jwt.TokenExpiredError) {
      return next(unauthorized('Invalid or expired token'));
    }
    next(e);
  }
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'ADMIN') return next(forbidden('Admin only'));
  next();
};
