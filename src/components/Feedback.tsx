import { cn } from '../lib/utils';

export function Spinner({ className, size = 'md' }: { className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizeCls = size === 'sm' ? 'h-4 w-4 border-2' : size === 'lg' ? 'h-8 w-8 border-4' : 'h-5 w-5 border-2';
  return (
    <div
      className={cn('spinner', sizeCls, className)}
      role="status"
      aria-label="Loading"
    />
  );
}

export function LoadingScreen({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
      <Spinner size="lg" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

export function EmptyState({ title, message, icon }: { title: string; message?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon && <div className="text-slate-300 mb-3">{icon}</div>}
      <h3 className="text-sm font-semibold text-slate-700 mb-1">{title}</h3>
      {message && <p className="text-xs text-slate-500 max-w-sm">{message}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="text-red-400 mb-3 text-2xl">⚠</div>
      <h3 className="text-sm font-semibold text-slate-700 mb-1">Something went wrong</h3>
      <p className="text-xs text-slate-500 max-w-sm mb-3">{message}</p>
      {onRetry && <button className="btn-secondary btn-sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}
