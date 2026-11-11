import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, clearAuth, getStoredUser, getToken, setAuth } from '../api/client';
import type { User } from '../api/types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(getStoredUser);
  const [loading, setLoading] = useState(true);

  // 启动时用 /auth/me 校验本地 token 是否仍有效
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api<{ user: User }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => {
        clearAuth();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await api<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: { username, password },
      auth: false,
    });
    setAuth(r.token, r.user);
    setUser(r.user);
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    const r = await api<{ token: string; user: User }>('/auth/register', {
      method: 'POST',
      body: { username, password },
      auth: false,
    });
    setAuth(r.token, r.user);
    setUser(r.user);
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, register, logout }), [user, loading, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
