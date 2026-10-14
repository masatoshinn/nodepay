import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingBlock, EmptyState } from '../components/Loading';
import { fmtMoney, fmtDate, fmtRelative } from '../lib/format';

interface Merchant {
  id: string;
  email: string;
  name: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  plan: 'FREE' | 'PRO';
  feeBps: number;
  createdAt: string;
  lastLoginAt: string | null;
  invoiceCount: number;
  paidCount: number;
  volume: number;
  feesAccrued: number;
}

interface AdminStats {
  merchants: number;
  suspended: number;
  volume: number;
  confirmedInvoices: number;
  fees: { status: string; total: number; count: number }[];
  byStatus: Record<string, number>;
  recentAudit: { id: string; action: string; target: string | null; userId: string | null; ip: string | null; createdAt: string }[];
}

interface FeeRow {
  id: string;
  invoiceId: string;
  merchant: string;
  plan: string;
  value: number;
  feeBps: number;
  fee: number;
  status: 'ACCRUED' | 'BILLED' | 'PAID';
  createdAt: string;
}

export default function Admin() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'overview' | 'merchants' | 'fees' | 'audit'>('overview');
  const [q, setQ] = useState('');

  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: () => api<AdminStats>('/api/admin/stats'), refetchInterval: 30_000 });
  const merchants = useQuery({
    queryKey: ['admin-merchants', q],
    queryFn: () => api<{ merchants: Merchant[]; total: number }>(`/api/admin/merchants?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    enabled: tab === 'merchants',
  });
  const fees = useQuery({
    queryKey: ['admin-fees'],
    queryFn: () => api<{ fees: FeeRow[]; sum: number; total: number }>('/api/admin/fees?limit=50'),
    enabled: tab === 'fees',
  });

  const updateMerchant = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api(`/api/admin/merchants/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-merchants'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
    onError: (e) => alert(e instanceof ApiError ? e.message : 'Update failed'),
  });

  const updateFee = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api(`/api/admin/fees/${id}/status`, { method: 'POST', body: { status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-fees'] }),
  });

  if (stats.isLoading) return <LoadingBlock />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Admin</h1>
          <p className="text-sm text-slate-500">Merchants, platform volume & accrued fees</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-slate-200 p-1 dark:border-slate-700">
          {(['overview', 'merchants', 'fees', 'audit'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
                tab === t ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && stats.data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Merchants" value={String(stats.data.merchants)} sub={`${stats.data.suspended} suspended`} />
            <StatCard label="Platform volume" value={fmtMoney(stats.data.volume)} sub={`${stats.data.confirmedInvoices} paid invoices`} accent="green" />
            <StatCard
              label="Fees accrued"
              value={fmtMoney(stats.data.fees.reduce((s, f) => s + (f.status === 'PAID' ? 0 : f.total), 0))}
              sub={`${fmtMoney(stats.data.fees.find((f) => f.status === 'PAID')?.total ?? 0)} settled`}
              accent="brand"
            />
            <StatCard label="Open invoices" value={String((stats.data.byStatus.WAITING ?? 0) + (stats.data.byStatus.DETECTED ?? 0) + (stats.data.byStatus.CONFIRMING ?? 0))} accent="amber" />
          </div>
          <div className="card p-4">
            <h2 className="mb-3 font-medium">Invoices by status</h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats.data.byStatus).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                  <StatusBadge status={k} /> <span className="ml-2 font-semibold">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === 'merchants' && (
        <>
          <div className="card p-3">
            <input className="input" placeholder="Search merchants by email…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="card overflow-x-auto">
            {merchants.isLoading ? (
              <LoadingBlock />
            ) : !merchants.data?.merchants.length ? (
              <EmptyState title="No merchants found" />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
                    <th className="px-4 py-3">Merchant</th>
                    <th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3">Volume</th>
                    <th className="px-4 py-3">Invoices</th>
                    <th className="px-4 py-3">Fees</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {merchants.data.merchants.map((m) => (
                    <tr key={m.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                      <td className="px-4 py-3">
                        <div className="font-medium">{m.email}</div>
                        <div className="text-xs text-slate-500">
                          joined {fmtDate(m.createdAt)} · last login {m.lastLoginAt ? fmtRelative(m.lastLoginAt) : 'never'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className="input !w-auto !py-1 text-xs"
                          value={m.plan}
                          onChange={(e) =>
                            updateMerchant.mutate({
                              id: m.id,
                              body: { plan: e.target.value, feeBps: e.target.value === 'PRO' ? 0 : 100 },
                            })
                          }
                        >
                          <option value="FREE">FREE</option>
                          <option value="PRO">PRO</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 font-medium">{fmtMoney(m.volume)}</td>
                      <td className="px-4 py-3">
                        {m.paidCount}/{m.invoiceCount} paid
                      </td>
                      <td className="px-4 py-3">{fmtMoney(m.feesAccrued)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={m.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          className={m.status === 'ACTIVE' ? 'btn-ghost !px-2 !py-1 text-xs text-rose-600' : 'btn-ghost !px-2 !py-1 text-xs'}
                          onClick={() =>
                            confirm(`${m.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'} ${m.email}?`) &&
                            updateMerchant.mutate({ id: m.id, body: { status: m.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' } })
                          }
                        >
                          {m.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'fees' && (
        <div className="card overflow-x-auto">
          <div className="border-b border-slate-200 px-4 py-3 text-sm dark:border-slate-800">
            Total accrued: <strong>{fmtMoney(fees.data?.sum ?? 0)}</strong>
          </div>
          {fees.isLoading ? (
            <LoadingBlock />
          ) : !fees.data?.fees.length ? (
            <EmptyState title="No fee accruals yet" hint="Fees accrue automatically when invoices confirm (1% on FREE plan)." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
                  <th className="px-4 py-3">Merchant</th>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Value</th>
                  <th className="px-4 py-3">Fee</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {fees.data.fees.map((f) => (
                  <tr key={f.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                    <td className="px-4 py-3">
                      {f.merchant}
                      <div className="text-xs text-slate-500">{f.plan} plan</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{f.invoiceId}</td>
                    <td className="px-4 py-3">{fmtMoney(f.value)}</td>
                    <td className="px-4 py-3 font-medium">
                      {fmtMoney(f.fee)} <span className="text-xs text-slate-400">({(f.feeBps / 100).toFixed(2)}%)</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={f.status === 'PAID' ? 'PAID' : f.status === 'BILLED' ? 'CONFIRMING' : 'WAITING'} />
                    </td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(f.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <select
                        className="input !w-auto !py-1 text-xs"
                        value={f.status}
                        onChange={(e) => updateFee.mutate({ id: f.id, status: e.target.value })}
                      >
                        <option value="ACCRUED">accrued</option>
                        <option value="BILLED">billed</option>
                        <option value="PAID">paid</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'audit' && stats.data && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">IP</th>
                <th className="px-4 py-3">When</th>
              </tr>
            </thead>
            <tbody>
              {stats.data.recentAudit.map((a) => (
                <tr key={a.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                  <td className="px-4 py-3 font-medium">{a.action}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{a.target ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{a.ip ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
