export const STATUS_STYLES: Record<string, string> = {
  WAITING: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  DETECTED: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300',
  CONFIRMING: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300',
  PAID: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  CONFIRMED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  EXPIRED: 'bg-slate-200 text-slate-600 dark:bg-slate-700/40 dark:text-slate-400',
  UNDERPAID: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
  OVERPAID: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
  CANCELED: 'bg-slate-200 text-slate-600 dark:bg-slate-700/40 dark:text-slate-400',
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  DELIVERED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  FAILED: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
  ACTIVE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  SUSPENDED: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
};

export const NETWORK_META: Record<string, { label: string; color: string }> = {
  BTC: { label: 'Bitcoin', color: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300' },
  LTC: { label: 'Litecoin', color: 'bg-slate-200 text-slate-700 dark:bg-slate-600/30 dark:text-slate-300' },
  ETH: { label: 'Ethereum', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' },
  BSC: { label: 'BNB Chain', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300' },
  TRON: { label: 'TRON', color: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' },
};

export function fmtMoney(v: number | string, currency = 'USD'): string {
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: currency.toUpperCase() });
}

export function fmtCrypto(v: number | string, coin: string): string {
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return '—';
  const max = coin === 'BTC' || coin === 'LTC' ? 8 : 6;
  return `${n.toLocaleString('en-US', { maximumFractionDigits: max })} ${coin}`;
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 1) return 'just now';
  if (Math.abs(mins) < 60) return `${mins > 0 ? '' : 'in '}${Math.abs(mins)}m${mins > 0 ? ' ago' : ''}`;
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 48) return `${hours > 0 ? '' : 'in '}${Math.abs(hours)}h${hours > 0 ? ' ago' : ''}`;
  return new Date(iso).toLocaleDateString();
}

export function shortHash(h?: string | null, n = 10): string {
  if (!h) return '—';
  return h.length <= n * 2 ? h : `${h.slice(0, n)}…${h.slice(-n)}`;
}

export function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function explorerTxUrl(network: string, txHash: string): string | null {
  switch (network) {
    case 'BTC':
      return `https://mempool.space/tx/${txHash}`;
    case 'LTC':
      return `https://litecoinspace.org/tx/${txHash}`;
    case 'ETH':
      return `https://etherscan.io/tx/${txHash}`;
    case 'BSC':
      return `https://bscscan.com/tx/${txHash}`;
    case 'TRON':
      return `https://tronscan.org/#/transaction/${txHash}`;
    default:
      return null;
  }
}
