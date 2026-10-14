import { z } from 'zod';
import { env } from '../config.js';
import { cacheGet, cacheSet } from './redis.js';
import { COIN_META, FIATS, type CoinName, type Fiat } from './chains.js';

const priceSchema = z.record(z.string(), z.record(z.string(), z.number()));

/**
 * Exchange rates via CoinGecko. The rate returned here is LOCKED into the
 * invoice at creation time (Invoice.lockedRate) for the invoice's lifetime.
 */
export async function getRates(coins: CoinName[], fiats: Fiat[] = ['usd']): Promise<Record<string, Record<string, number>>> {
  const ids = [...new Set(coins.map((c) => COIN_META[c].geckoId))];
  const vs = fiats.join(',');
  const cacheKey = `rates:${ids.sort().join(',')}:${vs}`;
  const cached = await cacheGet<Record<string, Record<string, number>>>(cacheKey);
  if (cached) return cached;

  const url = `${env.COINGECKO_API_BASE}/simple/price?ids=${ids.join(',')}&vs_currencies=${vs}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`coingecko error ${res.status}`);
  const json = priceSchema.parse(await res.json());
  await cacheSet(cacheKey, json, 60);
  return json;
}

/** fiat value of 1 unit of coin */
export async function getRate(coin: CoinName, fiat: Fiat): Promise<number> {
  if (!FIATS.includes(fiat)) throw new Error(`unsupported fiat ${fiat}`);
  const rates = await getRates([coin], [fiat]);
  const v = rates[COIN_META[coin].geckoId]?.[fiat];
  if (!v) throw new Error(`no rate for ${coin}/${fiat}`);
  return v;
}
