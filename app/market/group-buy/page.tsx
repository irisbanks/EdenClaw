'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface GroupBuy {
  id: string; title: string; description: string;
  discountRate: number; basePrice: number; discountedPrice: number;
  targetCount: number; currentCount: number; deadline: string; status: string;
  progressRate: number; remainingHours: number; matchScore?: number; matchReason?: string;
  product: { title: string; images: string; sellerName: string; verifyScore: number };
  _count?: { participants: number };
}

interface AutoStats {
  total: number;
  highProgress: number;
  expiringSoon: number;
}

const STATUS_TABS = [
  { value: 'open', label: '진행 중' },
  { value: 'success', label: '달성 완료' },
  { value: 'failed', label: '마감' },
  { value: 'all', label: '전체' },
];

const s = {
  page: { minHeight: '100vh', background: '#0a0a0a', color: '#e8e8e8', fontFamily: 'Arial, sans-serif' },
  nav: { background: '#111', borderBottom: '1px solid #222', padding: '0 24px', display: 'flex', alignItems: 'center', gap: '24px', height: '56px' },
  navBrand: { fontSize: '18px', fontWeight: 700, color: '#fff', textDecoration: 'none' } as React.CSSProperties,
  navLink: { color: '#aaa', fontSize: '14px', textDecoration: 'none' } as React.CSSProperties,
  navLinkActive: { color: '#fff', fontSize: '14px', textDecoration: 'none', fontWeight: 600 } as React.CSSProperties,
  navSell: { marginLeft: 'auto', background: '#4f46e5', color: '#fff', padding: '8px 16px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, textDecoration: 'none' } as React.CSSProperties,
  container: { maxWidth: '1100px', margin: '0 auto', padding: '32px 24px' },
  // 자동매칭 패널
  autoPanel: { background: 'linear-gradient(135deg, #0d1a3f 0%, #0a1428 100%)', border: '1px solid #1e3a6f', borderRadius: '14px', padding: '20px', marginBottom: '28px' },
  autoPanelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  autoPanelTitle: { fontSize: '16px', fontWeight: 700, color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '8px' },
  autoStatRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' },
  autoStat: { background: '#0a1020', borderRadius: '10px', padding: '12px', textAlign: 'center' as const },
  autoStatNum: { fontSize: '24px', fontWeight: 800, color: '#4f46e5' },
  autoStatLabel: { fontSize: '11px', color: '#4f70a8', marginTop: '2px' },
  interestInput: { width: '100%', padding: '10px 14px', background: '#0a1020', border: '1px solid #1e3a6f', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box' as const, marginBottom: '12px' },
  autoBtn: { padding: '8px 18px', background: '#4f46e5', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer' },
  autoBtnSecondary: { padding: '8px 18px', background: 'transparent', border: '1px solid #2a4a8f', borderRadius: '8px', color: '#60a5fa', fontSize: '13px', fontWeight: 600, cursor: 'pointer' },
  autoResult: { background: '#0a1020', borderRadius: '10px', padding: '14px', marginTop: '12px', fontSize: '13px', color: '#4ade80', lineHeight: 1.6 },
  tabs: { display: 'flex', gap: '4px', marginBottom: '28px', background: '#111', borderRadius: '10px', padding: '4px', width: 'fit-content' },
  tab: (active: boolean) => ({
    padding: '8px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: active ? 600 : 400, cursor: 'pointer', border: 'none',
    background: active ? '#4f46e5' : 'transparent', color: active ? '#fff' : '#888',
  }),
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' },
  card: { background: '#111', border: '1px solid #222', borderRadius: '14px', padding: '20px', textDecoration: 'none', display: 'block', cursor: 'pointer', animation: 'fadeIn 0.3s ease' } as React.CSSProperties,
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' },
  discountBadge: { background: '#4f46e5', color: '#fff', padding: '4px 10px', borderRadius: '20px', fontSize: '13px', fontWeight: 700 },
  productName: { fontSize: '12px', color: '#666', marginBottom: '4px' },
  gbTitle: { fontSize: '15px', fontWeight: 600, color: '#fff', marginBottom: '12px', lineHeight: 1.4 },
  priceRow: { display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '12px' },
  newPrice: { fontSize: '22px', fontWeight: 800, color: '#60a5fa' },
  oldPrice: { fontSize: '14px', color: '#555', textDecoration: 'line-through' },
  progressBar: { height: '8px', background: '#1a1a1a', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' },
  progressFill: (pct: number, success: boolean) => ({
    height: '100%', borderRadius: '4px', transition: 'width 0.5s',
    width: `${Math.min(pct, 100)}%`,
    background: success ? '#22c55e' : pct >= 75 ? '#f59e0b' : '#4f46e5',
  }),
  metaRow: { display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#666' },
  matchBadge: { marginTop: '10px', padding: '5px 10px', borderRadius: '6px', background: '#0d1a3f', border: '1px solid #1e3a6f', fontSize: '11px', color: '#a8c0e8' },
  statusBadge: (status: string) => {
    const m: Record<string, [string, string]> = {
      open: ['#14532d', '#4ade80'], success: ['#1e3a5f', '#60a5fa'],
      failed: ['#1c0000', '#f87171'], cancelled: ['#222', '#888'],
    };
    const [bg, color] = m[status] || m.cancelled;
    return { display: 'inline-block', padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: bg, color };
  },
};

export default function GroupBuyPage() {
  const [gbs, setGbs] = useState<GroupBuy[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [status, setStatus] = useState('open');
  const [loading, setLoading] = useState(true);

  // 자동매칭
  const [autoMatches, setAutoMatches] = useState<GroupBuy[]>([]);
  const [autoStats, setAutoStats] = useState<AutoStats | null>(null);
  const [interest, setInterest] = useState('');
  const [autoLoading, setAutoLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createResult, setCreateResult] = useState('');

  const fetchGbs = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ status, page: String(page), limit: '12' });
    fetch(`/api/market/group-buy?${params}`)
      .then(r => r.json())
      .then(d => {
        setGbs(d.groupBuys || []);
        setTotal(d.total || 0);
        setPages(d.pages || 1);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [status, page]);

  async function fetchAutoMatches(interestVal?: string) {
    setAutoLoading(true);
    try {
      const q = interestVal !== undefined ? interestVal : interest;
      const url = q ? `/api/market/group-buy/schedule?interest=${encodeURIComponent(q)}&limit=6` : '/api/market/group-buy/schedule?limit=6';
      const res = await fetch(url);
      const d = await res.json();
      setAutoMatches(d.matches || []);
      setAutoStats(d.stats || null);
    } catch {}
    setAutoLoading(false);
  }

  async function runAutoCreate() {
    setCreateLoading(true);
    setCreateResult('');
    try {
      const res = await fetch('/api/market/group-buy/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minViewCount: 3, maxCreate: 5 }),
      });
      const d = await res.json();
      setCreateResult(d.message || '완료');
      fetchGbs();
      fetchAutoMatches();
    } catch {
      setCreateResult('오류가 발생했습니다');
    }
    setCreateLoading(false);
  }

  useEffect(() => { fetchGbs(); }, [fetchGbs]);
  useEffect(() => { setPage(1); }, [status]);
  useEffect(() => { fetchAutoMatches(); }, []);

  return (
    <div style={s.page}>
      <style>{`@keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`}</style>
      <nav style={s.nav}>
        <Link href="/market" style={s.navBrand}>🏪 AI Market</Link>
        <Link href="/market" style={s.navLink}>홈</Link>
        <Link href="/market/products" style={s.navLink}>상품</Link>
        <Link href="/market/group-buy" style={s.navLinkActive}>공동구매</Link>
        <Link href="/market/sell" style={s.navSell}>+ 판매하기</Link>
      </nav>

      <div style={s.container}>
        {/* 자동매칭 패널 */}
        <div style={s.autoPanel}>
          <div style={s.autoPanelHeader}>
            <div style={s.autoPanelTitle}>
              <span>⚡</span>
              <span>AI 공동구매 자동매칭</span>
              {autoLoading && <span style={{ fontSize: '12px', color: '#4f70a8' }}>분석 중...</span>}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button style={s.autoBtnSecondary} onClick={() => fetchAutoMatches()}>🔄 새로고침</button>
              <button style={s.autoBtn} onClick={runAutoCreate} disabled={createLoading}>
                {createLoading ? '생성 중...' : '🤖 자동 생성'}
              </button>
            </div>
          </div>

          {autoStats && (
            <div style={s.autoStatRow}>
              <div style={s.autoStat}>
                <div style={s.autoStatNum}>{autoStats.total}</div>
                <div style={s.autoStatLabel}>진행 중</div>
              </div>
              <div style={s.autoStat}>
                <div style={{ ...s.autoStatNum, color: '#f59e0b' }}>{autoStats.highProgress}</div>
                <div style={s.autoStatLabel}>70%+ 달성</div>
              </div>
              <div style={s.autoStat}>
                <div style={{ ...s.autoStatNum, color: '#f87171' }}>{autoStats.expiringSoon}</div>
                <div style={s.autoStatLabel}>24시간 내 마감</div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', marginBottom: '8px' }}>
            <input
              style={s.interestInput}
              placeholder="관심 카테고리 입력 (예: electronics, 무선이어폰) - 비워두면 AI 추천"
              value={interest}
              onChange={e => setInterest(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchAutoMatches()}
            />
            <button style={s.autoBtn} onClick={() => fetchAutoMatches()}>매칭</button>
          </div>

          {createResult && (
            <div style={s.autoResult}>✅ {createResult}</div>
          )}

          {autoMatches.length > 0 && (
            <>
              <div style={{ fontSize: '13px', color: '#4f70a8', marginBottom: '12px', marginTop: '4px' }}>
                AI 추천 공동구매 {autoMatches.length}개
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
                {autoMatches.map(gb => {
                  const pct = Math.min(gb.progressRate, 100);
                  return (
                    <Link key={gb.id} href={`/market/group-buy/${gb.id}`} style={{ textDecoration: 'none' }}>
                      <div style={{ background: '#0a1020', border: '1px solid #1e3a6f', borderRadius: '10px', padding: '14px', cursor: 'pointer' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <span style={{ color: '#4f46e5', fontWeight: 700, fontSize: '14px' }}>-{gb.discountRate}%</span>
                          <span style={{ color: '#22c55e', fontSize: '11px' }}>{pct}% 달성</span>
                        </div>
                        <div style={{ color: '#fff', fontSize: '13px', fontWeight: 600, marginBottom: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{gb.title}</div>
                        <div style={{ height: '5px', background: '#1a2030', borderRadius: '3px', overflow: 'hidden', marginBottom: '6px' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: pct >= 75 ? '#f59e0b' : '#4f46e5', borderRadius: '3px' }} />
                        </div>
                        <div style={{ fontSize: '11px', color: '#4f70a8' }}>{gb.currentCount}/{gb.targetCount}명 · {gb.remainingHours}시간 남음</div>
                        {gb.matchReason && <div style={{ fontSize: '10px', color: '#6080a8', marginTop: '5px' }}>✨ {gb.matchReason}</div>}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* 전체 목록 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#fff' }}>
            전체 공동구매 <span style={{ fontSize: '14px', color: '#666', fontWeight: 400 }}>({total}개)</span>
          </h2>
        </div>

        <div style={s.tabs}>
          {STATUS_TABS.map(t => (
            <button key={t.value} style={s.tab(status === t.value)} onClick={() => setStatus(t.value)}>
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p style={{ color: '#666', textAlign: 'center', padding: '60px' }}>로딩 중...</p>
        ) : gbs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 24px', color: '#555' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚡</div>
            <p style={{ fontSize: '16px', marginBottom: '8px' }}>진행 중인 공동구매가 없습니다</p>
            <button onClick={runAutoCreate} style={{ ...s.autoBtn, padding: '10px 20px', fontSize: '14px', marginTop: '8px' }}>
              🤖 AI로 자동 생성
            </button>
          </div>
        ) : (
          <>
            <div style={s.grid}>
              {gbs.map(gb => (
                <Link key={gb.id} href={`/market/group-buy/${gb.id}`} style={s.card}>
                  <div style={s.cardHeader}>
                    <div style={s.discountBadge}>-{gb.discountRate}%</div>
                    <span style={s.statusBadge(gb.status)}>
                      {gb.status === 'open' ? '진행중' : gb.status === 'success' ? '달성' : '마감'}
                    </span>
                  </div>

                  <div style={s.productName}>{gb.product?.title}</div>
                  <div style={s.gbTitle}>{gb.title}</div>

                  <div style={s.priceRow}>
                    <span style={s.newPrice}>{gb.discountedPrice.toLocaleString()}원</span>
                    <span style={s.oldPrice}>{gb.basePrice.toLocaleString()}원</span>
                  </div>

                  <div style={s.progressBar}>
                    <div style={s.progressFill(gb.progressRate, gb.status === 'success')} />
                  </div>

                  <div style={s.metaRow}>
                    <span>{gb.currentCount}/{gb.targetCount}명 ({gb.progressRate}%)</span>
                    {gb.status === 'open' ? (
                      <span>{gb.remainingHours}시간 남음</span>
                    ) : gb.status === 'success' ? (
                      <span style={{ color: '#4ade80' }}>🎉 목표 달성!</span>
                    ) : (
                      <span>마감</span>
                    )}
                  </div>

                  {gb.product?.sellerName && (
                    <div style={{ fontSize: '11px', color: '#555', marginTop: '8px' }}>
                      판매자: {gb.product.sellerName}
                    </div>
                  )}
                </Link>
              ))}
            </div>

            {pages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '40px', flexWrap: 'wrap' }}>
                {Array.from({ length: pages }, (_, i) => i + 1).map(p => (
                  <button key={p} onClick={() => setPage(p)}
                    style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px', background: page === p ? '#4f46e5' : '#1a1a1a', color: page === p ? '#fff' : '#888' }}>
                    {p}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
