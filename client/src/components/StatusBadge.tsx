import { STATUS_STYLES } from '../lib/format';
import clsx from 'clsx';

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
        className
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {status.toLowerCase()}
    </span>
  );
}
