import { useToastStore, type ToastKind } from '../stores/toast';
import { cn } from '../lib/utils';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

const KIND_STYLES: Record<ToastKind, { icon: React.ElementType; bg: string; text: string; border: string }> = {
  success: { icon: CheckCircle,    bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200' },
  error:   { icon: XCircle,         bg: 'bg-red-50',     text: 'text-red-800',     border: 'border-red-200' },
  warning: { icon: AlertTriangle,   bg: 'bg-amber-50',   text: 'text-amber-800',   border: 'border-amber-200' },
  info:    { icon: Info,            bg: 'bg-blue-50',    text: 'text-blue-800',    border: 'border-blue-200' },
};

export function ToastContainer() {
  const { toasts, dismiss } = useToastStore();
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => {
        const style = KIND_STYLES[t.kind];
        const Icon = style.icon;
        return (
          <div
            key={t.id}
            className={cn(
              'toast-enter pointer-events-auto flex items-start gap-3 p-3 rounded-lg border shadow-md',
              style.bg, style.text, style.border
            )}
          >
            <Icon className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-sm font-medium">{t.message}</div>
            <button
              onClick={() => dismiss(t.id)}
              className="text-current opacity-50 hover:opacity-100"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
