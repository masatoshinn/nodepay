import { randomBytes, randomInt } from 'node:crypto';
import { Prisma, type Invoice } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getRate } from '../lib/rates.js';
import { deriveAddress } from '../lib/hd.js';
import { validateAddress } from '../lib/address.js';
import { paymentUri } from '../lib/uri.js';
import {
  COIN_META,
  CONFIRMATIONS,
  PAIRS,
  roundAmount,
  type CoinName,
  type NetworkName,
} from '../lib/chains.js';
import { env } from '../config.js';

export type Decimals = typeof COIN_META[CoinName]['decimals'];

export interface CreateInvoiceInput {
  userId: string;
  apiKeyId?: string;
  amountFiat: number;
  fiatCurrency?: string;
  coin: CoinName;
  network: NetworkName;
  description?: string;
  orderId?: string;
  successUrl?: string;
  cancelUrl?: string;
  ttlMinutes?: number;
  type?: 'LINK' | 'INVOICE' | 'API';
}

const isStable = (coin: CoinName) => coin === 'USDT' || coin === 'USDC';

function assertPair(coin: CoinName, network: NetworkName) {
  if (!PAIRS.some((p) => p.coin === coin && p.network === network)) {
    throw badRequest(`Unsupported coin/network pair: ${coin} on ${network}`);
  }
}

/** next free HD index, atomically claimed from the wallet row */
async function claimDerivationIndex(walletId: string): Promise<number> {
  for (let i = 0; i < 25; i++) {
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    const updated = await prisma.wallet.updateMany({
      where: { id: walletId, nextIndex: wallet.nextIndex },
      data: { nextIndex: wallet.nextIndex + 1 },
    });
    if (updated.count === 1) return wallet.nextIndex;
  }
  throw badRequest('Could not allocate derivation index');
}

export async function createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
  const { coin, network, amountFiat } = input;
  const fiat = (input.fiatCurrency ?? 'usd').toLowerCase();
  assertPair(coin, network);
  if (!Number.isFinite(amountFiat) || amountFiat <= 0) throw badRequest('amount must be > 0');
  if (fiat !== 'usd' && fiat !== 'eur') throw badRequest('fiat currency must be usd or eur');

  const decimals = COIN_META[coin].decimals;
  const rate = await getRate(coin, fiat as 'usd' | 'eur');
  let cryptoAmount = roundAmount(amountFiat / rate, decimals);

  // --- destination address -------------------------------------------------
  const wallet = await prisma.wallet.findFirst({
    where: { userId: input.userId, network },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  if (!wallet) throw badRequest(`Add a ${network} wallet address first (dashboard - Wallets)`);

  let address: string;
  let addressMode: 'HD' | 'STATIC' | 'AMOUNT_OFFSET' = 'STATIC';
  let derivationIndex: number | null = null;
  let amountOffset: Prisma.Decimal | null = null;
  let walletId: string | null = wallet.id;

  if (wallet.xpub) {
    addressMode = 'HD';
    derivationIndex = await claimDerivationIndex(wallet.id);
    address = deriveAddress(wallet.xpub, network, derivationIndex, wallet.derivationPath);
    if (!validateAddress(address, network)) throw badRequest('derived address failed validation');
  } else if (wallet.address) {
    address = wallet.address;
    // Fallback matching when only one address exists: unique decimal offset
    if (network === 'TRON' || isStable(coin)) {
      addressMode = 'AMOUNT_OFFSET';
      let offsetStr = '';
      for (let i = 0; i < 12; i++) {
        const micro = randomInt(1, 10_000); // 0.000001 .. 0.009999
        offsetStr = roundAmount(micro / 1_000_000, decimals);
        const candidate = roundAmount(Number(cryptoAmount) + Number(offsetStr), decimals);
        const clash = await prisma.invoice.count({
          where: {
            network,
            status: { in: ['WAITING', 'DETECTED', 'CONFIRMING', 'UNDERPAID', 'OVERPAID'] },
            cryptoAmount: candidate,
            expiresAt: { gt: new Date(Date.now() - 30 * 60_000) },
          },
        });
        if (clash === 0) {
          cryptoAmount = candidate;
          amountOffset = new Prisma.Decimal(offsetStr);
          break;
        }
        if (i === 11) throw badRequest('Could not allocate a unique payment amount, retry');
      }
    }
  } else {
    walletId = null;
    throw badRequest(`Wallet for ${network} has neither address nor xpub`);
  }

  const ttl = input.ttlMinutes ?? env.INVOICE_TTL_MINUTES;
  const expiresAt = new Date(Date.now() + ttl * 60_000);

  return prisma.invoice.create({
    data: {
      publicId: 'inv_' + randomBytes(10).toString('base64url'),
      userId: input.userId,
      apiKeyId: input.apiKeyId ?? null,
      type: input.type ?? 'INVOICE',
      orderId: input.orderId ?? null,
      description: input.description ?? null,
      amountFiat,
      fiatCurrency: fiat.toUpperCase(),
      coin,
      network,
      lockedRate: rate,
      cryptoAmount,
      addressMode,
      address,
      derivationIndex,
      amountOffset,
      walletId,
      requiredConfirm: CONFIRMATIONS[network],
      successUrl: input.successUrl ?? null,
      cancelUrl: input.cancelUrl ?? null,
      expiresAt,
    },
  });
}

export function serializeInvoice(inv: Invoice) {
  return {
    id: inv.id,
    publicId: inv.publicId,
    orderId: inv.orderId,
    description: inv.description,
    status: inv.status,
    amountFiat: String(inv.amountFiat),
    fiatCurrency: inv.fiatCurrency,
    coin: inv.coin,
    network: inv.network,
    lockedRate: String(inv.lockedRate),
    cryptoAmount: String(inv.cryptoAmount),
    addressMode: inv.addressMode,
    address: inv.address,
    derivationIndex: inv.derivationIndex,
    amountOffset: inv.amountOffset ? String(inv.amountOffset) : null,
    confirmations: inv.confirmations,
    requiredConfirm: inv.requiredConfirm,
    netCryptoReceived: inv.netCryptoReceived ? String(inv.netCryptoReceived) : null,
    txHash: inv.txHash,
    successUrl: inv.successUrl,
    cancelUrl: inv.cancelUrl,
    expiresAt: inv.expiresAt.toISOString(),
    paidAt: inv.paidAt?.toISOString() ?? null,
    createdAt: inv.createdAt.toISOString(),
    updatedAt: inv.updatedAt.toISOString(),
  };
}

/** public checkout payload */
export function checkoutPayload(inv: Invoice) {
  return {
    ...serializeInvoice(inv),
    uri: paymentUri({
      address: inv.address,
      amount: String(inv.cryptoAmount),
      coin: inv.coin,
      network: inv.network,
      label: inv.description ?? undefined,
    }),
    expiresInMs: Math.max(0, inv.expiresAt.getTime() - Date.now()),
  };
}

export async function getByPublicId(publicId: string): Promise<Invoice> {
  const inv = await prisma.invoice.findUnique({ where: { publicId } });
  if (!inv) throw notFound('Invoice not found');
  return inv;
}

export const OPEN_STATUSES = ['WAITING', 'DETECTED', 'CONFIRMING', 'UNDERPAID', 'OVERPAID'] as const;

/** expire invoices past their deadline (runs on a schedule); invoices with an observed payment are never expired */
export async function expireDueInvoices(): Promise<number> {
  const due = await prisma.invoice.findMany({
    where: {
      status: { in: [...OPEN_STATUSES] },
      expiresAt: { lt: new Date() },
      payments: { none: {} },
    },
    take: 200,
  });
  let n = 0;
  for (const inv of due) {
    const updated = await prisma.invoice.updateMany({
      where: { id: inv.id, status: { in: [...OPEN_STATUSES] } },
      data: { status: 'EXPIRED' },
    });
    if (updated.count === 1) {
      n++;
      const { emitEvent } = await import('../lib/webhooks.js');
      await emitEvent(inv.userId, 'invoice.expired', {
        invoiceId: inv.publicId,
        orderId: inv.orderId,
        status: 'EXPIRED',
      });
    }
  }
  return n;
}


