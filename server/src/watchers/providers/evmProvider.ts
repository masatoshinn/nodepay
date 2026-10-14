import { env } from '../../config.js';
import { TOKEN_CONTRACTS, roundAmount, type NetworkName } from '../../lib/chains.js';
import type { IncomingTx } from '../../services/paymentService.js';
import { type ChainProvider, type WatchTarget, getJson, sleep } from './types.js';

/**
 * EVM provider (Etherscan V2 multi-chain) for ETH (chainid 1) and BSC (chainid 56).
 * Handles native value transfers and ERC-20 token transfers.
 * Swap by pointing ETHERSCAN_API_BASE at any etherscan-compatible API.
 */
export class EvmProvider implements ChainProvider {
  constructor(
    readonly network: NetworkName,
    private readonly chainId: number,
    private readonly apiKey: string,
    private readonly baseUrl: string = env.ETHERSCAN_API_BASE
  ) {}

  private async call(params: Record<string, string>): Promise<any> {
    const qs = new URLSearchParams({
      chainid: String(this.chainId),
      apikey: this.apiKey || 'YourApiKeyToken',
      ...params,
    });
    const json = await getJson(`${this.baseUrl}?${qs.toString()}`);
    // etherscan-compatible envelope
    if (json && typeof json === 'object' && 'status' in json && json.status === '0') {
      const msg = String(json.message ?? '');
      if (msg.toLowerCase().includes('no transactions')) return [];
      if (json.result && typeof json.result === 'string' && /rate limit|invalid api key/i.test(json.result)) {
        throw new Error(`explorer error: ${json.result}`);
      }
    }
    return json?.result ?? json;
  }

  async getBlockHeight(): Promise<number> {
    const result = await this.call({ module: 'proxy', action: 'eth_blockNumber' });
    return parseInt(String(result), 16);
  }

  async fetchRecent(targets: WatchTarget[]): Promise<IncomingTx[]> {
    const out: IncomingTx[] = [];
    for (const t of targets) {
      try {
        const contract = TOKEN_CONTRACTS[`${t.coin}@${this.network}`];
        if (contract) {
          const rows = (await this.call({
            module: 'account',
            action: 'tokentx',
            address: t.address,
            contract_address: contract,
            sort: 'desc',
            page: '1',
            offset: '50',
          })) as any[];
          for (const r of rows ?? []) {
            if (String(r.to).toLowerCase() !== t.address.toLowerCase()) continue;
            if (String(r.contractAddress).toLowerCase() !== contract.toLowerCase()) continue;
            const decimals = Number(r.tokenDecimal ?? 6);
            const amount = roundAmount(Number(r.value) / 10 ** decimals, decimals > 8 ? 8 : decimals);
            if (Number(amount) <= 0) continue;
            out.push({
              network: this.network,
              coin: t.coin,
              txHash: r.hash,
              address: t.address,
              amount,
              fromAddress: r.from,
              blockNumber: Number(r.blockNumber),
              timestamp: Number(r.timeStamp) * 1000,
            });
          }
        } else {
          const rows = (await this.call({
            module: 'account',
            action: 'txlist',
            address: t.address,
            startblock: '0',
            sort: 'desc',
            page: '1',
            offset: '50',
          })) as any[];
          for (const r of rows ?? []) {
            if (String(r.to).toLowerCase() !== t.address.toLowerCase()) continue;
            if (r.isError === '1' || r.txreceipt_status === '0') continue;
            const amount = roundAmount(Number(r.value) / 1e18, 18);
            if (Number(amount) <= 0) continue;
            out.push({
              network: this.network,
              coin: t.coin,
              txHash: r.hash,
              address: t.address,
              amount,
              fromAddress: r.from,
              blockNumber: Number(r.blockNumber),
              timestamp: Number(r.timeStamp) * 1000,
            });
          }
        }
        await sleep(260); // stay under free-tier rate limits
      } catch (e) {
        console.error(`[evm ${this.network}] fetchRecent(${t.address})`, (e as Error).message);
      }
    }
    return out;
  }
}


