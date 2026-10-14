import type { Invoice, Payment } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { emitEvent } from '../lib/webhooks.js';
import { COIN_META, roundAmount, type CoinName, type NetworkName } from '../lib/chains.js';

export interface IncomingTx {
  network: NetworkName;
  txHash: string;
  address: string;
  /** amount in coin units, decimal string */
  amount: string;
  /** coin of the target address (provided by the scanner/providers) */
  coin?: CoinName;
  fromAddress?: string;
  blockNumber?: number | null;
  confirmations?: number;
  timestamp?: number;
}

const OPEN = ['WAITING', 'DETECTED', 'CONFIRMING', 'UNDERPAID', 'OVERPAID'] as const;
/** late payments are honoured for a grace window after expiry */
const MATCHABLE = [...OPEN, 'EXPIRED'] as const;

/**
 * Locate the invoice a transaction belongs to.
 * 1) unique/HD address match  2) exact-amount + time-window match (offset fallback)
 */
export async function matchInvoice(tx: IncomingTx): Promise<Invoice | null> {
  const byAddress = await prisma.invoice.findFirst({
    where: {
      network: tx.network,
      address: tx.address,
      status: { in: [...MATCHABLE] },
      expiresAt: { gt: new Date(Date.now() - 60 * 60_000) }, // 1h late-payment window
    },
    orderBy: { createdAt: 'desc' },
  });
  if (byAddress) return byAddress;

  const coin =
    tx.coin ??
    ((await prisma.invoice.findFirst({
      where: { network: tx.network, address: tx.address },
    }))?.coin as CoinName | undefined);

  // amount-based fallback (AMOUNT_OFFSET mode)
  const candidates = await prisma.invoice.findMany({
    where: {
      network: tx.network,
      addressMode: 'AMOUNT_OFFSET',
      status: { in: [...MATCHABLE] },
      // late payments are accepted within 30 minutes past expiry
      expiresAt: { gt: new Date(Date.now() - 30 * 60_000) },
      createdAt: { lte: new Date(tx.timestamp ?? Date.now()) },
      ...(tx.coin ? { coin: tx.coin } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const decimals = coin ? COIN_META[coin].decimals : 6;
  const paid = roundAmount(tx.amount, decimals);
  const matches = candidates.filter((inv) => {
    const expected = roundAmount(String(inv.cryptoAmount), COIN_META[inv.coin].decimals);
    return paid === expected;
  });
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    // ambiguous: two open invoices share this amount — do not guess
    console.warn(`[match] ambiguous amount ${paid} on ${tx.network}: ${matches.length} invoices`);
    return null;
  }
  return null;
}

/**
 * Idempotent ingestion of an incoming on-chain transaction.
 * The (network, txHash) unique constraint guarantees a tx is only credited once.
 */
export async function recordIncoming(tx: IncomingTx): Promise<{ invoiceId?: string; status?: string }> {
  const existing = await prisma.payment.findUnique({
    where: { network_txHash: { network: tx.network, txHash: tx.txHash } },
  });

  if (existing) {
    // keep tracking the tx: fill in block height once mined (mempool txs), refresh confs
    const data: Record<string, unknown> = {};
    if (tx.blockNumber != null && existing.blockNumber == null) data.blockNumber = tx.blockNumber;
    if (tx.fromAddress && !existing.fromAddress) data.fromAddress = tx.fromAddress;
    const newConfs =
      typeof tx.confirmations === 'number' ? Math.max(tx.confirmations, existing.confirmations) : existing.confirmations;
    if (newConfs > existing.confirmations) data.confirmations = newConfs;
    if (Object.keys(data).length) {
      await prisma.payment.update({ where: { id: existing.id }, data });
    }
    if (newConfs > existing.confirmations) await applyConfirmation(existing.id, newConfs);
    return { invoiceId: existing.invoiceId };
  }

  const invoice = await matchInvoice(tx);
  if (!invoice) return {};

  const decimals = COIN_META[invoice.coin].decimals;
  const paid = roundAmount(tx.amount, decimals);
  const expected = roundAmount(String(invoice.cryptoAmount), decimals);

  try {
    await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        userId: invoice.userId,
        network: tx.network,
        txHash: tx.txHash,
        amount: paid,
        fromAddress: tx.fromAddress ?? null,
        blockNumber: tx.blockNumber ?? null,
        confirmations: tx.confirmations ?? 0,
        status: 'DETECTED',
      },
    });
  } catch {
    // race: another worker inserted the same tx first
    return { invoiceId: invoice.id };
  }

  const under = Number(paid) < Number(expected);
  const over = Number(paid) > Number(expected);
  const prev = invoice.status;

  // recompute totals across all payments of this invoice
  const totals = await recomputeInvoice(invoice.id);

  if (totals.received > 0) {
    let next: string = 'DETECTED';
    if (under) next = 'UNDERPAID';
    else if (over) next = 'OVERPAID';
    else if (totals.received >= Number(expected)) next = 'DETECTED'; // confirmation stage next

    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: next === 'DETECTED' && prev === 'EXPIRED' ? 'DETECTED' : (next as never),
        netCryptoReceived: totals.received,
        txHash: totals.txHash ?? tx.txHash,
        confirmations: tx.confirmations ?? 0,
      },
    });

    if (prev !== updated.status) {
      await emitEvent(invoice.userId, 'invoice.detected', {
        invoiceId: invoice.publicId,
        orderId: invoice.orderId,
        status: updated.status,
        txHash: tx.txHash,
        expected: expected,
        received: totals.received,
        late: prev === 'EXPIRED',
      });
      if (updated.status === 'UNDERPAID') {
        await emitEvent(invoice.userId, 'invoice.underpaid', {
          invoiceId: invoice.publicId,
          orderId: invoice.orderId,
          expected,
          received: totals.received,
          missing: roundAmount(Number(expected) - totals.received, decimals),
        });
      }
    }
    return { invoiceId: invoice.id, status: updated.status };
  }

  return { invoiceId: invoice.id };
}

export interface Totals {
  received: number;
  txHash?: string;
  /** earliest payment(s) covering the expected amount */
  covering: Payment[];
}

/** sum of payments, greedy coverage of the expected amount in arrival order */
export async function recomputeInvoice(invoiceId: string): Promise<Totals> {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const payments = await prisma.payment.findMany({
    where: { invoiceId },
    orderBy: { detectedAt: 'asc' },
  });
  const expected = Number(String(invoice.cryptoAmount));
  let received = 0;
  const covering: Payment[] = [];
  for (const p of payments) {
    if (received >= expected) break;
    received += Number(String(p.amount));
    covering.push(p);
  }
  if (received < expected) {
    // keep all payments in the coverage set for confirmation math
    for (const p of payments) if (!covering.includes(p)) covering.push(p);
  }
  return { received, txHash: payments[0]?.txHash, covering };
}

/**
 * Update confirmations for a payment and drive the invoice to CONFIRMING / PAID.
 * Guarded by Payment.credited so fees + confirmed webhooks fire exactly once.
 */
export async function applyConfirmation(paymentId: string, confirmations: number): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
  if (!payment) return;
  const invoice = payment.invoice;

  if (payment.confirmations >= confirmations && payment.status === 'CONFIRMED') return;

  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      confirmations,
      status: confirmations >= invoice.requiredConfirm ? 'CONFIRMED' : 'CONFIRMING',
      confirmedAt: confirmations >= invoice.requiredConfirm ? (payment.confirmedAt ?? new Date()) : null,
    },
  });

  const totals = await recomputeInvoice(invoice.id);
  const expected = Number(String(invoice.cryptoAmount));
  const decimals = COIN_META[invoice.coin].decimals;

  // confirmations counted across the payments that cover the expected amount
  const coveringConfs = totals.covering.map((p) =>
    p.id === paymentId ? confirmations : p.confirmations
  );
  const minConfs = coveringConfs.length ? Math.min(...coveringConfs) : confirmations;

  const enough = totals.received >= expected;
  const enoughConfs = minConfs >= invoice.requiredConfirm;
  const wasPaid = invoice.status === 'PAID' && !!invoice.paidAt;

  if (enough && enoughConfs) {
    if (!wasPaid) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'PAID', confirmations: minConfs, paidAt: new Date(), netCryptoReceived: totals.received },
      });
      if (!payment.credited) {
        await prisma.payment.updateMany({
          where: { invoiceId: invoice.id },
          data: { credited: true },
        });
        await accrueFee(invoice);
        await emitEvent(invoice.userId, 'invoice.confirmed', {
          invoiceId: invoice.publicId,
          orderId: invoice.orderId,
          status: 'PAID',
          txHash: payment.txHash,
          expected: roundAmount(expected, decimals),
          received: roundAmount(totals.received, decimals),
          confirmations: minConfs,
        });
      }
    }
    return;
  }

  if (enough && !enoughConfs) {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'CONFIRMING', confirmations: minConfs, netCryptoReceived: totals.received },
    });
    return;
  }

  // not enough total value yet — keep under/overpaid state visible
  const next =
    totals.received > 0 && totals.received < expected ? 'UNDERPAID' : totals.received > expected ? 'OVERPAID' : 'DETECTED';
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      status: next as never,
      confirmations: minConfs,
      netCryptoReceived: totals.received,
    },
  });
}

/** non-custodial platform fee: accrue a % of confirmed invoice value, settle later */
async function accrueFee(invoice: Invoice) {
  try {
    const user = await prisma.user.findUnique({ where: { id: invoice.userId } });
    if (!user || user.feeBps <= 0) return;
    const feeFiat = (Number(String(invoice.amountFiat)) * user.feeBps) / 10_000;
    await prisma.feeAccrual.create({
      data: {
        userId: invoice.userId,
        invoiceId: invoice.id,
        fiatValue: invoice.amountFiat,
        fiatCurrency: invoice.fiatCurrency,
        feeBps: user.feeBps,
        feeFiat: Math.round(feeFiat * 100) / 100,
      },
    });
  } catch (e) {
    console.error('[fee accrual]', e);
  }
}

