import type { CoinName, NetworkName } from '../../lib/chains.js';
import type { IncomingTx } from '../../services/paymentService.js';

export interface WatchTarget {
  address: string;
  coin: CoinName;
}

/**
 * Provider interface — swap RPC/explorer vendors without touching the scanner.
 * Implementations: mempool.space (BTC/LTC), Etherscan V2 (ETH/BSC), TronGrid (TRON).
 */
export interface ChainProvider {
  readonly network: NetworkName;
  /** current chain head (tip block / height) */
  getBlockHeight(): Promise<number>;
  /** recent incoming transactions for the given addresses (idempotent ingestion downstream) */
  fetchRecent(targets: WatchTarget[]): Promise<IncomingTx[]>;
}

export async function getJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('?')[0]}`);
  return res.json();
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
