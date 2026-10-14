import clsx from 'clsx';

export function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'brand' | 'green' | 'amber' | 'red';
}) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div
        className={clsx(
          'mt-1 text-2xl font-semibold tabular-nums',
          accent === 'green' && 'text-emerald-600 dark:text-emerald-400',
          accent === 'amber' && 'text-amber-600 dark:text-amber-400',
          accent === 'red' && 'text-rose-600 dark:text-rose-400',
          accent === 'brand' && 'text-brand-600 dark:text-brand-400'
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
