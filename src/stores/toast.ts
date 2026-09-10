import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  duration?: number; // ms
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string, duration?: number) => void;
  dismiss: (id: string) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const DEFAULT_DURATION = 4000;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push: (kind, message, duration = DEFAULT_DURATION) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set((state) => ({
      toasts: [...state.toasts, { id, kind, message, duration }],
    }));
    if (duration > 0) {
      setTimeout(() => {
        get().dismiss(id);
      }, duration);
    }
  },

  dismiss: (id: string) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  success: (msg, dur) => get().push('success', msg, dur),
  error: (msg, dur) => get().push('error', msg, dur ?? 6000),
  warning: (msg, dur) => get().push('warning', msg, dur),
  info: (msg, dur) => get().push('info', msg, dur),
}));
