import type { Request } from 'express';
import { prisma } from './prisma.js';

export async function audit(
  req: Request,
  action: string,
  target?: string,
  meta?: Record<string, unknown>
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: req.user?.id ?? null,
        action,
        target,
        meta: (meta ?? {}) as object,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      },
    });
  } catch (e) {
    console.error('[audit]', e);
  }
}
