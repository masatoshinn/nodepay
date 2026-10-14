import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function Register() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const strength = Math.min(4, Math.floor(password.length / 4));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signup(email, password, name || undefined);
      navigate('/');
    } catch (err: any) {
      setError(err?.message ?? 'Signup failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-md p-6">
        <Link to="/" className="mb-6 flex items-center gap-2 text-lg font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">N</span>
          NodePay
        </Link>
        <h1 className="text-xl font-semibold">Create your account</h1>
        <p className="mt-1 text-sm text-slate-500">Email + password only. No KYC, no custody — payments go straight to your wallet.</p>

        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <div>
            <label className="label">Store name (optional)</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Store" />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@store.com" />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 8 characters" />
            <div className="mt-1.5 flex gap-1">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`h-1 flex-1 rounded ${i < strength ? (strength >= 3 ? 'bg-emerald-500' : 'bg-amber-500') : 'bg-slate-200 dark:bg-slate-700'}`} />
              ))}
            </div>
          </div>
          {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <p className="mt-4 text-sm text-slate-500">
          Already registered?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
