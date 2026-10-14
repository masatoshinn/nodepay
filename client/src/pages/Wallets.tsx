import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { NETWORKS } from '../lib/pairs';
import { Modal } from '../components/Modal';
import { LoadingBlock, EmptyState } from '../components/Loading';
import { CopyButton } from '../components/CopyButton';
import { NETWORK_META, fmtDate } from '../lib/format';

interface Wallet {
  id: string;
  network: string;
  address: string | null;
  hasXpub: boolean;
  xpubFingerprint: string | null;
  derivationPath: string | null;
  nextIndex: number;
  label: string | null;
  isDefault: boolean;
  createdAt: string;
}

export default function Wallets() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['wallets'],
    queryFn: () => api<{ wallets: Wallet[] }>('/api/wallets'),
  });

  const del = useMutation({
    mutationFn: (id: string) => api(`/api/wallets/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wallets'] }),
    onError: (e) => alert(e instanceof ApiError ? e.message : 'Delete failed'),
  });

  if (isLoading) return <LoadingBlock />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Wallets</h1>
          <p className="text-sm text-slate-500">
            Your addresses, your keys. NodePay only stores public addresses / xpubs — never private keys.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setOpen(true)}>
          + Add wallet
        </button>
      </div>

      {!data?.wallets.length ? (
        <div className="card">
          <EmptyState
            title="No wallets yet"
            hint="Add a receive address per network (or an xpub for unique per-invoice HD addresses) before creating invoices."
            action={
              <button className="btn-primary mt-2" onClick={() => setOpen(true)}>
                Add wallet
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.wallets.map((w) => (
            <div key={w.id} className="card p-4">
              <div className="flex items-center justify-between">
                <span className={`rounded px-2 py-1 text-xs font-medium ${NETWORK_META[w.network]?.color ?? ''}`}>
                  {w.network}
                </span>
                <div className="flex items-center gap-2">
                  {w.isDefault && (
                    <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                      default
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-3 text-sm font-medium">{w.label || 'Untitled wallet'}</div>
              {w.address ? (
                <div className="mt-1 break-all font-mono text-xs text-slate-500">{w.address}</div>
              ) : (
                <div className="mt-1 text-xs text-slate-500">
                  HD wallet · {w.xpubFingerprint}
                  <div className="text-[11px] text-slate-400">
                    path {w.derivationPath ?? 'default'} · next index #{w.nextIndex}
                  </div>
                </div>
              )}
              <div className="mt-3 flex items-center gap-2">
                {w.address && <CopyButton value={w.address} />}
                {w.hasXpub && (
                  <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setPreviewId(previewId === w.id ? null : w.id)}>
                    {previewId === w.id ? 'Hide addresses' : 'Next addresses'}
                  </button>
                )}
                <div className="flex-1" />
                <button className="btn-ghost !px-2 !py-1 text-xs text-rose-600" onClick={() => confirm('Remove this wallet?') && del.mutate(w.id)}>
                  Remove
                </button>
              </div>
              {previewId === w.id && <AddressPreview walletId={w.id} />}
              <div className="mt-2 text-[11px] text-slate-400">added {fmtDate(w.createdAt)}</div>
            </div>
          ))}
        </div>
      )}

      <AddWalletModal open={open} onClose={() => setOpen(false)} onSaved={() => qc.invalidateQueries({ queryKey: ['wallets'] })} />
    </div>
  );
}

function AddressPreview({ walletId }: { walletId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['wallet-addresses', walletId],
    queryFn: () => api<{ addresses: { index: number; address: string }[] }>(`/api/wallets/${walletId}/addresses?count=5`),
  });
  if (isLoading) return <div className="mt-2 text-xs text-slate-500">Deriving…</div>;
  return (
    <div className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
      {data?.addresses.map((a) => (
        <div key={a.index} className="flex items-center gap-2 text-[11px]">
          <span className="w-8 text-slate-400">#{a.index}</span>
          <span className="flex-1 truncate font-mono">{a.address}</span>
          <CopyButton value={a.address} label="copy" />
        </div>
      ))}
    </div>
  );
}

function AddWalletModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [network, setNetwork] = useState<(typeof NETWORKS)[number]>('BTC');
  const [mode, setMode] = useState<'address' | 'xpub'>('address');
  const [address, setAddress] = useState('');
  const [xpub, setXpub] = useState('');
  const [path, setPath] = useState('');
  const [label, setLabel] = useState('');
  const [isDefault, setIsDefault] = useState(true);
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api('/api/wallets', {
        method: 'POST',
        body: {
          network,
          label: label || undefined,
          isDefault,
          ...(mode === 'address' ? { address } : { xpub, derivationPath: path || undefined }),
        },
      }),
    onSuccess: () => {
      onSaved();
      onClose();
      setAddress('');
      setXpub('');
      setLabel('');
      setError('');
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to save wallet'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Add wallet">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Network</label>
            <select className="input" value={network} onChange={(e) => setNetwork(e.target.value as never)}>
              {NETWORKS.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Match by</label>
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value as never)}>
              <option value="address">Address</option>
              <option value="xpub">xpub (HD, recommended)</option>
            </select>
          </div>
        </div>

        {mode === 'address' ? (
          <div>
            <label className="label">Receive address</label>
            <input className="input font-mono text-xs" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="bc1q… / 0x… / T…" />
            <p className="mt-1 text-xs text-slate-500">
              For TRON & stablecoin-only setups, invoices get a unique decimal offset for matching.
            </p>
          </div>
        ) : (
          <>
            <div>
              <label className="label">Extended public key (xpub / ypub / zpub)</label>
              <textarea className="input font-mono text-xs" rows={3} value={xpub} onChange={(e) => setXpub(e.target.value)} placeholder="zpub6rFR7y4Q2AijBEqT… or xpub661MyMwAqRbc…" />
              <p className="mt-1 text-xs text-slate-500">
                xpub → legacy addresses, ypub → nested segwit, zpub → native segwit (bc1q…). Private keys are rejected by design.
              </p>
            </div>
            <div>
              <label className="label">Derivation path (optional)</label>
              <input className="input font-mono text-xs" value={path} onChange={(e) => setPath(e.target.value)} placeholder="m/84'/0'/0' (auto by network)" />
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Label</label>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Cold storage" />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
              Default for network
            </label>
          </div>
        </div>

        {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>}

        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={save.isPending || (mode === 'address' ? !address : !xpub)}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save wallet'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
