export type NetworkName = 'BTC' | 'LTC' | 'ETH' | 'BSC' | 'TRON';
export type CoinName = 'BTC' | 'LTC' | 'ETH' | 'BNB' | 'TRX' | 'USDT' | 'USDC';

export const COIN_META: Record<CoinName, { decimals: number; geckoId: string; symbol: string }> = {
  BTC: { decimals: 8, geckoId: 'bitcoin', symbol: 'BTC' },
  LTC: { decimals: 8, geckoId: 'litecoin', symbol: 'LTC' },
  ETH: { decimals: 6, geckoId: 'ethereum', symbol: 'ETH' },
  BNB: { decimals: 6, geckoId: 'binancecoin', symbol: 'BNB' },
  TRX: { decimals: 6, geckoId: 'tron', symbol: 'TRX' },
  USDT: { decimals: 6, geckoId: 'tether', symbol: 'USDT' },
  USDC: { decimals: 6, geckoId: 'usd-coin', symbol: 'USDC' },
};

export const PAIRS: { coin: CoinName; network: NetworkName }[] = [
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

export const NATIVE_COINS: Record<NetworkName, CoinName> = {
  BTC: 'BTC',
  LTC: 'LTC',
  ETH: 'ETH',
  BSC: 'BNB',
  TRON: 'TRX',
};

export const CHAIN_IDS: Record<'ETH' | 'BSC', number> = { ETH: 1, BSC: 56 };

/** ERC20 / TRC20 token contracts (mainnet) */
export const TOKEN_CONTRACTS: Record<string, string> = {
  'USDT@ETH': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  'USDC@ETH': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  'USDT@BSC': '0x55d398326f99059fF775485246999027B3197955',
  'USDC@BSC': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  'USDT@TRON': 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  'USDC@TRON': 'TNUC9Qb1rRpS5CbWLmNMxXBjZFhLdAJx15',
};

export const CONFIRMATIONS: Record<NetworkName, number> = {
  BTC: 2,
  LTC: 6,
  ETH: 12,
  BSC: 15,
  TRON: 19,
};

export const FIATS = ['usd', 'eur'] as const;
export type Fiat = (typeof FIATS)[number];

export const isEvm = (n: NetworkName) => n === 'ETH' || n === 'BSC';

/** round to coin precision as a fixed-point string */
export function roundAmount(value: number | string, decimals: number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) throw new Error('invalid amount');
  // avoid float artifacts: use toFixed then trim
  return trimZeros(n.toFixed(decimals));
}

export function trimZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export function amountsEqual(a: string | number, b: string | number, decimals: number): boolean {
  return roundAmount(a, decimals) === roundAmount(b, decimals);
}

export function formatAmount(value: string | number, decimals: number, maxFrac = 6): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: maxFrac });
}
