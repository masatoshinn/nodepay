import { env } from '../../config.js';
import { roundAmount, type NetworkName } from '../../lib/chains.js';
import type { IncomingTx } from '../../services/paymentService.js';
import { type ChainProvider, type WatchTarget, getJson, sleep } from './types.js';

/**
 * Bitcoin-family provider via mempool.space REST.
 * Set MEMPOOL_SPACE_URL to any esplora-compatible instance (mempool.space, local esplora, etc.)
 */
export class BitcoinProvider implements ChainProvider {
  constructor(
    readonly network: NetworkName,
    private readonly baseUrl: string
  ) {}

  async getBlockHeight(): Promise<number> {
    const res = await fetch(`${this.baseUrl}/blocks/tip/height`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseInt((await res.text()).trim(), 10);
  }

  async fetchRecent(targets: WatchTarget[]): Promise<IncomingTx[]> {
    const out: IncomingTx[] = [];
    for (const t of targets) {
      try {
        // first page = mempool + last ~25 confirmed txs â€” plenty for open invoices
        const txs = (await getJson(`${this.baseUrl}/address/${t.address}/txs`)) as any[];
        for (const tx of txs ?? []) {
          let sat = 0;
          for (const vout of tx.vout ?? []) {
            if (vout.scriptpubkey_address === t.address) sat += Number(vout.value);
          }
          if (sat <= 0) continue;
          const blockHeight = tx.status?.confirmed ? (tx.status.block_height as number) : null;
          out.push({
            network: this.network,
            coin: t.coin,
            txHash: tx.txid,
            address: t.address,
            amount: roundAmount(sat / 1e8, 8),
            fromAddress: tx.vin?.[0]?.prevout?.scriptpubkey_address,
            blockNumber: blockHeight,
            timestamp: (tx.status?.block_time ?? tx.timestamp ?? Math.floor(Date.now() / 1000)) * 1000,
          });
        }
        await sleep(300);
      } catch (e) {
        console.error(`[btc ${this.network}] fetchRecent(${t.address})`, (e as Error).message);
      }
    }
    return out;
  }
}

export function ltcProvider(): BitcoinProvider {
  // esplora-compatible LTC instance (mempool.space has no LTC; swap for blockcypher/esplora)
  const base = process.env.LITECOIN_API_BASE ?? 'https://litecoinspace.org/api';
  return new BitcoinProvider('LTC', base);
}

export function btcProvider(): BitcoinProvider {
  return new BitcoinProvider('BTC', env.MEMPOOL_SPACE_URL);
}


