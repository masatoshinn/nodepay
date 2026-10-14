import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, downloadCsv, ApiError } from '../lib/api';
import { PAIRS } from '../lib/pairs';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import { LoadingBlock, EmptyState } from '../components/Loading';
import { fmtMoney, fmtDate, NETWORK_META } from '../lib/format';
import { NetworkPill } from './Dashboard';

interface InvoiceRow {
  publicId: string;
  orderId: string | null;
  status: string;
  amountFiat: string;
  fiatCurrency: string;
  coin: string;
  network: string;
  cryptoAmount: string;
  address: string;
  txHash: string | null;
  createdAt: string;
  paidAt: string | null;
}

const STATUSES = ['WAITING', 'DETECTED', 'CONFIRMING', 'PAID', 'UNDERPAID', 'OVERPAID', 'EXPIRED', 'CANCELED'];

export default function Invoices() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  const status = params.get('status') ?? '';
  const coin = params.get('coin') ?? '';
  const network = params.get('network') ?? '';
  const q = params.get('q') ?? '';
  const page = Number(params.get('page') ?? 1);

  const qs = new URLSearchParams({ page: String(page), limit: '25' });
  if (status) qs.set('status', status);
  if (coin) qs.set('coin', coin);
  if (network) qs.set('network', network);
  if (q) qs.set('q', q);

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', qs.toString()],
    queryFn: () => api<{ invoices: InvoiceRow[]; total: number; pages: number }>(`/api/invoices?${qs}`),
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
          <h1 className="text-xl font-semibold">Invoices</h1>
          <p className="text-sm text-slate-500">Payment links & manual invoices</p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-ghost"
            onClick={async () => {
              const url = await downloadCsv(`/api/invoices/export.csv?${qs}`);
              const a = document.createElement('a');
              a.href = url;
              a.click();
            }}
          >
            ⬇ CSV
          </button>
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>
            + New invoice
          </button>
        </div>
      </div>

      {/* filters */}
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <select className="input !w-auto" value={status} onChange={(e) => setParam('status', e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select className="input !w-auto" value={coin} onChange={(e) => setParam('coin', e.target.value)}>
          <option value="">All coins</option>
          {[...new Set(PAIRS.map((p) => p.coin))].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select className="input !w-auto" value={network} onChange={(e) => setParam('network', e.target.value)}>
          <option value="">All networks</option>
          {Object.keys(NETWORK_META).map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <input className="input !w-56" placeholder="Search order id / address…" value={q} onChange={(e) => setParam('q', e.target.value)} />
        {(status || coin || network || q) && (
          <button className="btn-ghost !py-1.5 text-xs" onClick={() => setParams({}, { replace: true })}>
            Clear
          </button>
        )}
      </div>

      <div className="card overflow-x-auto">
        {isLoading ? (
          <LoadingBlock />
        ) : !data?.invoices.length ? (
          <EmptyState
            title="No invoices yet"
            hint="Create a payment link or invoice — customers pay directly to your wallet."
            action={
              <button className="btn-primary mt-2" onClick={() => setCreateOpen(true)}>
                Create invoice
              </button>
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Pay in crypto</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((inv) => (
                <tr key={inv.publicId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs">{inv.publicId}</div>
                    {inv.orderId && <div className="text-xs text-slate-500">order: {inv.orderId}</div>}
                  </td>
                  <td className="px-4 py-3 font-medium">{fmtMoney(inv.amountFiat, inv.fiatCurrency)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <NetworkPill network={inv.network} coin={inv.coin} />
                      <span className="font-mono text-xs text-slate-500">{inv.cryptoAmount}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={inv.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(inv.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/invoices/${inv.publicId}`} className="btn-ghost !px-2 !py-1 text-xs">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
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

      <CreateInvoiceModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          qc.invalidateQueries({ queryKey: ['invoices'] });
          setCreateOpen(false);
          navigate(`/invoices/${id}`);
        }}
      />
    </div>
  );
}

function CreateInvoiceModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (publicId: string) => void }) {
  const [amount, setAmount] = useState('');
  const [fiat, setFiat] = useState('USD');
  const [pairIdx, setPairIdx] = useState(0);
  const [description, setDescription] = useState('');
  const [orderId, setOrderId] = useState('');
  const [successUrl, setSuccessUrl] = useState('');
  const [ttl, setTtl] = useState('30');
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api<{ invoice: { publicId: string } }>('/api/invoices', {
        method: 'POST',
        body: {
          amountFiat: Number(amount),
          fiatCurrency: fiat,
          coin: PAIRS[pairIdx].coin,
          network: PAIRS[pairIdx].network,
          description: description || undefined,
          orderId: orderId || undefined,
          successUrl: successUrl || undefined,
          ttlMinutes: Number(ttl),
        },
      }),
    onSuccess: (d) => onCreated(d.invoice.publicId),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to create invoice'),
  });

  return (
    <Modal open={open} onClose={onClose} title="New invoice">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="label">Amount</label>
            <input className="input" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100.00" />
          </div>
          <div>
            <label className="label">Currency</label>
            <select className="input" value={fiat} onChange={(e) => setFiat(e.target.value)}>
              <option>USD</option>
              <option>EUR</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Coin & network</label>
          <select className="input" value={pairIdx} onChange={(e) => setPairIdx(Number(e.target.value))}>
            {PAIRS.map((p, i) => (
              <option key={i} value={i}>
                {p.coin} — {p.network}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Description</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Order #1234" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Order ID (optional)</label>
            <input className="input" value={orderId} onChange={(e) => setOrderId(e.target.value)} />
          </div>
          <div>
            <label className="label">Expires (minutes)</label>
            <input className="input" type="number" min={5} max={1440} value={ttl} onChange={(e) => setTtl(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Success redirect URL (optional)</label>
          <input className="input" value={successUrl} onChange={(e) => setSuccessUrl(e.target.value)} placeholder="https://store.com/thanks" />
        </div>
        {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!amount || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create invoice'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
