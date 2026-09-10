import { create } from 'zustand';
import type { User } from '../types';
import { auth as authApi, setToken, clearToken, getToken } from '../lib/ipc';

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadCurrentUser: () => Promise<void>;
  hasPermission: (code: string) => boolean;
  hasAnyPermission: (codes: string[]) => boolean;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: getToken(),
  loading: false,
  error: null,

  login: async (username: string, password: string) => {
    set({ loading: true, error: null });
    try {
      const { token, user } = await authApi.login(username, password);
      setToken(token);
      set({ user, token, loading: false });
    } catch (err: any) {
      set({ loading: false, error: err.message || 'Login failed' });
      throw err;
    }
  },

  logout: async () => {
    try {
      await authApi.logout();
    } catch (e) {
      // ignore - we're logging out anyway
    }
    clearToken();
    set({ user: null, token: null });
  },

  loadCurrentUser: async () => {
    const token = getToken();
    if (!token) {
      set({ user: null, token: null });
      return;
    }
    try {
      const user = await authApi.me();
      if (user) {
        set({ user, token });
      } else {
        clearToken();
        set({ user: null, token: null });
      }
    } catch (err) {
      clearToken();
      set({ user: null, token: null });
    }
  },

  hasPermission: (code: string) => {
    const { user } = get();
    if (!user) return false;
    if (user.roleId === 'role-super-admin') return true;
    return user.permissions.includes(code);
  },

  hasAnyPermission: (codes: string[]) => {
    const { user } = get();
    if (!user) return false;
    if (user.roleId === 'role-super-admin') return true;
    return codes.some((c) => user.permissions.includes(c));
  },

  clear: () => {
    clearToken();
    set({ user: null, token: null, loading: false, error: null });
  },
}));
