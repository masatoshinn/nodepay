import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { Modal } from '../components/Modal';
import { LoadingBlock, EmptyState } from '../components/Loading';
import { StatusBadge } from '../components/StatusBadge';
import { CopyButton } from '../components/CopyButton';
import { fmtDate, fmtRelative } from '../lib/format';

interface Endpoint {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
  deliveryCount?: number;
}

interface Delivery {
  id: string;
  endpointId: string;
  endpointUrl: string;
  eventId: string;
  event: string;
  status: 'PENDING' | 'DELIVERED' | 'FAILED';
  attempts: number;
  responseCode: number | null;
  error: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  payload: unknown;
}

const ALL_EVENTS = ['invoice.detected', 'invoice.confirmed', 'invoice.expired', 'invoice.underpaid'];

export default function Webhooks() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [secret, setSecret] = useState<{ url: string; secret: string } | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => api<{ endpoints: Endpoint[]; availableEvents: string[] }>('/api/webhooks'),
  });

  const { data: deliveries, isLoading: loadingDeliveries } = useQuery({
    queryKey: ['webhook-deliveries', selected],
    queryFn: () =>
      api<{ deliveries: Delivery[] }>(`/api/webhooks/deliveries?limit=50${selected ? `&endpointId=${selected}` : ''}`),
    refetchInterval: 10_000,
  });

  const retry = useMutation({
    mutationFn: (id: string) => api(`/api/webhooks/deliveries/${id}/retry`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhook-deliveries'] }),
    onError: (e) => alert(e instanceof ApiError ? e.message : 'Retry failed'),
  });

  const rotate = useMutation({
    mutationFn: (id: string) => api<{ secret: string }>(`/api/webhooks/${id}/rotate-secret`, { method: 'POST' }),
    onSuccess: (d, id) => {
      const ep = data?.endpoints.find((e) => e.id === id);
      setSecret({ url: ep?.url ?? '', secret: d.secret });
    },
    onError: (e) => alert(e instanceof ApiError ? e.message : 'Rotate failed'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/webhooks/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });

  const toggle = useMutation({
    mutationFn: (ep: Endpoint) => api(`/api/webhooks/${ep.id}`, { method: 'PATCH', body: { active: !ep.active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  });

  if (isLoading) return <LoadingBlock />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Webhooks</h1>
          <p className="text-sm text-slate-500">
            Signed with HMAC-SHA256 (<code className="rounded bg-slate-100 px-1 dark:bg-slate-800">X-BazilPay-Signature</code>),
            retried with exponential backoff.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          + Add endpoint
        </button>
      </div>

      {!data?.endpoints.length ? (
        <div className="card">
          <EmptyState
            title="No webhook endpoints"
            hint="Get notified when invoices are detected, confirmed, expired or underpaid."
            action={
              <button className="btn-primary mt-2" onClick={() => setShowCreate(true)}>
                Add endpoint
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.endpoints.map((ep) => (
            <div key={ep.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm" title={ep.url}>
                    {ep.url}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(ep.events.length ? ep.events : ALL_EVENTS).map((e) => (
                      <span key={e} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {e}
                      </span>
                    ))}
                  </div>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    ep.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-slate-200 text-slate-500 dark:bg-slate-700'
                  }`}
                >
                  {ep.active ? 'active' : 'paused'}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setSelected(selected === ep.id ? '' : ep.id)}>
                  {selected === ep.id ? 'Hide log' : 'Delivery log'}
                </button>
                <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => rotate.mutate(ep.id)}>
                  Rotate secret
                </button>
                <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => toggle.mutate(ep)}>
                  {ep.active ? 'Pause' : 'Resume'}
                </button>
                <button
                  className="btn-ghost !px-2 !py-1 text-xs text-rose-600"
                  onClick={() => confirm('Delete endpoint & its delivery logs?') && remove.mutate(ep.id)}
                >
                  Delete
                </button>
              </div>
              <div className="mt-2 text-[11px] text-slate-400">
                {ep.deliveryCount ?? 0} deliveries · added {fmtDate(ep.createdAt)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* delivery logs */}
      <div className="card overflow-x-auto">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="font-medium">Delivery log {selected && '· filtered'}</h2>
        </div>
        {loadingDeliveries ? (
          <LoadingBlock />
        ) : !deliveries?.deliveries.length ? (
          <EmptyState title="No deliveries yet" hint="Webhook events will show up here with response codes and retry status." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">Endpoint</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Attempts</th>
                <th className="px-4 py-3">Response</th>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {deliveries.deliveries.map((d) => (
                <tr key={d.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                  <td className="px-4 py-3">
                    <div className="font-medium">{d.event}</div>
                    <div className="font-mono text-[10px] text-slate-400">{d.eventId.slice(0, 8)}</div>
                  </td>
                  <td className="max-w-[160px] truncate px-4 py-3 font-mono text-xs text-slate-500">{d.endpointUrl}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="px-4 py-3 tabular-nums">{d.attempts}</td>
                  <td className="px-4 py-3 text-xs">
                    {d.responseCode ? <span className={d.responseCode < 300 ? 'text-emerald-600' : 'text-rose-600'}>HTTP {d.responseCode}</span> : d.error ? <span className="text-rose-600">{d.error}</span> : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{fmtRelative(d.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {d.status !== 'DELIVERED' && (
                      <button className="btn-ghost !px-2 !py-1 text-xs" disabled={retry.isPending} onClick={() => retry.mutate(d.id)}>
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CreateEndpoint
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(url, s) => {
          setSecret({ url, secret: s });
          qc.invalidateQueries({ queryKey: ['webhooks'] });
        }}
        onError={setError}
      />

      <Modal open={!!secret} onClose={() => setSecret(null)} title="Webhook signing secret">
        {secret && (
          <div className="space-y-3">
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              Shown once. Use it to verify <code>X-BazilPay-Signature</code>.
            </div>
            <div className="text-sm text-slate-500">{secret.url}</div>
            <div className="flex gap-2">
              <input className="input font-mono text-xs" readOnly value={secret.secret} />
              <CopyButton value={secret.secret} />
            </div>
            <button className="btn-primary w-full" onClick={() => setSecret(null)}>
              Done
            </button>
          </div>
        )}
      </Modal>
      {error && <div className="text-sm text-rose-600">{error}</div>}
    </div>
  );
}

function CreateEndpoint({
  open,
  onClose,
  onCreated,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (url: string, secret: string) => void;
  onError: (msg: string) => void;
}) {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>([...ALL_EVENTS]);

  const create = useMutation({
    mutationFn: () => api<{ endpoint: Endpoint; secret: string }>('/api/webhooks', { method: 'POST', body: { url, events } }),
    onSuccess: (d) => {
      onCreated(d.endpoint.url, d.secret);
      setUrl('');
      onClose();
    },
    onError: (e) => onError(e instanceof ApiError ? e.message : 'Failed to create endpoint'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Add webhook endpoint">
      <div className="space-y-4">
        <div>
          <label className="label">Endpoint URL</label>
          <input className="input font-mono text-xs" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-store.com/webhooks/nodepay" />
        </div>
        <div>
          <label className="label">Events</label>
          <div className="space-y-1.5">
            {ALL_EVENTS.map((ev) => (
              <label key={ev} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={events.includes(ev)}
                  onChange={(e) => setEvents((prev) => (e.target.checked ? [...prev, ev] : prev.filter((x) => x !== ev)))}
                />
                <code>{ev}</code>
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!url || !events.length || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
