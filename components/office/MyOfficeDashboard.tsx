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
    id: string; txType: string; currency?: 'KRW' | 'EP'; amount: number; krwAmount?: number;
    pvGenerated: number; bvGenerated: number; createdAt: string;
  }>;
}

const fmt = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const usd = (n: number) => '$' + n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const krw = (n: number) => '₩' + n.toLocaleString('ko-KR', { maximumFractionDigits: 0 });

const TX_LABEL: Record<string, { ko: string; cls: string }> = {
  SUBSCRIPTION: { ko: '구독', cls: 'border border-zinc-700 text-zinc-300' },
  TOKEN_PACK: { ko: '토큰충전', cls: 'border border-sapphire text-sapphire' },
  BONUS_MATCHING: { ko: '매칭수당', cls: 'border border-white text-white' },
};

export default function MyOfficeDashboard({ userId, refreshMs = 4000 }: { userId: string; refreshMs?: number }) {
  const [data, setData] = useState<OfficeData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { ok, data } = await fetchJson<OfficeData & { error?: string }>(
        `/api/office/${encodeURIComponent(userId)}`,
        { cache: 'no-store' }
      );
      if (!ok) { setErr(data?.error || '조회 실패'); return; }
      // ok 응답이어도 핵심 필드(user/quota/legs)가 비면 그대로 렌더하면 크래시 → 빈 데이터로 안전 처리.
      if (!data || !data.user || !data.quota || !data.legs) { setData(null); setErr(null); return; }
      setData(data); setErr(null);
    } catch {
      setErr('네트워크 오류');
    } finally {
      // 성공/실패와 무관하게 로딩 패널을 반드시 걷어내 무한 대기를 차단한다.
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setErr(null);
    load();
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs]);

  if (err) return <div className="border border-red-900 bg-red-950/20 p-6 font-mono text-sm text-red-400">{err} <span className="text-zinc-500">({userId})</span></div>;
  if (loading && !data) return <div className="border border-zinc-800 bg-black p-6 font-mono text-sm text-zinc-500 animate-pulse">마이오피스 불러오는 중…</div>;
  if (!data) return <div className="border border-zinc-800 bg-black p-6 font-mono text-sm text-zinc-500">조회된 계보 데이터가 없습니다. <span className="text-zinc-600">({userId})</span></div>;

  const { user, quota, legs } = data;
  const transactions = data.transactions ?? [];
  const remainPct = quota.allocated > 0 ? (quota.remaining / quota.allocated) * 100 : 0;
  const legTotal = Math.max(legs.leftPV + legs.rightPV, 1);
  const active = user.subscriptionStatus === 'ACTIVE';

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div>
          <h2 className="font-mono text-xl font-bold uppercase tracking-tight text-white">마이오피스</h2>
          <p className="font-mono text-sm text-zinc-500">{user.id}</p>
        </div>
        <span className={`border px-3 py-1 font-mono text-xs font-semibold uppercase tracking-tight ${active ? 'border-sapphire text-sapphire' : 'border-zinc-700 text-zinc-500'}`}>
          {active ? 'ACTIVE' : 'INACTIVE'}
        </span>
      </div>

      {/* 상단 3카드 */}
      <div className="grid grid-cols-1 gap-px border border-zinc-800 bg-zinc-800 sm:grid-cols-3">
        <div className="bg-black p-4">
          <div className="font-mono text-xs uppercase tracking-tight text-zinc-500">수당 지갑 (EP)</div>
          <div className="mt-1 font-mono text-2xl font-bold tracking-tight text-white">{usd(user.epBalance)}</div>
          <div className="mt-1 font-mono text-[11px] tracking-tight text-zinc-600">바이너리 매칭 누적</div>
        </div>
        <div className="bg-black p-4">
          <div className="font-mono text-xs uppercase tracking-tight text-zinc-500">잔여 토큰</div>
          <div className="mt-1 font-mono text-2xl font-bold tracking-tight text-white">{fmt(quota.remaining)}</div>
          <div className="mt-1 font-mono text-[11px] tracking-tight text-zinc-600">/ {fmt(quota.allocated)} 할당</div>
        </div>
        <div className="bg-black p-4">
          <div className="font-mono text-xs uppercase tracking-tight text-zinc-500">이월 예정 (대−소 실적)</div>
          <div className="mt-1 font-mono text-2xl font-bold tracking-tight text-white">{fmt(legs.carryForwardPV)} PV</div>
          <div className="mt-1 font-mono text-[11px] tracking-tight text-zinc-600">다음 정산으로 carry-forward</div>
        </div>
      </div>

      {/* 토큰 쿼터 progress */}
      <div className="border border-zinc-800 bg-black p-4">
        <div className="mb-2 flex justify-between font-mono text-sm tracking-tight">
          <span className="text-zinc-300">토큰 쿼터</span>
          <span className="text-zinc-500">{fmt(quota.consumed)} 사용 · {remainPct.toFixed(1)}% 잔여</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden border border-zinc-800 bg-black">
          <div
            className={`h-full transition-all duration-500 ${remainPct < 10 ? 'bg-red-500' : 'bg-sapphire'}`}
            style={{ width: `${remainPct}%` }}
          />
        </div>
      </div>

      {/* 좌/우 바이너리 볼륨 */}
      <div className="border border-zinc-800 bg-black p-4">
        <div className="mb-3 font-mono text-sm font-semibold uppercase tracking-tight text-zinc-300">좌/우 바이너리 볼륨 (미매칭 원장)</div>
        <div className="grid grid-cols-2 gap-px border border-zinc-800 bg-zinc-800">
          {([['LEFT', legs.leftPV, legs.leftBV], ['RIGHT', legs.rightPV, legs.rightBV]] as const).map(
            ([label, pv, bv]) => {
              const isLesser = pv === legs.lesserLegPV && legs.leftPV !== legs.rightPV;
              return (
                <div key={label} className="bg-black p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold uppercase tracking-tight text-white">{label} 다리</span>
                    {isLesser && <span className="border border-sapphire px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-tight text-sapphire">소실적·정산기준</span>}
                  </div>
                  <div className="mt-2 font-mono text-lg font-bold tracking-tight text-white">{fmt(pv)} <span className="text-xs font-normal text-zinc-500">PV</span></div>
                  <div className="font-mono text-[11px] tracking-tight text-zinc-600">BV {fmt(bv)}</div>
                  <div className="mt-2 h-1 w-full overflow-hidden border border-zinc-800 bg-black">
                    <div className="h-full bg-sapphire" style={{ width: `${(pv / legTotal) * 100}%` }} />
                  </div>
                </div>
              );
            }
          )}
        </div>
        <div className="mt-3 flex justify-between font-mono text-xs tracking-tight text-zinc-500">
          <span>소실적 매칭 기준: <b className="text-white">{fmt(legs.lesserLegPV)} PV</b></span>
          <span>대실적: <b className="text-zinc-300">{fmt(legs.greaterLegPV)} PV</b></span>
        </div>
      </div>

      {/* 최근 트랜잭션 */}
      <div className="border border-zinc-800 bg-black p-4">
        <div className="mb-3 font-mono text-sm font-semibold uppercase tracking-tight text-zinc-300">최근 거래/수당 내역</div>
        {transactions.length === 0 ? (
          <p className="font-mono text-sm text-zinc-600">내역이 없습니다.</p>
        ) : (
          <div className="border border-zinc-800">
            {transactions.map((t, i) => {
              const meta = TX_LABEL[t.txType] ?? { ko: t.txType, cls: 'border border-zinc-700 text-zinc-300' };
              return (
                <div key={t.id} className={`flex items-center justify-between px-3 py-2 font-mono text-sm ${i > 0 ? 'border-t border-zinc-800' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 text-[11px] font-semibold uppercase tracking-tight ${meta.cls}`}>{meta.ko}</span>
                    <span className="tracking-tight text-zinc-500">PV {fmt(t.pvGenerated)} · BV {fmt(t.bvGenerated)}</span>
                  </div>
                  <span className="font-semibold tracking-tight text-white tabular-nums">
                    {/* 원화 결제는 KRW 매출로, 그 외(수당 등)는 EP/USD 로 통화 분리 표기 */}
                    {t.currency === 'KRW' ? krw(t.krwAmount ?? 0) : `${t.txType === 'BONUS_MATCHING' ? '+' : ''}${usd(t.amount)}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
