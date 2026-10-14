import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingBlock } from '../components/Loading';
import { fmtMoney, NETWORK_META, fmtRelative, fmtCrypto } from '../lib/format';

interface Overview {
  rangeDays: number;
  volume: number;
  confirmedCount: number;
  pendingCount: number;
  pendingValue: number;
  expiredCount: number;
  feeAccrued: number;
  chart: { day: string; count: number; volume: number }[];
  recent: {
    publicId: string;
    status: string;
    amountFiat: string;
    fiatCurrency: string;
    coin: string;
    network: string;
    createdAt: string;
    paidAt: string | null;
  }[];
}

function Chart({ data }: { data: { day: string; volume: number }[] }) {
  if (!data.length) {
    return <div className="flex h-48 items-center justify-center text-sm text-slate-500">No confirmed volume yet</div>;
  }
  const max = Math.max(...data.map((d) => d.volume), 1);
  return (
    <div className="flex h-48 items-end gap-1.5 overflow-x-auto">
      {data.map((d) => (
        <div key={d.day} className="group relative flex min-w-[14px] flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-t bg-brand-500/80 transition group-hover:bg-brand-600"
            style={{ height: `${Math.max(4, (d.volume / max) * 160)}px` }}
            title={`${d.day}: ${fmtMoney(d.volume)}`}
          />
          <span className="text-[9px] text-slate-400">{d.day.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['stats', 'overview'],
    queryFn: () => api<Overview>('/api/stats/overview?days=30'),
    refetchInterval: 15_000,
  });

  if (isLoading || !data) return <LoadingBlock />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Overview</h1>
          <p className="text-sm text-slate-500">Last {data.rangeDays} days — funds go directly to your wallet.</p>
        </div>
        <Link to="/invoices" className="btn-primary">
          + New invoice
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Volume (confirmed)" value={fmtMoney(data.volume)} sub={`${data.confirmedCount} paid invoices`} accent="green" />
        <StatCard label="Pending" value={String(data.pendingCount)} sub={fmtMoney(data.pendingValue)} accent="amber" />
        <StatCard label="Expired" value={String(data.expiredCount)} />
        <StatCard label="Platform fees accrued" value={fmtMoney(data.feeAccrued)} sub="settled periodically in crypto" accent="brand" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium">Confirmed volume</h2>
            <span className="text-xs text-slate-500">daily</span>
          </div>
          <Chart data={data.chart} />
        </div>

        <div className="card p-4">
          <h2 className="mb-3 font-medium">Recent invoices</h2>
          <div className="space-y-2">
            {data.recent.length === 0 && <div className="text-sm text-slate-500">Nothing yet — create your first invoice.</div>}
            {data.recent.map((r) => (
              <Link
                key={r.publicId}
                to={`/invoices/${r.publicId}`}
                className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm transition hover:border-brand-300 dark:border-slate-800"
              >
                <div>
                  <div className="font-mono text-xs">{r.publicId}</div>
                  <div className="text-xs text-slate-500">{fmtMoney(r.amountFiat, r.fiatCurrency)} · {r.coin}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusBadge status={r.status} />
                  <span className="text-[10px] text-slate-400">{fmtRelative(r.paidAt ?? r.createdAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function NetworkPill({ network, coin }: { network: string; coin: string }) {
  const meta = NETWORK_META[network];
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${meta?.color ?? ''}`}>
      {coin} · {network}
    </span>
  );
}

export { fmtCrypto };
