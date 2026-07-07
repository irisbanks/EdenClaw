'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useUser } from '@/components/UserProvider';

type Txn = { id: string; txType: string; currency?: 'KRW' | 'EP'; amount: number; krwAmount?: number; pvGenerated: number; bvGenerated: number; createdAt: string };

export default function DashboardPage() {
  const { email, quota, loading, error, loadUser, registerUser, refresh } = useUser();
  const [inputEmail, setInputEmail] = useState('');
  const [inputName, setInputName] = useState('');
  const [txns, setTxns] = useState<Txn[]>([]);

  // 트랜잭션은 전역 장부(quota) 외 추가 데이터라 dashboard 전용 API에서 보강 조회
  const loadTxns = useCallback(async (em: string) => {
    try {
      const res = await fetch(`/api/dashboard?email=${encodeURIComponent(em)}`);
      const json = await res.json();
      if (res.ok) setTxns(json.transactions ?? []);
    } catch {}
  }, []);

  // 진입 시 / 유저 변경 시 전역 장부 최신화 + 트랜잭션 로드
  useEffect(() => {
    if (email) { void refresh(); void loadTxns(email); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  // 미로그인: 조회/가입 패널
  if (!email || !quota) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100">
        <div className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="mb-1 text-2xl font-bold text-white">정산 대시보드</h1>
          <p className="mb-4 text-sm text-slate-400">이메일로 조회하거나 가입하면 전 페이지에 연동됩니다.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input value={inputEmail} onChange={(e) => setInputEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadUser(inputEmail)} type="email" placeholder="email"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none sm:w-64" />
            <input value={inputName} onChange={(e) => setInputName(e.target.value)} placeholder="이름(가입 시)"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none sm:w-36" />
            <button onClick={() => loadUser(inputEmail)} disabled={loading}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">조회</button>
            <button onClick={() => registerUser(inputEmail, inputName)} disabled={loading}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">가입</button>
          </div>
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        </div>
      </main>
    );
  }

  const legs = quota.ledger?.legs ?? { leftPV: 0, rightPV: 0, leftBV: 0, rightBV: 0 };
  const lesser = Math.min(legs.leftPV, legs.rightPV);
  const greater = Math.max(legs.leftPV, legs.rightPV);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">정산 대시보드</h1>
            <p className="text-sm text-slate-400">{email} · Dual-Shield 실시간 장부</p>
          </div>
          <button onClick={() => { void refresh(); void loadTxns(email); }}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700">새로고침</button>
        </header>

        <div className="space-y-4">
          {/* 토큰 오버드래프트 카드 — /trading 가스 소진이 그대로 반영 */}
          <section className="rounded-xl border border-amber-700/40 bg-slate-900 p-4">
            <h2 className="mb-2 text-sm font-semibold text-amber-300">토큰 오버드래프트</h2>
            <div className="mb-2 flex items-end justify-between">
              <div>
                <div className="text-xs text-slate-500">잔여</div>
                <div className="text-2xl font-bold text-white tabular-nums">{quota.remaining.toLocaleString()}</div>
              </div>
              <div className="text-right text-xs text-slate-400">
                <div>할당 {quota.allocated.toLocaleString()}</div>
                <div>소진 <span className="text-amber-400 tabular-nums">{quota.consumed.toLocaleString()}</span></div>
                <div>사용률 {quota.percentUsed.toFixed(2)}%</div>
              </div>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
              <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${Math.max(0, 100 - quota.percentUsed)}%` }} />
            </div>
            {quota.depleted && (
              <div className="mt-2 flex items-center justify-between rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                <span>가스 소진 — AI 개발 콘솔에서 Overdraft 충전</span>
                <Link href="/trading" className="rounded bg-amber-600 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-amber-500">충전하러 →</Link>
              </div>
            )}
          </section>

          {/* 회원/지갑 + 바이너리 좌/우 볼륨 */}
          <section className="grid grid-cols-2 gap-2 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm sm:grid-cols-4">
            <Field label="EP 지갑(수당)" value={(quota.ledger?.epBalance ?? 0).toLocaleString()} />
            <Field label="좌 PV" value={legs.leftPV.toLocaleString()} />
            <Field label="우 PV" value={legs.rightPV.toLocaleString()} />
            <Field label="소실적(수당기준)" value={lesser.toLocaleString()} />
            <Field label="좌 BV" value={legs.leftBV.toLocaleString()} />
            <Field label="우 BV" value={legs.rightBV.toLocaleString()} />
            <Field label="대실적" value={greater.toLocaleString()} />
            <Field label="이월 예정 PV" value={(greater - lesser).toLocaleString()} />
          </section>

          {/* 최근 트랜잭션 */}
          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-300">최근 트랜잭션 ({txns.length})</h2>
            {txns.length === 0 ? (
              <p className="text-sm text-slate-500">트랜잭션 없음 (Overdraft 충전 시 기록됩니다)</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-slate-500"><tr><th className="py-1 pr-4">유형</th><th className="py-1 pr-4">금액</th><th className="py-1 pr-4">PV</th><th className="py-1">일시</th></tr></thead>
                  <tbody>
                    {txns.map((t) => (
                      <tr key={t.id} className="border-t border-slate-800">
                        <td className="py-1 pr-4">{t.txType}</td>
                        <td className="py-1 pr-4 tabular-nums">{t.currency === 'KRW' ? `₩${(t.krwAmount ?? 0).toLocaleString()}` : t.amount.toLocaleString()}</td>
                        <td className="py-1 pr-4 tabular-nums">{t.pvGenerated.toLocaleString()}</td>
                        <td className="py-1">{new Date(t.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-800/60 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-semibold text-white tabular-nums">{value}</div>
    </div>
  );
}
