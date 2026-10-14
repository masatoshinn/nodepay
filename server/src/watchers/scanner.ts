import { prisma } from '../lib/prisma.js';
import { OPEN_STATUSES } from '../services/invoiceService.js';
import { applyConfirmation, recordIncoming } from '../services/paymentService.js';
import { getProvider } from './providers/index.js';
import type { NetworkName } from '../lib/chains.js';

const LATE_WINDOW_MS = 60 * 60_000; // keep scanning 1h past expiry for late payments

/**
 * One scan cycle for a network:
 * 1. pull recent txs for all open invoice addresses (providers batch per address)
 * 2. ingest them idempotently (unique tx hash → no double credit)
 * 3. refresh confirmations against chain head and drive invoices to PAID
 */
export async function scanNetwork(network: NetworkName): Promise<void> {
  const since = new Date(Date.now() - LATE_WINDOW_MS);
  const openInvoices = await prisma.invoice.findMany({
    where: { network, status: { in: [...OPEN_STATUSES] }, expiresAt: { gt: since } },
    select: { id: true, address: true, coin: true },
    take: 300,
  });
  if (!openInvoices.length) return;

  const provider = getProvider(network);
  const targets = [...new Map(openInvoices.map((i) => [i.address, { address: i.address, coin: i.coin }])).values()];

  let head = 0;
  try {
    head = await provider.getBlockHeight();
  } catch (e) {
    console.error(`[scan ${network}] block height failed:`, (e as Error).message);
    return;
  }

  // 1+2 — detect new transactions
  try {
    const recent = await provider.fetchRecent(targets);
    for (const tx of recent) {
      try {
        const res = await recordIncoming(tx);
        if (res.invoiceId) {
          // make sure we picked up detection-time confirmations
          const pay = await prisma.payment.findUnique({
            where: { network_txHash: { network: tx.network, txHash: tx.txHash } },
          });
          if (pay) {
            const conf = pay.blockNumber != null ? Math.max(0, head - pay.blockNumber + 1) : 0;
            if (conf > pay.confirmations) await applyConfirmation(pay.id, conf);
          }
        }
      } catch (e) {
        console.error(`[scan ${network}] ingest ${tx.txHash}:`, (e as Error).message);
      }
    }
  } catch (e) {
    console.error(`[scan ${network}] fetchRecent failed:`, (e as Error).message);
  }

  // 3 — advance confirmations for already-detected payments
  for (const inv of openInvoices) {
    try {
      const payments = await prisma.payment.findMany({
        where: { invoiceId: inv.id, status: { not: 'CONFIRMED' } },
      });
      for (const p of payments) {
        if (p.blockNumber == null) continue; // unconfirmed/mempool — refetched next cycle
        const conf = Math.max(0, head - p.blockNumber + 1);
        if (conf > p.confirmations) await applyConfirmation(p.id, conf);
      }
    } catch (e) {
      console.error(`[scan ${network}] confirm ${inv.id}:`, (e as Error).message);
    }
  }
}
