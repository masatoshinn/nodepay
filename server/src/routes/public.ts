import { Router } from 'express';
import { z } from 'zod';
import { h, notFound, badRequest } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { checkoutPayload, getByPublicId, createInvoice } from '../services/invoiceService.js';
import { checkoutLimiter } from '../middleware/rateLimit.js';
import { PAIRS, type CoinName, type NetworkName } from '../lib/chains.js';

/** Public, unauthenticated checkout endpoints (polled by /pay/:invoiceId). */
export const publicRouter = Router();
publicRouter.use(checkoutLimiter);

publicRouter.get(
  '/invoices/:publicId',
  h(async (req, res) => {
    const inv = await getByPublicId(req.params.publicId!);
    const merchant = await prisma.user.findUnique({
      where: { id: inv.userId },
      select: { name: true, email: true },
    });
    res.json({
      invoice: checkoutPayload(inv),
      merchant: {
        name: merchant?.name || (merchant?.email ? merchant.email.split('@')[0] : 'Merchant'),
      },
      pollMs: 4000,
    });
  })
);

/** lightweight status probe for fast polling */
publicRouter.get(
  '/invoices/:publicId/status',
  h(async (req, res) => {
    const inv = await prisma.invoice.findUnique({ where: { publicId: req.params.publicId } });
    if (!inv) throw notFound('Invoice not found');
    res.json({
      status: inv.status,
      confirmations: inv.confirmations,
      requiredConfirm: inv.requiredConfirm,
      netCryptoReceived: inv.netCryptoReceived ? String(inv.netCryptoReceived) : null,
      expiresAt: inv.expiresAt.toISOString(),
      expiresInMs: Math.max(0, inv.expiresAt.getTime() - Date.now()),
      paidAt: inv.paidAt?.toISOString() ?? null,
      txHash: inv.txHash,
      updatedAt: inv.updatedAt.getTime(),
    });
  })
);

/**
 * Re-quote an invoice onto a different coin/network (checkout "network selector").
 * Keeps the same fiat amount, order id and redirect URLs; issues a fresh invoice.
 */
publicRouter.post(
  '/requote',
  h(async (req, res) => {
    const body = z
      .object({
        from: z.string().min(4),
        coin: z.enum(['BTC', 'LTC', 'ETH', 'BNB', 'TRX', 'USDT', 'USDC']),
        network: z.enum(['BTC', 'LTC', 'ETH', 'BSC', 'TRON']),
      })
      .parse(req.body);

    if (!PAIRS.some((p) => p.coin === body.coin && p.network === body.network)) {
      throw badRequest('Unsupported coin/network pair');
    }

    const original = await getByPublicId(body.from);
    if (original.status === 'PAID') throw badRequest('Invoice already paid');

    const remainingMin = Math.max(5, Math.ceil((original.expiresAt.getTime() - Date.now()) / 60000));

    const invoice = await createInvoice({
      userId: original.userId,
      amountFiat: Number(String(original.amountFiat)),
      fiatCurrency: original.fiatCurrency,
      coin: body.coin as CoinName,
      network: body.network as NetworkName,
      description: original.description ?? undefined,
      orderId: original.orderId ?? undefined,
      successUrl: original.successUrl ?? undefined,
      cancelUrl: original.cancelUrl ?? undefined,
      ttlMinutes: remainingMin,
      type: original.type === 'API' ? 'API' : 'LINK',
    });

    res.status(201).json({ publicId: invoice.publicId, invoice: checkoutPayload(invoice) });
  })
);
