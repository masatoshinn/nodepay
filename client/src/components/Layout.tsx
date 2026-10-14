import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/', label: 'Overview', icon: '◈' },
  { to: '/invoices', label: 'Invoices', icon: '🧾' },
  { to: '/payments', label: 'Payments', icon: '⛓' },
  { to: '/wallets', label: 'Wallets', icon: '👛' },
  { to: '/api-keys', label: 'API Keys', icon: '🔑' },
  { to: '/webhooks', label: 'Webhooks', icon: '🔗' },
  { to: '/docs', label: 'API Docs', icon: '📘' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('np-theme', dark ? 'dark' : 'light');
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [location.pathname]);

  const nav = [...NAV, ...(user?.role === 'ADMIN' ? [{ to: '/admin', label: 'Admin', icon: '🛡' }] : [])];

  return (
    <div className="min-h-screen">
      {/* topbar */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="flex h-14 items-center gap-3 px-4">
          <button className="btn-ghost !px-2 md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">
            ☰
          </button>
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-sm text-white">N</span>
            NodePay
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              non-custodial
            </span>
          </Link>
          <div className="flex-1" />
          <button onClick={toggle} className="btn-ghost !px-2.5 !py-1.5" title="Toggle theme">
            {dark ? '☀️' : '🌙'}
          </button>
          <div className="relative group hidden sm:block">
            <button className="btn-ghost !py-1.5 text-xs">{user?.email}</button>
            <div className="invisible absolute right-0 top-full w-44 opacity-0 transition group-hover:visible group-hover:opacity-100">
              <div className="card mt-1 p-1">
                <button
                  className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={async () => {
                    await logout();
                    navigate('/login');
                  }}
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* sidebar */}
        <aside
          className={clsx(
            'fixed inset-y-14 left-0 z-30 w-56 transform border-r border-slate-200 bg-white transition dark:border-slate-800 dark:bg-slate-900 md:sticky md:top-14 md:h-[calc(100vh-3.5rem)] md:translate-x-0',
            open ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <nav className="space-y-1 p-3">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                    isActive
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  )
                }
              >
                <span className="w-4 text-center">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="absolute bottom-0 w-full border-t border-slate-200 p-4 text-xs text-slate-500 dark:border-slate-800">
            <div className="font-medium text-slate-600 dark:text-slate-300">{user?.name || user?.email}</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">{user?.plan} plan</span>
              <button
                className="underline hover:no-underline"
                onClick={async () => {
                  await logout();
                  navigate('/login');
                }}
              >
                sign out
              </button>
            </div>
          </div>
        </aside>

        {open && <div className="fixed inset-0 z-20 bg-slate-950/40 md:hidden" onClick={() => setOpen(false)} />}

        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
