'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type Legs = { leftPV: number; rightPV: number; leftBV: number; rightBV: number };
export type Ledger = {
  legs: Legs;
  lesserLegPV?: number;
  epBalance: number;
  swappableGas: number;
  gasPerPV: number;
  gasPerEP: number;
};
export type Quota = {
  email: string;
  allocated: number;
  consumed: number;
  remaining: number;
  percentUsed: number;
  depleted: boolean;
  isOverdraftAdvanced?: boolean;
  ledger: Ledger | null;
};

type UserCtx = {
  email: string | null;
  quota: Quota | null;
  loading: boolean;
  error: string;
  loadUser: (email: string) => Promise<boolean>;
  registerUser: (email: string, name?: string) => Promise<boolean>;
  setQuota: (q: Quota) => void; // /trading 틱 등에서 전역 장부를 즉시 갱신
  refresh: () => Promise<void>;
  logout: () => void;
};

const Ctx = createContext<UserCtx | null>(null);
const STORAGE_KEY = 'edenclaw_email';

export function useUser(): UserCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useUser must be used within <UserProvider>');
  return c;
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [quota, setQuotaState] = useState<Quota | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const restored = useRef(false);

  const loadUser = useCallback(async (em: string): Promise<boolean> => {
    const target = em.trim();
    if (!target) return false;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/trading/quota?email=${encodeURIComponent(target)}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `조회 실패 (${res.status})`);
        return false;
      }
      setEmail(target);
      setQuotaState(json as Quota);
      try { localStorage.setItem(STORAGE_KEY, target); } catch {}
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '네트워크 오류');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const registerUser = useCallback(async (em: string, name?: string): Promise<boolean> => {
    const target = em.trim();
    if (!target) { setError('이메일을 입력하세요.'); return false; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: target, name: name?.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? `가입 실패 (${res.status})`); return false; }
    } catch (e) {
      setError(e instanceof Error ? e.message : '네트워크 오류');
      return false;
    } finally {
      setLoading(false);
    }
    return loadUser(target); // 가입 직후 전역 장부 로드
  }, [loadUser]);

  const setQuota = useCallback((q: Quota) => setQuotaState(q), []);
  const refresh = useCallback(async () => { if (email) await loadUser(email); }, [email, loadUser]);
  const logout = useCallback(() => {
    setEmail(null);
    setQuotaState(null);
    setError('');
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }, []);

  // 새로고침/직접진입 시 localStorage 의 이메일로 전역 상태 복원 → 페이지 간 유실 방지
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    let saved: string | null = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch {}
    if (saved) void loadUser(saved);
  }, [loadUser]);

  return (
    <Ctx.Provider value={{ email, quota, loading, error, loadUser, registerUser, setQuota, refresh, logout }}>
      {children}
    </Ctx.Provider>
  );
}
