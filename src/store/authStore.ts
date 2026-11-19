import { create } from 'zustand';
import { api, ApiError, errorMessage, setUnauthorizedHandler } from '../api/client';

export type Role = 'ADMIN' | 'USER';

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

interface AuthStore {
  status: 'loading' | 'guest' | 'authed';
  user: User | null;
  error: string | null;
  check(): Promise<void>;
  login(username: string, password: string): Promise<boolean>;
  logout(): Promise<void>;
  /** La sesión venció del lado del servidor. */
  expire(): void;
}

const listeners = new Set<() => void>();
/** Para que otros stores limpien su estado cuando el usuario sale. */
export function onLogout(fn: () => void) {
  listeners.add(fn);
}

export const useAuth = create<AuthStore>()((set, get) => ({
  status: 'loading',
  user: null,
  error: null,

  async check() {
    try {
      const { user } = await api<{ user: User }>('GET', '/auth/me');
      set({ status: 'authed', user, error: null });
    } catch (e) {
      set({
        status: 'guest',
        user: null,
        error: e instanceof ApiError && e.status === 401 ? null : errorMessage(e),
      });
    }
  },

  async login(username, password) {
    set({ error: null });
    try {
      const { user } = await api<{ user: User }>('POST', '/auth/login', { username, password });
      set({ status: 'authed', user });
      return true;
    } catch (e) {
      set({ error: errorMessage(e) });
      return false;
    }
  },

  async logout() {
    await api('POST', '/auth/logout').catch(() => undefined);
    get().expire();
    set({ error: null });
  },

  expire() {
    set({ status: 'guest', user: null, error: 'Tu sesión terminó. Volvé a ingresar.' });
    listeners.forEach((fn) => fn());
  },
}));

setUnauthorizedHandler(() => {
  if (useAuth.getState().status === 'authed') useAuth.getState().expire();
});
