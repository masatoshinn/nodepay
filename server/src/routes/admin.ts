import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { h, notFound } from '../lib/errors.js';
import { validateBody, validateQuery, getQuery } from '../lib/validate.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

const merchantQuery = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  plan: z.enum(['FREE', 'PRO']).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(25),
});

adminRouter.get(
  '/merchants',
  validateQuery(merchantQuery),
  h(async (req, res) => {
    const q = getQuery<z.infer<typeof merchantQuery>>(req);
    const where = {
      role: 'MERCHANT' as const,
      ...(q.status ? { status: q.status } : {}),
      ...(q.plan ? { plan: q.plan } : {}),
      ...(q.q
        ? { email: { contains: q.q, mode: 'insensitive' as const } }
        : {}),
    };
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: {
          _count: { select: { invoices: true, wallets: true } },
        },
      }),
    ]);

    const merchants = await Promise.all(
      users.map(async (u) => {
        const [paidAgg, feeAgg] = await Promise.all([
          prisma.invoice.aggregate({
            where: { userId: u.id, status: 'PAID' },
            _sum: { amountFiat: true },
            _count: true,
          }),
          prisma.feeAccrual.aggregate({ where: { userId: u.id }, _sum: { feeFiat: true } }),
        ]);
        return {
          id: u.id,
          email: u.email,
          name: u.name,
          status: u.status,
          plan: u.plan,
          feeBps: u.feeBps,
          createdAt: u.createdAt.toISOString(),
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          invoiceCount: u._count.invoices,
          walletCount: u._count.wallets,
          paidCount: paidAgg._count,
          volume: Number(paidAgg._sum.amountFiat ?? 0),
          feesAccrued: Number(feeAgg._sum.feeFiat ?? 0),
        };
      })
    );
    res.json({ merchants, total, page: q.page, pages: Math.ceil(total / q.limit) });
  })
);

adminRouter.patch(
  '/merchants/:id',
  validateBody(
    z.object({
      status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
      plan: z.enum(['FREE', 'PRO']).optional(),
      feeBps: z.coerce.number().int().min(0).max(1000).optional(),
    })
  ),
  h(async (req, res) => {
    const user = await prisma.user.findFirst({ where: { id: req.params.id, role: 'MERCHANT' } });
    if (!user) throw notFound('Merchant not found');
    const updated = await prisma.user.update({ where: { id: user.id }, data: req.body });
    await audit(req, 'admin.merchant.update', user.id, req.body);
    res.json({
      merchant: {
        id: updated.id,
        email: updated.email,
        status: updated.status,
        plan: updated.plan,
        feeBps: updated.feeBps,
      },
    });
  })
);

adminRouter.get(
  '/stats',
  h(async (_req, res) => {
    const [merchants, suspended, paidAgg, feeAgg, invoicesByStatus, recentAudit] = await Promise.all([
      prisma.user.count({ where: { role: 'MERCHANT' } }),
      prisma.user.count({ where: { role: 'MERCHANT', status: 'SUSPENDED' } }),
      prisma.invoice.aggregate({ where: { status: 'PAID' }, _sum: { amountFiat: true }, _count: true }),
      prisma.feeAccrual.groupBy({ by: ['status'], _sum: { feeFiat: true }, _count: true }),
      prisma.invoice.groupBy({ by: ['status'], _count: true }),
      prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    res.json({
      merchants,
      suspended,
      volume: Number(paidAgg._sum.amountFiat ?? 0),
      confirmedInvoices: paidAgg._count,
      fees: feeAgg.map((f) => ({ status: f.status, total: Number(f._sum.feeFiat ?? 0), count: f._count })),
      byStatus: Object.fromEntries(invoicesByStatus.map((s) => [s.status, s._count])),
      recentAudit: recentAudit.map((a) => ({
        id: a.id,
        action: a.action,
        target: a.target,
        userId: a.userId,
        ip: a.ip,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  })
);

adminRouter.get(
  '/fees',
  validateQuery(
    z.object({
      status: z.enum(['ACCRUED', 'BILLED', 'PAID']).optional(),
      page: z.coerce.number().min(1).default(1),
      limit: z.coerce.number().min(1).max(100).default(25),
    })
  ),
  h(async (req, res) => {
    const q = getQuery<{ status?: 'ACCRUED' | 'BILLED' | 'PAID'; page: number; limit: number }>(req);
    const where = q.status ? { status: q.status } : {};
    const [total, rows, sum] = await Promise.all([
      prisma.feeAccrual.count({ where }),
      prisma.feeAccrual.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: { user: { select: { email: true, plan: true } }, invoice: { select: { publicId: true } } },
      }),
      prisma.feeAccrual.aggregate({ where, _sum: { feeFiat: true } }),
    ]);
    res.json({
      fees: rows.map((f) => ({
        id: f.id,
        invoiceId: f.invoice.publicId,
        merchant: f.user.email,
        plan: f.user.plan,
        value: Number(f.fiatValue),
        feeBps: f.feeBps,
        fee: Number(f.feeFiat),
        status: f.status,
        createdAt: f.createdAt.toISOString(),
        settledAt: f.settledAt?.toISOString() ?? null,
      })),
      total,
      sum: Number(sum._sum.feeFiat ?? 0),
      page: q.page,
      pages: Math.ceil(total / q.limit),
    });
  })
);

adminRouter.post(
  '/fees/:id/status',
  validateBody(z.object({ status: z.enum(['ACCRUED', 'BILLED', 'PAID']) })),
  h(async (req, res) => {
    const fee = await prisma.feeAccrual.findUnique({ where: { id: req.params.id } });
    if (!fee) throw notFound('Fee accrual not found');
    const updated = await prisma.feeAccrual.update({
      where: { id: fee.id },
      data: { status: req.body.status, settledAt: req.body.status === 'PAID' ? new Date() : null },
    });
    await audit(req, 'admin.fee.status', fee.id, { status: req.body.status });
    res.json({ fee: { id: updated.id, status: updated.status } });
  })
);
