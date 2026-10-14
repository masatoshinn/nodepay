export interface Pair {
  coin: 'BTC' | 'LTC' | 'ETH' | 'BNB' | 'TRX' | 'USDT' | 'USDC';
  network: 'BTC' | 'LTC' | 'ETH' | 'BSC' | 'TRON';
}

export const PAIRS: Pair[] = [
  { coin: 'BTC', network: 'BTC' },
  { coin: 'LTC', network: 'LTC' },
  { coin: 'ETH', network: 'ETH' },
  { coin: 'USDT', network: 'ETH' },
  { coin: 'USDC', network: 'ETH' },
  { coin: 'BNB', network: 'BSC' },
  { coin: 'USDT', network: 'BSC' },
  { coin: 'USDC', network: 'BSC' },
  { coin: 'TRX', network: 'TRON' },
  { coin: 'USDT', network: 'TRON' },
];

export const COINS = [...new Set(PAIRS.map((p) => p.coin))];
export const NETWORKS = ['BTC', 'LTC', 'ETH', 'BSC', 'TRON'] as const;

export const REQUIRED_CONFIRMATIONS: Record<string, number> = {
  BTC: 2,
  LTC: 6,
  ETH: 12,
  BSC: 15,
  TRON: 19,
};
