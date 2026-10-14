import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api, publicApi, ApiError } from '../lib/api';
import { CopyButton } from '../components/CopyButton';
import { Spinner } from '../components/Loading';
import { countdown, explorerTxUrl, fmtCrypto, fmtMoney } from '../lib/format';
import { PAIRS, REQUIRED_CONFIRMATIONS } from '../lib/pairs';

interface CheckoutData {
  invoice: {
    publicId: string;
    status: string;
    amountFiat: string;
    fiatCurrency: string;
    coin: string;
    network: string;
    lockedRate: string;
    cryptoAmount: string;
    address: string;
    addressMode: string;
    confirmations: number;
    requiredConfirm: number;
    netCryptoReceived: string | null;
    txHash: string | null;
    successUrl: string | null;
    expiresAt: string;
    expiresInMs: number;
    paidAt: string | null;
    description: string | null;
    orderId: string | null;
    uri: string;
  };
  merchant: { name: string };
}

const STATUS_COPY: Record<string, { title: string; text: string; tone: string }> = {
  WAITING: {
    title: 'Waiting for payment',
    text: 'Send the exact amount below to the address shown. Detection usually takes a few seconds.',
    tone: 'text-amber-600 dark:text-amber-400',
  },
  DETECTED: {
    title: 'Payment detected ✓',
    text: 'We saw your transaction. It will move to confirming once included in a block.',
    tone: 'text-sky-600 dark:text-sky-400',
  },
  CONFIRMING: {
    title: 'Confirming…',
    text: 'Your transaction is in the blockchain and waiting for network confirmations.',
    tone: 'text-indigo-600 dark:text-indigo-400',
  },
  PAID: {
    title: 'Payment complete 🎉',
    text: 'This invoice has been paid and confirmed. You can close this page.',
    tone: 'text-emerald-600 dark:text-emerald-400',
  },
  UNDERPAID: {
    title: 'Underpaid',
    text: 'The amount received is less than required. Send the missing amount to the same address to complete payment.',
    tone: 'text-rose-600 dark:text-rose-400',
  },
  OVERPAID: {
    title: 'Overpaid',
    text: 'We received more than the requested amount. Your payment still counts — it is being confirmed.',
    tone: 'text-violet-600 dark:text-violet-400',
  },
  EXPIRED: {
    title: 'Invoice expired',
    text: 'The payment window has closed. Ask the merchant for a new invoice before sending funds.',
    tone: 'text-slate-500',
  },
  CANCELED: {
    title: 'Invoice canceled',
    text: 'This invoice was canceled by the merchant.',
    tone: 'text-slate-500',
  },
};

function useThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

export default function Checkout() {
  const { publicId } = useParams<{ publicId: string }>();
  const [search, setSearch] = useSearchParams();
  const { dark, toggle } = useThemeToggle();
  const [qr, setQr] = useState('');
  const [now, setNow] = useState(Date.now());
  const [switching, setSwitching] = useState(false);
  const redirectDone = useRef(false);
  const from = search.get('from');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['checkout', publicId],
    queryFn: () => publicApi<CheckoutData>(`/api/public/invoices/${publicId}`),
    refetchInterval: (query) => {
      const s = query.state.data?.invoice.status;
      if (s && ['PAID', 'EXPIRED', 'CANCELED'].includes(s)) return false;
      return 4000;
    },
    retry: 1,
  });

  // clock for countdown
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const inv = data?.invoice;

  // QR from payment URI
  useEffect(() => {
    if (!inv?.uri) return;
    QRCode.toDataURL(inv.uri, {
      width: 240,
      margin: 1,
      color: { dark: dark ? '#f1f5f9' : '#0f172a', light: dark ? '#0f172a' : '#ffffff' },
    })
      .then(setQr)
      .catch(() => setQr(''));
  }, [inv?.uri, dark]);

  // redirect to merchant success URL after payment
  useEffect(() => {
    if (inv?.status === 'PAID' && inv.successUrl && !redirectDone.current) {
      redirectDone.current = true;
      const t = setTimeout(() => {
        window.location.href = inv.successUrl!;
      }, 2500);
      return () => clearTimeout(t);
    }
  }, [inv?.status, inv?.successUrl]);

  // restore checkout after network switch (from=<originalId>)
  const switchCoin = async (coin: string, network: string) => {
    if (!inv || switching) return;
    if (inv.coin === coin && inv.network === network) return;
    setSwitching(true);
    try {
      const res = await api<{ publicId: string }>('/api/public/requote', {
        method: 'POST',
        auth: false,
        body: { from: inv.publicId, coin, network },
      });
      const next = new URLSearchParams(search);
      next.set('from', inv.publicId);
      setSearch(next, { replace: true });
      window.location.href = `/pay/${res.publicId}?${next.toString()}`;
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Could not switch network');
    } finally {
      setSwitching(false);
    }
  };

  const copy = useMemo(() => (inv ? STATUS_COPY[inv.status] ?? STATUS_COPY.WAITING : null), [inv?.status]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 text-slate-500">
        <Spinner className="h-6 w-6" /> Loading checkout…
      </div>
    );
  }

  if (error || !inv || !data) {
    const msg = error instanceof ApiError ? error.message : 'Invoice not found';
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
        <div className="text-4xl">🔍</div>
        <h1 className="text-lg font-semibold">Invoice unavailable</h1>
        <p className="text-sm text-slate-500">{msg}</p>
      </div>
    );
  }

  const expiresMs = Math.max(0, new Date(inv.expiresAt).getTime() - now);
  const required = inv.requiredConfirm || REQUIRED_CONFIRMATIONS[inv.network] || 1;
  const missing =
    inv.status === 'UNDERPAID' && inv.netCryptoReceived
      ? Math.max(0, Number(inv.cryptoAmount) - Number(inv.netCryptoReceived))
      : 0;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-lg px-4 py-6">
        {/* header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-sm text-white">N</span>
            NodePay
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">{data.merchant.name}</span>
            <button onClick={toggle} className="btn-ghost !px-2 !py-1.5" title="Theme">
              {dark ? '☀️' : '🌙'}
            </button>
          </div>
        </div>

        <div className="card overflow-hidden">
          {/* amount header */}
          <div className="border-b border-slate-200 bg-slate-50 p-5 text-center dark:border-slate-800 dark:bg-slate-900/60">
            <div className="text-xs uppercase tracking-widest text-slate-500">Amount due</div>
            <div className="mt-1 text-3xl font-bold tabular-nums">{fmtMoney(inv.amountFiat, inv.fiatCurrency)}</div>
            <div className="mt-1 text-sm text-slate-500">
              ≈ <span className="font-semibold text-slate-800 dark:text-slate-200">{fmtCrypto(inv.cryptoAmount, inv.coin)}</span>{' '}
              <span className="text-xs">(rate locked: {Number(inv.lockedRate).toFixed(2)} {inv.fiatCurrency}/{inv.coin})</span>
            </div>
            {inv.description && <div className="mt-2 text-sm text-slate-600 dark:text-slate-400">{inv.description}</div>}
          </div>

          {/* status */}
          <div className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className={`flex items-center gap-2 font-semibold ${copy?.tone ?? ''}`}>
                  {['WAITING', 'DETECTED', 'CONFIRMING'].includes(inv.status) && <Spinner className="h-4 w-4" />}
                  {copy?.title}
                </div>
                <p className="mt-1 text-xs text-slate-500">{copy?.text}</p>
              </div>
              {inv.status === 'WAITING' && (
                <div className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-center dark:border-slate-700">
                  <div className="text-[10px] uppercase text-slate-500">expires</div>
                  <div className={`font-mono text-lg font-semibold tabular-nums ${expiresMs < 5 * 60_000 ? 'text-rose-500' : ''}`}>
                    {countdown(expiresMs)}
                  </div>
                </div>
              )}
            </div>

            {(inv.status === 'CONFIRMING' || inv.status === 'PAID' || inv.status === 'DETECTED') && (
              <div className="mb-4">
                <div className="mb-1 flex justify-between text-xs text-slate-500">
                  <span>Confirmations</span>
                  <span>
                    {inv.confirmations}/{required}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-brand-500 transition-all duration-700"
                    style={{ width: `${Math.min(100, (inv.confirmations / required) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {inv.status === 'UNDERPAID' && missing > 0 && (
              <div className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                Missing: <strong>{fmtCrypto(missing, inv.coin)}</strong>
              </div>
            )}

            {inv.status === 'PAID' && (
              <div className="mb-4 rounded-lg bg-emerald-50 px-3 py-3 text-center text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                ✅ Paid on {inv.paidAt ? new Date(inv.paidAt).toLocaleString() : ''}
                {inv.successUrl && <div className="mt-1 text-xs opacity-70">Redirecting to merchant…</div>}
              </div>
            )}

            {/* network selector */}
            {!['PAID', 'EXPIRED', 'CANCELED'].includes(inv.status) && (
              <div className="mb-4">
                <div className="label">Pay on network</div>
                <div className="flex flex-wrap gap-1.5">
                  {PAIRS.filter((p) => p.coin === inv.coin || p.network === inv.network).map((p) => {
                    const active = p.coin === inv.coin && p.network === inv.network;
                    return (
                      <button
                        key={`${p.coin}-${p.network}`}
                        disabled={switching}
                        onClick={() => switchCoin(p.coin, p.network)}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                          active
                            ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                            : 'border-slate-200 text-slate-600 hover:border-brand-300 dark:border-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {p.coin} <span className="opacity-60">· {p.network}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* QR + address */}
            {inv.status !== 'EXPIRED' && inv.status !== 'CANCELED' && (
              <div className="space-y-3">
                <div className="flex flex-col items-center gap-3 sm:flex-row">
                  <div className="rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700">
                    {qr ? <img src={qr} alt="Payment QR code" width={180} height={180} className="h-[180px] w-[180px]" /> : <div className="flex h-[180px] w-[180px] items-center justify-center"><Spinner /></div>}
                  </div>
                  <div className="w-full min-w-0 space-y-3">
                    <div>
                      <div className="label flex items-center justify-between">
                        <span>Send exactly</span>
                        <CopyButton value={inv.cryptoAmount} label="copy amount" />
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm font-semibold break-all dark:border-slate-700 dark:bg-slate-900">
                        {inv.cryptoAmount} {inv.coin}
                      </div>
                    </div>
                    <div>
                      <div className="label flex items-center justify-between">
                        <span>{inv.coin} address on {inv.network}</span>
                        <CopyButton value={inv.address} label="copy address" />
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs break-all dark:border-slate-700 dark:bg-slate-900">
                        {inv.address}
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {inv.addressMode === 'HD'
                        ? 'Unique address derived for this invoice — safe & private.'
                        : inv.addressMode === 'AMOUNT_OFFSET'
                          ? 'Amount includes a unique decimal offset for matching — send the exact amount.'
                          : 'Merchant wallet address — include the exact amount & memo.'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {inv.txHash && (
              <div className="mt-3 text-center text-xs">
                {(() => {
                  const url = explorerTxUrl(inv.network, inv.txHash!);
                  return url ? (
                    <a href={url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                      View transaction on explorer ↗
                    </a>
                  ) : null;
                })()}
              </div>
            )}

            {(inv.status === 'EXPIRED' || inv.status === 'CANCELED') && from && (
              <button
                className="btn-primary mt-2 w-full"
                onClick={() => {
                  window.location.href = `/pay/${from}`;
                }}
              >
                ← Back to previous network
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-3 text-[11px] text-slate-400">
          <span>Powered by NodePay · non-custodial</span>
          <span>·</span>
          <span className="font-mono">{inv.publicId}</span>
        </div>
      </div>
    </div>
  );
}
