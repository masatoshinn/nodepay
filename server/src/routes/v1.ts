import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { h, notFound, badRequest } from '../lib/errors.js';
import { validateBody, validateQuery, getQuery } from '../lib/validate.js';
import { requireApiKey } from '../middleware/apiKey.js';
import { createInvoice, serializeInvoice, type CreateInvoiceInput } from '../services/invoiceService.js';

/**
 * Merchant-facing API (X-API-Key + X-API-Secret headers).
 * Base URL: /api/v1
 */
export const v1Router = Router();
v1Router.use(requireApiKey);

const createSchema = z.object({
  amount: z.coerce.number().positive().max(100_000_000),
  currency: z.enum(['USD', 'EUR']).default('USD'),
  coin: z.enum(['BTC', 'LTC', 'ETH', 'BNB', 'TRX', 'USDT', 'USDC']),
  network: z.enum(['BTC', 'LTC', 'ETH', 'BSC', 'TRON']),
  description: z.string().max(500).optional(),
  order_id: z.string().max(120).optional(),
  callback_url: z.string().url().max(500).optional(), // success redirect
  cancel_url: z.string().url().max(500).optional(),
  ttl_minutes: z.coerce.number().min(5).max(1440).optional(),
});

v1Router.post(
  '/invoices',
  validateBody(createSchema),
  h(async (req, res) => {
    const b = req.body as z.infer<typeof createSchema>;
    const invoice = await createInvoice({
      userId: req.user!.id,
      apiKeyId: req.apiKeyId,
      amountFiat: b.amount,
      fiatCurrency: b.currency,
      coin: b.coin,
      network: b.network,
      description: b.description,
      orderId: b.order_id,
      successUrl: b.callback_url,
      cancelUrl: b.cancel_url,
      ttlMinutes: b.ttl_minutes,
      type: 'API',
    } satisfies CreateInvoiceInput);
    res.status(201).json(apiInvoice(invoice));
  })
);

const listSchema = z.object({
  status: z.enum(['WAITING', 'DETECTED', 'CONFIRMING', 'PAID', 'EXPIRED', 'UNDERPAID', 'OVERPAID', 'CANCELED']).optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  offset: z.coerce.number().min(0).default(0),
  order_id: z.string().max(120).optional(),
});

v1Router.get(
  '/invoices',
  validateQuery(listSchema),
  h(async (req, res) => {
    const q = getQuery<z.infer<typeof listSchema>>(req);
    const where = {
      userId: req.user!.id,
      ...(q.status ? { status: q.status } : {}),
      ...(q.order_id ? { orderId: q.order_id } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({ where, orderBy: { createdAt: 'desc' }, take: q.limit, skip: q.offset }),
    ]);
    res.json({ data: rows.map(apiInvoice), pagination: { total, limit: q.limit, offset: q.offset } });
  })
);

async function own(idOrPublicId: string, userId: string) {
  const inv = await prisma.invoice.findFirst({
    where: { userId, OR: [{ id: idOrPublicId }, { publicId: idOrPublicId }] },
  });
  if (!inv) throw notFound('Invoice not found');
  return inv;
}

v1Router.get(
  '/invoices/:id',
  h(async (req, res) => {
    const inv = await own(req.params.id!, req.user!.id);
    res.json({ data: apiInvoice(inv) });
  })
);

v1Router.post(
  '/invoices/:id/cancel',
  h(async (req, res) => {
    const inv = await own(req.params.id!, req.user!.id);
    if (!['WAITING', 'UNDERPAID', 'OVERPAID'].includes(inv.status)) {
      throw badRequest(`Cannot cancel invoice in status ${inv.status}`);
    }
    const updated = await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'CANCELED' } });
    res.json({ data: apiInvoice(updated) });
  })
);

v1Router.get(
  '/balance',
  h(async (req, res) => {
    // non-custodial: NodePay never holds funds — report owed platform fees only
    const agg = await prisma.feeAccrual.aggregate({
      where: { userId: req.user!.id },
      _sum: { feeFiat: true },
      _count: true,
    });
    res.json({
      data: {
        custodial: false,
        fees_accrued_fiat: Number(agg._sum.feeFiat ?? 0),
        fee_count: agg._count,
        message: 'NodePay never holds funds. Balances live in your own wallet.',
      },
    });
  })
);

function apiInvoice(inv: {
  id: string;
  publicId: string;
  orderId: string | null;
  status: string;
  amountFiat: unknown;
  fiatCurrency: string;
  coin: string;
  network: string;
  lockedRate: unknown;
  cryptoAmount: unknown;
  addressMode: string;
  address: string;
  confirmations: number;
  requiredConfirm: number;
  txHash: string | null;
  description: string | null;
  successUrl: string | null;
  expiresAt: Date;
  paidAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: inv.publicId,
    order_id: inv.orderId,
    status: inv.status.toLowerCase(),
    amount_fiat: String(inv.amountFiat),
    fiat_currency: inv.fiatCurrency,
    coin: inv.coin,
    network: inv.network,
    locked_rate: String(inv.lockedRate),
    amount_crypto: String(inv.cryptoAmount),
    address: inv.address,
    address_mode: inv.addressMode.toLowerCase(),
    confirmations: inv.confirmations,
    required_confirmations: inv.requiredConfirm,
    tx_hash: inv.txHash,
    description: inv.description,
    checkout_url: `${process.env.APP_URL ?? 'http://localhost:5173'}/pay/${inv.publicId}`,
    expires_at: inv.expiresAt.toISOString(),
    paid_at: inv.paidAt?.toISOString() ?? null,
    created_at: inv.createdAt.toISOString(),
  };
}
