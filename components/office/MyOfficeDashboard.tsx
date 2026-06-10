'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchJson } from '@/lib/fetch-json';

interface OfficeData {
  user: { id: string; epBalance: number; subscriptionStatus: string; position: string | null };
  quota: { allocated: number; consumed: number; remaining: number; percentUsed: number };
  legs: {
    leftPV: number; rightPV: number; leftBV: number; rightBV: number;
    lesserLegPV: number; greaterLegPV: number; carryForwardPV: number;
  };
  transactions: Array<{
    id: string; txType: string; amount: number; pvGenerated: number; bvGenerated: number; createdAt: string;
  }>;
}

const fmt = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const usd = (n: number) => '$' + n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TX_LABEL: Record<string, { ko: string; cls: string }> = {
  SUBSCRIPTION: { ko: '구독', cls: 'bg-indigo-500/15 text-indigo-300' },
  TOKEN_PACK: { ko: '토큰충전', cls: 'bg-sky-500/15 text-sky-300' },
  BONUS_MATCHING: { ko: '매칭수당', cls: 'bg-emerald-500/15 text-emerald-300' },
};

export default function MyOfficeDashboard({ userId, refreshMs = 4000 }: { userId: string; refreshMs?: number }) {
  const [data, setData] = useState<OfficeData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { ok, data } = await fetchJson<OfficeData & { error?: string }>(
        `/api/office/${encodeURIComponent(userId)}`,
        { cache: 'no-store' }
      );
      if (!ok || !data) { setErr(data?.error || '조회 실패'); return; }
      setData(data); setErr(null);
    } catch { setErr('네트워크 오류'); }
  }, [userId]);

  useEffect(() => {
    load();
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs]);

  if (err) return <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-300">⚠ {err} <span className="text-slate-400">({userId})</span></div>;
  if (!data) return <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-6 text-slate-400 animate-pulse">마이오피스 불러오는 중…</div>;

  const { user, quota, legs } = data;
  const remainPct = quota.allocated > 0 ? (quota.remaining / quota.allocated) * 100 : 0;
  const legTotal = Math.max(legs.leftPV + legs.rightPV, 1);
  const active = user.subscriptionStatus === 'ACTIVE';

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">🏢 마이오피스</h2>
          <p className="text-sm text-slate-400">{user.id}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-600/30 text-slate-400'}`}>
          {active ? '● ACTIVE' : '○ INACTIVE'}
        </span>
      </div>

      {/* 상단 3카드 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-slate-800/60 p-4">
          <div className="text-xs text-slate-400">수당 지갑 (EP)</div>
          <div className="mt-1 text-2xl font-bold text-emerald-300">{usd(user.epBalance)}</div>
          <div className="mt-1 text-[11px] text-slate-500">바이너리 매칭 누적</div>
        </div>
        <div className="rounded-xl border border-sky-500/20 bg-gradient-to-br from-sky-500/10 to-slate-800/60 p-4">
          <div className="text-xs text-slate-400">잔여 토큰</div>
          <div className="mt-1 text-2xl font-bold text-sky-300">{fmt(quota.remaining)}</div>
          <div className="mt-1 text-[11px] text-slate-500">/ {fmt(quota.allocated)} 할당</div>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 to-slate-800/60 p-4">
          <div className="text-xs text-slate-400">이월 예정 (대−소 실적)</div>
          <div className="mt-1 text-2xl font-bold text-amber-300">{fmt(legs.carryForwardPV)} PV</div>
          <div className="mt-1 text-[11px] text-slate-500">다음 정산으로 carry-forward</div>
        </div>
      </div>

      {/* 토큰 쿼터 progress */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
        <div className="mb-2 flex justify-between text-sm">
          <span className="text-slate-300">토큰 쿼터</span>
          <span className="text-slate-400">{fmt(quota.consumed)} 사용 · {remainPct.toFixed(1)}% 잔여</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-slate-700">
          <div
            className={`h-full rounded-full transition-all duration-500 ${remainPct < 10 ? 'bg-red-500' : remainPct < 30 ? 'bg-amber-400' : 'bg-emerald-400'}`}
            style={{ width: `${remainPct}%` }}
          />
        </div>
      </div>

      {/* 좌/우 바이너리 볼륨 */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
        <div className="mb-3 text-sm font-semibold text-slate-300">좌/우 바이너리 볼륨 (미매칭 원장)</div>
        <div className="grid grid-cols-2 gap-4">
          {([['LEFT', legs.leftPV, legs.leftBV, 'sky'], ['RIGHT', legs.rightPV, legs.rightBV, 'amber']] as const).map(
            ([label, pv, bv, color]) => {
              const isLesser = pv === legs.lesserLegPV && legs.leftPV !== legs.rightPV;
              return (
                <div key={label} className={`rounded-lg border p-3 ${color === 'sky' ? 'border-sky-500/30 bg-sky-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-bold ${color === 'sky' ? 'text-sky-300' : 'text-amber-300'}`}>{label} 다리</span>
                    {isLesser && <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">소실적·정산기준</span>}
                  </div>
                  <div className="mt-2 text-lg font-bold text-white">{fmt(pv)} <span className="text-xs font-normal text-slate-400">PV</span></div>
                  <div className="text-[11px] text-slate-500">BV {fmt(bv)}</div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-700">
                    <div className={`h-full ${color === 'sky' ? 'bg-sky-400' : 'bg-amber-400'}`} style={{ width: `${(pv / legTotal) * 100}%` }} />
                  </div>
                </div>
              );
            }
          )}
        </div>
        <div className="mt-3 flex justify-between text-xs text-slate-400">
          <span>소실적 매칭 기준: <b className="text-emerald-300">{fmt(legs.lesserLegPV)} PV</b></span>
          <span>대실적: <b className="text-slate-300">{fmt(legs.greaterLegPV)} PV</b></span>
        </div>
      </div>

      {/* 최근 트랜잭션 */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
        <div className="mb-3 text-sm font-semibold text-slate-300">최근 거래/수당 내역</div>
        {data.transactions.length === 0 ? (
          <p className="text-sm text-slate-500">내역이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {data.transactions.map((t) => {
              const meta = TX_LABEL[t.txType] ?? { ko: t.txType, cls: 'bg-slate-600/30 text-slate-300' };
              return (
                <li key={t.id} className="flex items-center justify-between rounded-lg bg-slate-900/40 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>{meta.ko}</span>
                    <span className="text-slate-400">PV {fmt(t.pvGenerated)} · BV {fmt(t.bvGenerated)}</span>
                  </div>
                  <span className={`font-semibold ${t.txType === 'BONUS_MATCHING' ? 'text-emerald-300' : 'text-slate-200'}`}>
                    {t.txType === 'BONUS_MATCHING' ? '+' : ''}{usd(t.amount)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
