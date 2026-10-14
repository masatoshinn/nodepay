import { env } from '../../config.js';
import { TOKEN_CONTRACTS, roundAmount, type NetworkName } from '../../lib/chains.js';
import { b58check } from '../../lib/address.js';
import type { IncomingTx } from '../../services/paymentService.js';
import { type ChainProvider, type WatchTarget, getJson, sleep } from './types.js';

/** hex address (41 + 20 bytes) → base58check T... address */
export function hexToTronBase58(hex: string): string {
  const clean = hex.replace(/^0x/, '').toLowerCase();
  const bytes = Buffer.from(clean, 'hex');
  if (bytes.length !== 21) return '';
  return b58check.encode(new Uint8Array(bytes));
}

/**
 * TRON provider (TronGrid): native TRX + TRC-20 transfers.
 * Swap by pointing TRONGRID_API_BASE at any trongrid-compatible API.
 */
export class TronProvider implements ChainProvider {
  readonly network: NetworkName = 'TRON';
  constructor(
    private readonly baseUrl: string = env.TRONGRID_API_BASE,
    private readonly apiKey: string = env.TRONGRID_API_KEY
  ) {}

  private headers(): Record<string, string> {
    return this.apiKey ? { 'TRON-PRO-API-KEY': this.apiKey } : {};
  }

  async getBlockHeight(): Promise<number> {
    const json = await getJson(`${this.baseUrl}/wallet/getnowblock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.headers() },
      body: '{}',
    });
    return Number(json?.block_header?.raw_data?.number ?? 0);
  }

  async fetchRecent(targets: WatchTarget[]): Promise<IncomingTx[]> {
    const out: IncomingTx[] = [];
    for (const t of targets) {
      try {
        const contract = TOKEN_CONTRACTS[`${t.coin}@TRON`];
        if (contract) {
          const url = `${this.baseUrl}/v1/accounts/${t.address}/transactions/trc20?only_to=true&limit=50&contract_address=${contract}`;
          const json = await getJson(url, { headers: this.headers() });
          for (const r of json?.data ?? []) {
            if (String(r.to).toLowerCase() !== t.address.toLowerCase()) continue;
            const decimals = Number(r.tokenInfo?.decimals ?? 6);
            const amount = roundAmount(Number(r.value) / 10 ** decimals, Math.min(decimals, 8));
            if (Number(amount) <= 0) continue;
            out.push({
              network: 'TRON',
              coin: t.coin,
              txHash: r.transaction_id,
              address: t.address,
              amount,
              fromAddress: r.from,
              blockNumber: Number(r.blockNumber ?? 0) || null,
              timestamp: Number(r.timestamp ?? 0),
            });
          }
        } else {
          const url = `${this.baseUrl}/v1/accounts/${t.address}/transactions?only_to=true&limit=50`;
          const json = await getJson(url, { headers: this.headers() });
          for (const r of json?.data ?? []) {
            const c = r?.raw_data?.contract?.[0];
            const value = c?.parameter?.value;
            if (!value || c.type !== 'TransferContract') continue;
            const to = value.to_address ? hexToTronBase58(value.to_address) : '';
            if (to !== t.address) continue;
            const amount = roundAmount(Number(value.amount) / 1e6, 6);
            if (Number(amount) <= 0) continue;
            out.push({
              network: 'TRON',
              coin: t.coin,
              txHash: r.txID,
              address: t.address,
              amount,
              fromAddress: value.owner_address ? hexToTronBase58(value.owner_address) : undefined,
              blockNumber: Number(r.blockNumber ?? 0) || null,
              timestamp: Number(r.raw_data?.timestamp ?? r.block_time ?? 0),
            });
          }
        }
        await sleep(250);
      } catch (e) {
        console.error(`[tron] fetchRecent(${t.address})`, (e as Error).message);
      }
    }
    return out;
  }
}
