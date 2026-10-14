import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { h } from '../lib/errors.js';
import { validateQuery, getQuery } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';

export const statsRouter = Router();
statsRouter.use(requireAuth);

const query = z.object({
  days: z.coerce.number().min(1).max(365).default(30),
});

statsRouter.get(
  '/overview',
  validateQuery(query),
  h(async (req, res) => {
    const { days } = getQuery<z.infer<typeof query>>(req);
    const userId = req.user!.id;
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);

    const [paidAgg, statusCounts, feeAgg, chart, recent, pendingValue] = await Promise.all([
      prisma.invoice.aggregate({
        where: { userId, status: 'PAID', paidAt: { gte: since } },
        _sum: { amountFiat: true },
        _count: true,
      }),
      prisma.invoice.groupBy({ by: ['status'], where: { userId }, _count: true }),
      prisma.feeAccrual.aggregate({
        where: { userId },
        _sum: { feeFiat: true },
        _count: true,
      }),
      prisma.$queryRaw<
        { day: Date; count: bigint; volume: number }[]
      >`
        SELECT date_trunc('day', "paidAt")::date AS day,
               COUNT(*)::bigint AS count,
               COALESCE(SUM("amountFiat"), 0)::float AS volume
        FROM "Invoice"
        WHERE "userId" = ${userId} AND "paidAt" >= ${since}
        GROUP BY 1 ORDER BY 1
      `,
      prisma.invoice.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          publicId: true,
          status: true,
          amountFiat: true,
          fiatCurrency: true,
          coin: true,
          network: true,
          createdAt: true,
          paidAt: true,
        },
      }),
      prisma.invoice.aggregate({
        where: { userId, status: { in: ['WAITING', 'DETECTED', 'CONFIRMING', 'UNDERPAID', 'OVERPAID'] } },
        _sum: { amountFiat: true },
        _count: true,
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const s of statusCounts) byStatus[s.status] = s._count;

    const pending = (byStatus.WAITING ?? 0) + (byStatus.DETECTED ?? 0) + (byStatus.CONFIRMING ?? 0) + (byStatus.UNDERPAID ?? 0) + (byStatus.OVERPAID ?? 0);

    res.json({
      rangeDays: days,
      volume: Number(paidAgg._sum.amountFiat ?? 0),
      confirmedCount: paidAgg._count,
      pendingCount: pending,
      pendingValue: Number(pendingValue._sum.amountFiat ?? 0),
      expiredCount: byStatus.EXPIRED ?? 0,
      byStatus,
      feeAccrued: Number(feeAgg._sum.feeFiat ?? 0),
      chart: chart.map((c) => ({
        day: c.day.toISOString().slice(0, 10),
        count: Number(c.count),
        volume: Number(c.volume),
      })),
      recent: recent.map((r) => ({
        publicId: r.publicId,
        status: r.status,
        amountFiat: String(r.amountFiat),
        fiatCurrency: r.fiatCurrency,
        coin: r.coin,
        network: r.network,
        createdAt: r.createdAt.toISOString(),
        paidAt: r.paidAt?.toISOString() ?? null,
      })),
    });
  })
);
