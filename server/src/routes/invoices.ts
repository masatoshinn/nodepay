import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { h, notFound, badRequest } from '../lib/errors.js';
import { validateBody, validateQuery, getQuery } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { createInvoice, serializeInvoice, type CreateInvoiceInput } from '../services/invoiceService.js';
import { PAIRS, COIN_META } from '../lib/chains.js';
import type { Prisma } from '@prisma/client';

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth);

const INVOICE_STATUSES = ['WAITING', 'DETECTED', 'CONFIRMING', 'PAID', 'EXPIRED', 'UNDERPAID', 'OVERPAID', 'CANCELED'] as const;

const listQuery = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  coin: z.enum(['BTC', 'LTC', 'ETH', 'BNB', 'TRX', 'USDT', 'USDC']).optional(),
  network: z.enum(['BTC', 'LTC', 'ETH', 'BSC', 'TRON']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  q: z.string().max(100).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(25),
});

function buildFilter(q: z.infer<typeof listQuery>, userId: string): Prisma.InvoiceWhereInput {
  return {
    userId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.coin ? { coin: q.coin } : {}),
    ...(q.network ? { network: q.network } : {}),
    ...(q.from || q.to
      ? {
          createdAt: {
            ...(q.from ? { gte: new Date(q.from) } : {}),
            ...(q.to ? { lte: new Date(q.to) } : {}),
          },
        }
      : {}),
    ...(q.q
      ? {
          OR: [
            { orderId: { contains: q.q, mode: 'insensitive' } },
            { description: { contains: q.q, mode: 'insensitive' } },
            { address: { contains: q.q, mode: 'insensitive' } },
            { publicId: { contains: q.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}

invoicesRouter.get(
  '/',
  validateQuery(listQuery),
  h(async (req, res) => {
    const q = getQuery<z.infer<typeof listQuery>>(req);
    const where = buildFilter(q, req.user!.id);
    const [total, rows] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: { payments: { select: { txHash: true, amount: true, confirmations: true } } },
      }),
    ]);
    res.json({
      invoices: rows.map((r) => ({
        ...serializeInvoice(r),
        payments: r.payments.map((p) => ({
          txHash: p.txHash,
          amount: String(p.amount),
          confirmations: p.confirmations,
        })),
      })),
      total,
      page: q.page,
      pages: Math.ceil(total / q.limit),
    });
  })
);

const createSchema = z.object({
  amountFiat: z.coerce.number().positive().max(100_000_000),
  fiatCurrency: z.string().toUpperCase().refine((s) => ['USD', 'EUR'].includes(s)).default('USD'),
  coin: z.enum(['BTC', 'LTC', 'ETH', 'BNB', 'TRX', 'USDT', 'USDC']),
  network: z.enum(['BTC', 'LTC', 'ETH', 'BSC', 'TRON']),
  description: z.string().max(500).optional(),
  orderId: z.string().max(120).optional(),
  successUrl: z.string().url().max(500).optional(),
  cancelUrl: z.string().url().max(500).optional(),
  ttlMinutes: z.coerce.number().min(5).max(1440).optional(),
  type: z.enum(['LINK', 'INVOICE']).default('INVOICE'),
});

invoicesRouter.post(
  '/',
  validateBody(createSchema),
  h(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    const invoice = await createInvoice({
      userId: req.user!.id,
      amountFiat: body.amountFiat,
      fiatCurrency: body.fiatCurrency,
      coin: body.coin,
      network: body.network,
      description: body.description,
      orderId: body.orderId,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
      ttlMinutes: body.ttlMinutes,
      type: body.type,
    } satisfies CreateInvoiceInput);
    await audit(req, 'invoice.create', invoice.id, { coin: invoice.coin, amount: String(invoice.amountFiat) });
    res.status(201).json({ invoice: serializeInvoice(invoice) });
  })
);

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((k) => esc(r[k])).join(','))].join('\n');
}

invoicesRouter.get(
  '/export.csv',
  validateQuery(listQuery),
  h(async (req, res) => {
    const q = getQuery<z.infer<typeof listQuery>>(req);
    const rows = await prisma.invoice.findMany({
      where: buildFilter(q, req.user!.id),
      orderBy: { createdAt: 'desc' },
      take: 5000,
      include: { payments: { select: { txHash: true } } },
    });
    const csv = toCsv(
      rows.map((r) => ({
        id: r.publicId,
        orderId: r.orderId ?? '',
        status: r.status,
        amountFiat: String(r.amountFiat),
        fiat: r.fiatCurrency,
        coin: r.coin,
        network: r.network,
        cryptoAmount: String(r.cryptoAmount),
        lockedRate: String(r.lockedRate),
        address: r.address,
        addressMode: r.addressMode,
        txHash: r.txHash ?? r.payments[0]?.txHash ?? '',
        confirmations: r.confirmations,
        requiredConfirm: r.requiredConfirm,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        paidAt: r.paidAt?.toISOString() ?? '',
        description: r.description ?? '',
      }))
    );
    await audit(req, 'invoice.export', undefined, { count: rows.length });
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="nodepay-invoices-${Date.now()}.csv"`);
    res.send(csv);
  })
);

async function ownInvoice(id: string, userId: string) {
  const inv = await prisma.invoice.findFirst({
    where: { userId, OR: [{ id }, { publicId: id }] },
    include: { payments: { orderBy: { detectedAt: 'asc' } } },
  });
  if (!inv) throw notFound('Invoice not found');
  return inv;
}

invoicesRouter.get(
  '/:id',
  h(async (req, res) => {
    const inv = await ownInvoice(req.params.id!, req.user!.id);
    res.json({
      invoice: {
        ...serializeInvoice(inv),
        payments: inv.payments.map((p) => ({
          id: p.id,
          txHash: p.txHash,
          amount: String(p.amount),
          confirmations: p.confirmations,
          status: p.status,
          blockNumber: p.blockNumber,
          detectedAt: p.detectedAt.toISOString(),
          confirmedAt: p.confirmedAt?.toISOString() ?? null,
        })),
        checkoutUrl: `${process.env.APP_URL ?? 'http://localhost:5173'}/pay/${inv.publicId}`,
      },
    });
  })
);

invoicesRouter.post(
  '/:id/cancel',
  h(async (req, res) => {
    const inv = await ownInvoice(req.params.id!, req.user!.id);
    if (!['WAITING', 'UNDERPAID', 'OVERPAID'].includes(inv.status)) {
      throw badRequest(`Cannot cancel invoice in status ${inv.status}`);
    }
    const updated = await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'CANCELED' } });
    await audit(req, 'invoice.cancel', inv.id);
    res.json({ invoice: serializeInvoice(updated) });
  })
);

// ---------------------------------------------------------------------------
// Payment list (raw on-chain transactions across all invoices)
// ---------------------------------------------------------------------------

const paymentQuery = z.object({
  status: z.enum(['DETECTED', 'CONFIRMING', 'CONFIRMED']).optional(),
  coin: z.enum(['BTC', 'LTC', 'ETH', 'BNB', 'TRX', 'USDT', 'USDC']).optional(),
  network: z.enum(['BTC', 'LTC', 'ETH', 'BSC', 'TRON']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(25),
});

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

paymentsRouter.get(
  '/',
  validateQuery(paymentQuery),
  h(async (req, res) => {
    const q = getQuery<z.infer<typeof paymentQuery>>(req);
    const where: Prisma.PaymentWhereInput = {
      userId: req.user!.id,
      ...(q.status ? { status: q.status } : {}),
      ...(q.network ? { network: q.network } : {}),
      ...(q.coin ? { invoice: { coin: q.coin } } : {}),
      ...(q.from || q.to
        ? {
            detectedAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.findMany({
        where,
        orderBy: { detectedAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: { invoice: { select: { publicId: true, coin: true, network: true, orderId: true, amountFiat: true, fiatCurrency: true } } },
      }),
    ]);
    res.json({
      payments: rows.map((p) => ({
        id: p.id,
        txHash: p.txHash,
        network: p.network,
        amount: String(p.amount),
        confirmations: p.confirmations,
        status: p.status,
        blockNumber: p.blockNumber,
        detectedAt: p.detectedAt.toISOString(),
        confirmedAt: p.confirmedAt?.toISOString() ?? null,
        invoice: {
          publicId: p.invoice.publicId,
          orderId: p.invoice.orderId,
          coin: p.invoice.coin,
          network: p.invoice.network,
          amountFiat: String(p.invoice.amountFiat),
          fiatCurrency: p.invoice.fiatCurrency,
        },
      })),
      total,
      page: q.page,
      pages: Math.ceil(total / q.limit),
    });
  })
);

paymentsRouter.get(
  '/export.csv',
  validateQuery(paymentQuery),
  h(async (req, res) => {
    const q = getQuery<z.infer<typeof paymentQuery>>(req);
    const rows = await prisma.payment.findMany({
      where: {
        userId: req.user!.id,
        ...(q.status ? { status: q.status } : {}),
        ...(q.network ? { network: q.network } : {}),
        ...(q.coin ? { invoice: { coin: q.coin } } : {}),
        ...(q.from || q.to
          ? { detectedAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
          : {}),
      },
      orderBy: { detectedAt: 'desc' },
      take: 5000,
      include: { invoice: { select: { publicId: true, coin: true, orderId: true } } },
    });
    const csv = toCsv(
      rows.map((p) => ({
        txHash: p.txHash,
        network: p.network,
        coin: p.invoice.coin,
        amount: String(p.amount),
        confirmations: p.confirmations,
        status: p.status,
        blockNumber: p.blockNumber ?? '',
        invoiceId: p.invoice.publicId,
        orderId: p.invoice.orderId ?? '',
        detectedAt: p.detectedAt.toISOString(),
        confirmedAt: p.confirmedAt?.toISOString() ?? '',
      }))
    );
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="nodepay-payments-${Date.now()}.csv"`);
    res.send(csv);
  })
);

export { PAIRS, COIN_META, toCsv };
