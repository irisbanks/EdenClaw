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
      <main className="min-h-screen bg-black text-white">
        <div className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="mb-1 font-mono text-2xl font-bold uppercase tracking-tight text-white">정산 대시보드</h1>
          <p className="mb-4 text-sm text-zinc-500">이메일로 조회하거나 가입하면 전 페이지에 연동됩니다.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input value={inputEmail} onChange={(e) => setInputEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadUser(inputEmail)} type="email" placeholder="email"
              className="w-full rounded-none border border-zinc-800 bg-black px-3 py-2 font-mono text-sm text-white focus:border-sapphire focus:outline-none sm:w-64" />
            <input value={inputName} onChange={(e) => setInputName(e.target.value)} placeholder="이름(가입 시)"
              className="w-full rounded-none border border-zinc-800 bg-black px-3 py-2 font-mono text-sm text-white focus:border-sapphire focus:outline-none sm:w-36" />
            <button onClick={() => loadUser(inputEmail)} disabled={loading}
              className="rounded-none border border-sapphire bg-sapphire/10 px-4 py-2 font-mono text-sm font-semibold uppercase tracking-tight text-sapphire hover:bg-sapphire/20 disabled:opacity-50">조회</button>
            <button onClick={() => registerUser(inputEmail, inputName)} disabled={loading}
              className="rounded-none border border-zinc-700 bg-black px-4 py-2 font-mono text-sm font-semibold uppercase tracking-tight text-white hover:border-white disabled:opacity-50">가입</button>
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
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <header className="mb-6 flex items-center justify-between border-b border-zinc-800 pb-4">
          <div>
            <h1 className="font-mono text-2xl font-bold uppercase tracking-tight text-white">정산 대시보드</h1>
            <p className="font-mono text-sm text-zinc-500">{email} · Dual-Shield 실시간 장부</p>
          </div>
          <button onClick={() => { void refresh(); void loadTxns(email); }}
            className="rounded-none border border-zinc-800 bg-black px-3 py-1.5 font-mono text-xs uppercase tracking-tight text-zinc-300 hover:border-white hover:text-white">새로고침</button>
        </header>

        <div className="space-y-4">
          {/* 토큰 오버드래프트 카드 — /trading 가스 소진이 그대로 반영 */}
          <section className="rounded-none border border-zinc-800 bg-black p-4">
            <h2 className="mb-2 font-mono text-xs font-semibold uppercase tracking-tight text-zinc-500">토큰 오버드래프트</h2>
            <div className="mb-2 flex items-end justify-between">
              <div>
                <div className="font-mono text-xs uppercase tracking-tight text-zinc-500">잔여</div>
                <div className="font-mono text-2xl font-bold tracking-tight text-white tabular-nums">{quota.remaining.toLocaleString()}</div>
              </div>
              <div className="text-right font-mono text-xs tracking-tight text-zinc-500">
                <div>할당 {quota.allocated.toLocaleString()}</div>
                <div>소진 <span className="text-white tabular-nums">{quota.consumed.toLocaleString()}</span></div>
                <div>사용률 {quota.percentUsed.toFixed(2)}%</div>
              </div>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-none border border-zinc-800 bg-black">
              <div className="h-full bg-sapphire transition-all duration-500" style={{ width: `${Math.max(0, 100 - quota.percentUsed)}%` }} />
            </div>
            {quota.depleted && (
              <div className="mt-2 flex items-center justify-between rounded-none border border-red-900 bg-red-950/20 px-3 py-2 font-mono text-sm text-red-400">
                <span>가스 소진 — AI 개발 콘솔에서 Overdraft 충전</span>
                <Link href="/trading" className="rounded-none border border-red-500 px-3 py-1 text-xs font-semibold uppercase tracking-tight text-red-400 hover:bg-red-500/10">충전하러 →</Link>
              </div>
            )}
          </section>

          {/* 회원/지갑 + 바이너리 좌/우 볼륨 */}
          <section className="grid grid-cols-2 gap-px border border-zinc-800 bg-zinc-800 text-sm sm:grid-cols-4">
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
          <section className="rounded-none border border-zinc-800 bg-black p-4">
            <h2 className="mb-2 font-mono text-xs font-semibold uppercase tracking-tight text-zinc-500">최근 트랜잭션 ({txns.length})</h2>
            {txns.length === 0 ? (
              <p className="font-mono text-sm text-zinc-600">트랜잭션 없음 (Overdraft 충전 시 기록됩니다)</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left font-mono text-sm">
                  <thead className="text-xs uppercase tracking-tight text-zinc-500">
                    <tr>
                      <th className="border border-zinc-800 px-3 py-1.5">유형</th>
                      <th className="border border-zinc-800 px-3 py-1.5">금액</th>
                      <th className="border border-zinc-800 px-3 py-1.5">PV</th>
                      <th className="border border-zinc-800 px-3 py-1.5">일시</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txns.map((t) => (
                      <tr key={t.id}>
                        <td className="border border-zinc-800 px-3 py-1.5 text-zinc-300">{t.txType}</td>
                        <td className="border border-zinc-800 px-3 py-1.5 tabular-nums text-white">{t.currency === 'KRW' ? `₩${(t.krwAmount ?? 0).toLocaleString()}` : t.amount.toLocaleString()}</td>
                        <td className="border border-zinc-800 px-3 py-1.5 tabular-nums text-zinc-300">{t.pvGenerated.toLocaleString()}</td>
                        <td className="border border-zinc-800 px-3 py-1.5 text-zinc-500">{new Date(t.createdAt).toLocaleString()}</td>
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
    <div className="bg-black px-3 py-2">
      <div className="font-mono text-xs uppercase tracking-tight text-zinc-500">{label}</div>
      <div className="font-mono font-semibold tracking-tight text-white tabular-nums">{value}</div>
    </div>
  );
}
