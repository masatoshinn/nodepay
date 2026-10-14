import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, clearTokens, getRefreshToken, setTokens } from './api';

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: 'MERCHANT' | 'ADMIN';
  plan: 'FREE' | 'PRO';
  totpEnabled: boolean;
  feeBps: number;
  createdAt: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, totp?: string) => Promise<void>;
  signup: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshMe() {
    const { user } = await api<{ user: User }>('/api/auth/me');
    setUser(user);
  }

  useEffect(() => {
    (async () => {
      try {
        if (getRefreshToken()) {
          const res = await api<{ accessToken: string; refreshToken: string }>('/api/auth/refresh', {
            method: 'POST',
            auth: false,
            body: { refreshToken: getRefreshToken() },
          });
          setTokens(res.accessToken, res.refreshToken);
          await refreshMe();
        }
      } catch {
        clearTokens();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const value: AuthState = {
    user,
    loading,
    async login(email, password, totp) {
      const res = await api<{ user: User; accessToken: string; refreshToken: string }>('/api/auth/login', {
        method: 'POST',
        auth: false,
        body: { email, password, ...(totp ? { totp } : {}) },
      });
      setTokens(res.accessToken, res.refreshToken);
      setUser(res.user);
    },
    async signup(email, password, name) {
      const res = await api<{ user: User; accessToken: string; refreshToken: string }>('/api/auth/signup', {
        method: 'POST',
        auth: false,
        body: { email, password, name },
      });
      setTokens(res.accessToken, res.refreshToken);
      setUser(res.user);
    },
    async logout() {
      const rt = getRefreshToken();
      if (rt) {
        await api('/api/auth/logout', { method: 'POST', auth: false, body: { refreshToken: rt } }).catch(() => {});
      }
      clearTokens();
      setUser(null);
    },
    refreshMe,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
