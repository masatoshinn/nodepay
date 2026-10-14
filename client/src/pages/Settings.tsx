import { useState } from 'react';
import { useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { CopyButton } from '../components/CopyButton';

export default function Settings() {
  const { user, refreshMe } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!setup) return;
    QRCode.toDataURL(setup.otpauth, { width: 200, margin: 1 })
      .then(setQr)
      .catch(() => setQr(''));
  }, [setup]);

  const beginSetup = useMutation({
    mutationFn: () => api<{ secret: string; otpauth: string }>('/api/auth/2fa/setup', { method: 'POST' }),
    onSuccess: (d) => setSetup(d),
    onError: (e) => setMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'Setup failed' }),
  });

  const enable = useMutation({
    mutationFn: () => api('/api/auth/2fa/enable', { method: 'POST', body: { code } }),
    onSuccess: async () => {
      setMsg({ kind: 'ok', text: 'Two-factor authentication enabled.' });
      setSetup(null);
      setCode('');
      await refreshMe();
    },
    onError: (e) => setMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'Invalid code' }),
  });

  const disable = useMutation({
    mutationFn: () => api('/api/auth/2fa/disable', { method: 'POST', body: { code } }),
    onSuccess: async () => {
      setMsg({ kind: 'ok', text: 'Two-factor authentication disabled.' });
      setCode('');
      await refreshMe();
    },
    onError: (e) => setMsg({ kind: 'err', text: e instanceof ApiError ? e.message : 'Invalid code' }),
  });

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-slate-500">Account security & plan</p>
      </div>

      <div className="card p-4">
        <h2 className="mb-3 font-medium">Account</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between border-b border-slate-100 py-2 dark:border-slate-800">
            <span className="text-slate-500">Email</span>
            <span className="font-medium">{user?.email}</span>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-2 dark:border-slate-800">
            <span className="text-slate-500">Plan</span>
            <span className="font-medium">
              {user?.plan} · fee {((user?.feeBps ?? 0) / 100).toFixed(2)}% per confirmed invoice
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-slate-500">Role</span>
            <span className="font-medium">{user?.role}</span>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Non-custodial: NodePay never holds funds — fees accrue and are settled periodically via a fee invoice you pay
          yourself.
        </p>
      </div>

      <div className="card p-4">
        <h2 className="mb-1 font-medium">Two-factor authentication (TOTP)</h2>
        <p className="mb-3 text-sm text-slate-500">Add a one-time code from Google Authenticator / 1Password on login.</p>

        {user?.totpEnabled ? (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="label">Enter current code to disable</label>
              <input className="input font-mono" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" />
            </div>
            <button className="btn-danger" disabled={code.length !== 6 || disable.isPending} onClick={() => disable.mutate()}>
              Disable
            </button>
          </div>
        ) : setup ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-4 sm:flex-row">
              {qr ? <img src={qr} alt="TOTP QR code" width={200} height={200} className="rounded-lg border border-slate-200 dark:border-slate-700" /> : <div className="h-[200px] w-[200px] animate-pulse bg-slate-100 dark:bg-slate-800" />}
              <div className="min-w-0 flex-1 space-y-2 text-sm">
                <p className="text-slate-500">Scan the QR code, then enter the 6-digit code to confirm.</p>
                <div>
                  <label className="label">Manual key</label>
                  <div className="flex gap-2">
                    <input className="input font-mono text-xs" readOnly value={setup.secret} />
                    <CopyButton value={setup.secret} />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="label">Verification code</label>
                <input className="input font-mono" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" />
              </div>
              <button className="btn-primary" disabled={code.length !== 6 || enable.isPending} onClick={() => enable.mutate()}>
                {enable.isPending ? 'Verifying…' : 'Enable 2FA'}
              </button>
              <button className="btn-ghost" onClick={() => setSetup(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="btn-primary" disabled={beginSetup.isPending} onClick={() => beginSetup.mutate()}>
            {beginSetup.isPending ? 'Generating…' : 'Enable 2FA'}
          </button>
        )}

        {msg && (
          <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'}`}>
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}
