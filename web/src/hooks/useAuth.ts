import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '../api/client';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ user: AuthUser }>('/api/auth/me');
      setUser(r.user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setUser(null);
      else setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<{ user: AuthUser }>('/api/auth/login', { email, password });
    setUser(r.user);
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/api/auth/logout'); } finally { setUser(null); }
  }, []);

  return { user, loading, login, logout, refresh };
}
