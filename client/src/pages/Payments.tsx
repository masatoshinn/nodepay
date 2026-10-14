import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api, downloadCsv } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingBlock, EmptyState } from '../components/Loading';
import { fmtCrypto, fmtDate, fmtMoney, shortHash, explorerTxUrl } from '../lib/format';
import { PAIRS } from '../lib/pairs';

interface PaymentRow {
  id: string;
  txHash: string;
  network: string;
  amount: string;
  confirmations: number;
  status: string;
  blockNumber: number | null;
  detectedAt: string;
  confirmedAt: string | null;
  invoice: { publicId: string; orderId: string | null; coin: string; network: string; amountFiat: string; fiatCurrency: string };
}

export default function Payments() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const coin = params.get('coin') ?? '';
  const network = params.get('network') ?? '';
  const page = Number(params.get('page') ?? 1);

  const qs = new URLSearchParams({ page: String(page), limit: '25' });
  if (status) qs.set('status', status);
  if (coin) qs.set('coin', coin);
  if (network) qs.set('network', network);

  const { data, isLoading } = useQuery({
    queryKey: ['payments', qs.toString()],
    queryFn: () => api<{ payments: PaymentRow[]; total: number; pages: number }>(`/api/payments?${qs}`),
    refetchInterval: 10_000,
  });

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Payments</h1>
          <p className="text-sm text-slate-500">Raw on-chain transactions detected for your invoices</p>
        </div>
        <button
          className="btn-ghost"
          onClick={async () => {
            const url = await downloadCsv(`/api/payments/export.csv?${qs}`);
            const a = document.createElement('a');
            a.href = url;
            a.click();
          }}
        >
          ⬇ CSV
        </button>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <select className="input !w-auto" value={status} onChange={(e) => setParam('status', e.target.value)}>
          <option value="">All statuses</option>
          <option value="DETECTED">DETECTED</option>
          <option value="CONFIRMING">CONFIRMING</option>
          <option value="CONFIRMED">CONFIRMED</option>
        </select>
        <select className="input !w-auto" value={coin} onChange={(e) => setParam('coin', e.target.value)}>
          <option value="">All coins</option>
          {[...new Set(PAIRS.map((p) => p.coin))].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select className="input !w-auto" value={network} onChange={(e) => setParam('network', e.target.value)}>
          <option value="">All networks</option>
          {['BTC', 'LTC', 'ETH', 'BSC', 'TRON'].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </div>

      <div className="card overflow-x-auto">
        {isLoading ? (
          <LoadingBlock />
        ) : !data?.payments.length ? (
          <EmptyState title="No payments yet" hint="Incoming transactions to your invoice addresses will appear here within seconds of detection." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
                <th className="px-4 py-3">Transaction</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Conf</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Detected</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => {
                const url = explorerTxUrl(p.network, p.txHash);
                return (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs">{shortHash(p.txHash, 12)}</div>
                      <div className="text-xs text-slate-500">{p.network}</div>
                    </td>
                    <td className="px-4 py-3 font-medium">{fmtCrypto(p.amount, p.invoice.coin)}</td>
                    <td className="px-4 py-3">
                      <Link to={`/invoices/${p.invoice.publicId}`} className="font-mono text-xs text-brand-600 hover:underline">
                        {p.invoice.publicId}
                      </Link>
                      <div className="text-xs text-slate-500">{fmtMoney(p.invoice.amountFiat, p.invoice.fiatCurrency)}</div>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{p.confirmations}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(p.detectedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {url && (
                        <a href={url} target="_blank" rel="noreferrer" className="btn-ghost !px-2 !py-1 text-xs">
                          ↗
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {data && data.pages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button className="btn-ghost !py-1.5" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>
            ← Prev
          </button>
          <span className="text-slate-500">
            page {page} / {data.pages}
          </span>
          <button className="btn-ghost !py-1.5" disabled={page >= data.pages} onClick={() => setParam('page', String(page + 1))}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
