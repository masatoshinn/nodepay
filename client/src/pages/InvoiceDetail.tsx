import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { StatusBadge } from '../components/StatusBadge';
import { CopyButton } from '../components/CopyButton';
import { LoadingBlock } from '../components/Loading';
import { fmtMoney, fmtCrypto, fmtDate, countdown, explorerTxUrl, shortHash } from '../lib/format';
import { REQUIRED_CONFIRMATIONS } from '../lib/pairs';

interface Detail {
  invoice: {
    publicId: string;
    orderId: string | null;
    description: string | null;
    status: string;
    amountFiat: string;
    fiatCurrency: string;
    coin: string;
    network: string;
    lockedRate: string;
    cryptoAmount: string;
    addressMode: string;
    address: string;
    amountOffset: string | null;
    confirmations: number;
    requiredConfirm: number;
    netCryptoReceived: string | null;
    txHash: string | null;
    successUrl: string | null;
    expiresAt: string;
    paidAt: string | null;
    createdAt: string;
    checkoutUrl: string;
    payments: {
      id: string;
      txHash: string;
      amount: string;
      confirmations: number;
      status: string;
      blockNumber: number | null;
      detectedAt: string;
      confirmedAt: string | null;
    }[];
  };
}

const STEPS = ['WAITING', 'DETECTED', 'CONFIRMING', 'PAID'];

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api<Detail>(`/api/invoices/${id}`),
    refetchInterval: 5000,
  });

  const cancel = useMutation({
    mutationFn: () => api(`/api/invoices/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoice', id] }),
  });

  if (isLoading || !data) return <LoadingBlock />;
  const inv = data.invoice;
  const open = ['WAITING', 'DETECTED', 'CONFIRMING', 'UNDERPAID', 'OVERPAID'].includes(inv.status);
  const stepIdx =
    inv.status === 'PAID' ? 3 : inv.status === 'CONFIRMING' ? 2 : inv.status === 'DETECTED' || inv.status === 'UNDERPAID' || inv.status === 'OVERPAID' ? 1 : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/invoices" className="btn-ghost !px-2 !py-1.5">
            ←
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-mono text-lg font-semibold">{inv.publicId}</h1>
              <StatusBadge status={inv.status} />
            </div>
            <p className="text-sm text-slate-500">
              {inv.description || 'No description'} · created {fmtDate(inv.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link to={`/pay/${inv.publicId}`} className="btn-ghost" target="_blank">
            Open checkout ↗
          </Link>
          {['WAITING', 'UNDERPAID', 'OVERPAID'].includes(inv.status) && (
            <button className="btn-danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* progress */}
      <div className="card p-4">
        <div className="flex items-center">
          {STEPS.map((s, i) => (
            <div key={s} className={`flex flex-1 items-center ${i > 0 ? '' : ''}`}>
              {i > 0 && <div className={`h-0.5 flex-1 ${i <= stepIdx ? 'bg-brand-500' : 'bg-slate-200 dark:bg-slate-700'}`} />}
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                    i < stepIdx
                      ? 'bg-brand-600 text-white'
                      : i === stepIdx
                        ? 'border-2 border-brand-600 text-brand-600 dark:text-brand-400'
                        : 'border border-slate-300 text-slate-400 dark:border-slate-700'
                  }`}
                >
                  {i < stepIdx ? '✓' : i + 1}
                </div>
                <span className="text-[10px] uppercase tracking-wide text-slate-500">{s.toLowerCase()}</span>
              </div>
            </div>
          ))}
        </div>
        {inv.requiredConfirm > 0 && (inv.status === 'CONFIRMING' || inv.status === 'PAID') && (
          <div className="mt-3 text-sm text-slate-500">
            Confirmations: <span className="font-medium text-slate-800 dark:text-slate-200">{inv.confirmations}/{inv.requiredConfirm || REQUIRED_CONFIRMATIONS[inv.network]}</span>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card space-y-4 p-4 lg:col-span-2">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <div className="label">Fiat amount</div>
              <div className="text-lg font-semibold">{fmtMoney(inv.amountFiat, inv.fiatCurrency)}</div>
            </div>
            <div>
              <div className="label">Crypto amount</div>
              <div className="text-lg font-semibold">{fmtCrypto(inv.cryptoAmount, inv.coin)}</div>
            </div>
            <div>
              <div className="label">Locked rate</div>
              <div className="text-lg font-semibold">1 {inv.coin} = {Number(inv.lockedRate).toFixed(4)} {inv.fiatCurrency}</div>
            </div>
            <div>
              <div className="label">{open ? 'Expires in' : 'Expired at'}</div>
              <div className="text-lg font-semibold tabular-nums">{open ? countdown(new Date(inv.expiresAt).getTime() - Date.now()) : fmtDate(inv.expiresAt)}</div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <div className="mb-1 flex items-center justify-between">
              <span className="label !mb-0">
                Destination address · {inv.addressMode === 'HD' ? 'unique HD address' : inv.addressMode === 'AMOUNT_OFFSET' ? 'amount-offset match' : 'static address'}
              </span>
              <CopyButton value={inv.address} />
            </div>
            <div className="break-all font-mono text-sm">{inv.address}</div>
            {inv.amountOffset && (
              <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                Includes unique offset {inv.amountOffset} — send the exact amount shown.
              </div>
            )}
          </div>

          <div>
            <div className="label">Checkout URL</div>
            <div className="flex gap-2">
              <input className="input font-mono text-xs" readOnly value={inv.checkoutUrl} onFocus={(e) => e.target.select()} />
              <CopyButton value={inv.checkoutUrl} />
            </div>
          </div>

          <div>
            <div className="label">Payments ({inv.payments.length})</div>
            {inv.payments.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">
                No transactions detected yet. Watching the chain…
              </div>
            ) : (
              <div className="space-y-2">
                {inv.payments.map((p) => {
                  const url = explorerTxUrl(inv.network, p.txHash);
                  return (
                    <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                      <div className="min-w-0">
                        <div className="font-mono text-xs">{shortHash(p.txHash, 14)}</div>
                        <div className="text-xs text-slate-500">
                          {fmtCrypto(p.amount, inv.coin)} · detected {fmtDate(p.detectedAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">{p.confirmations}/{inv.requiredConfirm || REQUIRED_CONFIRMATIONS[inv.network]} conf</span>
                        <StatusBadge status={p.status} />
                        {url && (
                          <a href={url} target="_blank" rel="noreferrer" className="btn-ghost !px-2 !py-1 text-xs">
                            explorer ↗
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="card h-fit space-y-3 p-4 text-sm">
          <h2 className="font-medium">Details</h2>
          <Row k="Order ID" v={inv.orderId ?? '—'} />
          <Row k="Network" v={inv.network} />
          <Row k="Coin" v={inv.coin} />
          <Row k="Created" v={fmtDate(inv.createdAt)} />
          <Row k="Expires" v={fmtDate(inv.expiresAt)} />
          <Row k="Paid" v={inv.paidAt ? fmtDate(inv.paidAt) : '—'} />
          <Row k="Received" v={inv.netCryptoReceived ? fmtCrypto(inv.netCryptoReceived, inv.coin) : '—'} />
          {inv.successUrl && <Row k="Success URL" v={inv.successUrl} />}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 last:border-0 dark:border-slate-800">
      <span className="text-slate-500">{k}</span>
      <span className="max-w-[60%] truncate text-right font-medium" title={v}>
        {v}
      </span>
    </div>
  );
}
