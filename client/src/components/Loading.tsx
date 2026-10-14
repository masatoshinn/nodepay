export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-slate-300 border-t-brand-600 dark:border-slate-700 ${className}`}
      role="status"
      aria-label="loading"
    />
  );
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 p-10 text-sm text-slate-500">
      <Spinner />
      {label}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
      <div className="text-3xl">🗂️</div>
      <div className="font-medium">{title}</div>
      {hint && <div className="max-w-md text-sm text-slate-500">{hint}</div>}
      {action}
    </div>
  );
}
