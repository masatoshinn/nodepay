import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { Modal } from '../components/Modal';
import { LoadingBlock, EmptyState } from '../components/Loading';
import { CopyButton } from '../components/CopyButton';
import { fmtDate, fmtRelative } from '../lib/format';

interface ApiKey {
  id: string;
  name: string;
  publicKey: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export default function ApiKeys() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ publicKey: string; secret: string } | null>(null);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api<{ apiKeys: ApiKey[] }>('/api/api-keys'),
  });

  const create = useMutation({
    mutationFn: () => api<{ apiKey: ApiKey; secret: string }>('/api/api-keys', { method: 'POST', body: { name } }),
    onSuccess: (d) => {
      setCreated({ publicKey: d.apiKey.publicKey, secret: d.secret });
      setName('');
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed'),
  });

  const regenerate = useMutation({
    mutationFn: (id: string) => api<{ secret: string }>(`/api/api-keys/${id}/regenerate`, { method: 'POST' }),
    onSuccess: (d, id) => {
      const key = data?.apiKeys.find((k) => k.id === id);
      setCreated({ publicKey: key?.publicKey ?? '', secret: d.secret });
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (e) => alert(e instanceof ApiError ? e.message : 'Regenerate failed'),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  if (isLoading) return <LoadingBlock />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">API Keys</h1>
        <p className="text-sm text-slate-500">
          Authenticate server-to-server calls with <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">X-API-Key</code> +{' '}
          <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">X-API-Secret</code> headers.
        </p>
      </div>

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[220px] flex-1">
          <label className="label">Key name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Store backend" />
        </div>
        <button className="btn-primary" disabled={!name || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? 'Creating…' : '+ Create key'}
        </button>
        {error && <div className="w-full text-sm text-rose-600">{error}</div>}
      </div>

      <div className="card overflow-x-auto">
        {!data?.apiKeys.length ? (
          <EmptyState title="No API keys" hint="Create a key to start creating invoices via the API." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Public key</th>
                <th className="px-4 py-3">Last used</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.apiKeys.map((k) => (
                <tr key={k.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                  <td className="px-4 py-3 font-medium">{k.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-xs">{k.publicKey}</code>
                      <CopyButton value={k.publicKey} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{k.lastUsedAt ? fmtRelative(k.lastUsedAt) : 'never'}</td>
                  <td className="px-4 py-3">
                    {k.revokedAt ? (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">revoked</span>
                    ) : (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">active</span>
                    )}
                    <div className="text-[11px] text-slate-400">{fmtDate(k.createdAt)}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!k.revokedAt && (
                      <div className="flex justify-end gap-2">
                        <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => regenerate.mutate(k.id)}>
                          Regenerate
                        </button>
                        <button
                          className="btn-ghost !px-2 !py-1 text-xs text-rose-600"
                          onClick={() => confirm('Revoke this key? Requests using it will fail immediately.') && revoke.mutate(k.id)}
                        >
                          Revoke
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={!!created} onClose={() => setCreated(null)} title="Copy your secret now">
        {created && (
          <div className="space-y-3">
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              The secret is shown only once — we store a hash. Losing it means regenerating.
            </div>
            <div>
              <label className="label">Public key (X-API-Key)</label>
              <div className="flex gap-2">
                <input className="input font-mono text-xs" readOnly value={created.publicKey} />
                <CopyButton value={created.publicKey} />
              </div>
            </div>
            <div>
              <label className="label">Secret (X-API-Secret)</label>
              <div className="flex gap-2">
                <input className="input font-mono text-xs" readOnly value={created.secret} />
                <CopyButton value={created.secret} />
              </div>
            </div>
            <button className="btn-primary w-full" onClick={() => setCreated(null)}>
              I saved it
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
