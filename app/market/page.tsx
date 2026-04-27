'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Stats {
  products: { total: number; active: number; verified: number };
  orders: { total: number; revenue: number };
  groupBuys: { total: number; open: number; success: number };
  topProducts: Array<{ id: string; title: string; price: number; currency: string; buyCount: number; verifyScore: number }>;
  recentOrders: Array<{ id: string; buyerName: string; totalPrice: number; currency: string; createdAt: string; product: { title: string } }>;
}

interface Recommendation {
  rank: number;
  product: { id: string; title: string; price: number; currency: string; category: string; images: string[]; verifyScore: number; avgRating: number; reviewCount: number };
  matchScore: number;
  reason: string;
}

interface VoiceShopResult {
  inputText: string;
  intent: { product: string; quantity: number; condition: string };
  result: {
    product: { id: string; title: string; price: number; currency: string; verifyScore: number };
    quantity: number; totalPrice: number; reason: string;
  } | null;
  message: string;
}

const s = {
  page: { minHeight: '100vh', background: '#0a0a0a', color: '#e8e8e8', fontFamily: 'Arial, sans-serif' },
  nav: { background: '#111', borderBottom: '1px solid #222', padding: '0 24px', display: 'flex', alignItems: 'center', gap: '24px', height: '56px' },
  navBrand: { fontSize: '18px', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' },
  navLink: { color: '#aaa', fontSize: '14px', textDecoration: 'none' } as React.CSSProperties,
  navLinkActive: { color: '#fff', fontSize: '14px', textDecoration: 'none', fontWeight: 600 } as React.CSSProperties,
  navSell: { marginLeft: 'auto', background: '#4f46e5', color: '#fff', padding: '8px 16px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, textDecoration: 'none' } as React.CSSProperties,
  hero: { background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)', padding: '64px 24px', textAlign: 'center' as const },
  heroTitle: { fontSize: '42px', fontWeight: 800, color: '#fff', marginBottom: '12px' },
  heroSub: { fontSize: '18px', color: '#94a3b8', marginBottom: '32px' },
  heroButtons: { display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' as const, marginBottom: '32px' },
  btnPrimary: { background: '#4f46e5', color: '#fff', padding: '12px 28px', borderRadius: '10px', fontWeight: 600, fontSize: '15px', textDecoration: 'none' } as React.CSSProperties,
  btnSecondary: { background: 'transparent', color: '#fff', padding: '12px 28px', borderRadius: '10px', fontWeight: 600, fontSize: '15px', border: '1px solid #4f46e5', textDecoration: 'none' } as React.CSSProperties,
  container: { maxWidth: '1200px', margin: '0 auto', padding: '48px 24px' },
  sectionTitle: { fontSize: '22px', fontWeight: 700, color: '#fff', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '48px' },
  statCard: { background: '#111', border: '1px solid #222', borderRadius: '12px', padding: '24px', textAlign: 'center' as const },
  statNum: { fontSize: '32px', fontWeight: 800, color: '#4f46e5' },
  statLabel: { fontSize: '13px', color: '#888', marginTop: '4px' },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px', marginBottom: '48px' },
  productCard: { background: '#111', border: '1px solid #222', borderRadius: '12px', padding: '20px', cursor: 'pointer', transition: 'border-color 0.2s' },
  productTitle: { fontSize: '15px', fontWeight: 600, color: '#fff', marginBottom: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  productPrice: { fontSize: '20px', fontWeight: 700, color: '#4f46e5' },
  productMeta: { fontSize: '12px', color: '#666', marginTop: '8px', display: 'flex', gap: '12px', flexWrap: 'wrap' as const },
  badge: { display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 600 },
  seeMore: { textAlign: 'center' as const, marginTop: '8px' },
  seeMoreLink: { color: '#4f46e5', fontSize: '14px', textDecoration: 'none', fontWeight: 600 },
  voiceBox: { background: '#111', border: '1px solid #4f46e530', borderRadius: '16px', padding: '24px', marginBottom: '48px' },
  voiceInput: { flex: 1, padding: '12px 16px', background: '#0a0a0a', border: '1px solid #333', borderRadius: '10px', color: '#fff', fontSize: '14px', outline: 'none' } as React.CSSProperties,
  voiceBtn: { padding: '12px 20px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: 600 },
  micBtn: { padding: '12px 16px', background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: '10px', cursor: 'pointer', fontSize: '18px' },
  voiceResult: { marginTop: '16px', background: '#0a0a0a', border: '1px solid #222', borderRadius: '10px', padding: '16px' },
  recCard: { background: '#111', border: '1px solid #222', borderRadius: '12px', padding: '16px', cursor: 'pointer', position: 'relative' as const },
  recRank: { position: 'absolute' as const, top: '12px', right: '12px', background: '#4f46e5', color: '#fff', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700 },
  recScore: { fontSize: '11px', color: '#818cf8', fontWeight: 600 },
  recReason: { fontSize: '12px', color: '#666', marginTop: '6px', lineHeight: 1.5 },
};

function verifyBadge(score: number) {
  if (score >= 90) return <span style={{ ...s.badge, background: '#1e3a5f', color: '#60a5fa' }}>🥇 프리미엄</span>;
  if (score >= 70) return <span style={{ ...s.badge, background: '#14532d', color: '#4ade80' }}>✅ 표준</span>;
  if (score >= 50) return <span style={{ ...s.badge, background: '#422006', color: '#fb923c' }}>⚠️ 주의</span>;
  return null;
}

export default function MarketHome() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [voiceText, setVoiceText] = useState('');
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceResult, setVoiceResult] = useState<VoiceShopResult | null>(null);
  const [userId] = useState('user_demo');

  useEffect(() => {
    fetch('/api/market/stats')
      .then(r => r.json())
      .then(d => { setStats(d); setLoading(false); })
      .catch(() => setLoading(false));

    // 개인화 추천 로드
    fetch(`/api/market/recommend?userId=${userId}&limit=6`)
      .then(r => r.json())
      .then(d => setRecommendations(d.recommendations || []))
      .catch(() => {});
  }, [userId]);

  async function handleVoiceShop() {
    if (!voiceText.trim() || voiceLoading) return;
    setVoiceLoading(true);
    setVoiceResult(null);
    try {
      const res = await fetch('/api/market/voice-shop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: voiceText }),
      });
      const data = await res.json();
      setVoiceResult(data);
    } catch {
      setVoiceResult({ inputText: voiceText, intent: { product: voiceText, quantity: 1, condition: '' }, result: null, message: '오류가 발생했습니다.' });
    }
    setVoiceLoading(false);
  }

  return (
    <div style={s.page}>
      <nav style={s.nav}>
        <span style={s.navBrand}>🏪 AI Market</span>
        <Link href="/market" style={s.navLinkActive}>홈</Link>
        <Link href="/market/products" style={s.navLink}>상품</Link>
        <Link href="/market/group-buy" style={s.navLink}>공동구매</Link>
        <Link href="/market/sell" style={s.navSell}>+ 판매하기</Link>
      </nav>

      <div style={s.hero}>
        <h1 style={s.heroTitle}>🤖 AI 마켓 v2</h1>
        <p style={s.heroSub}>AI가 검증하고, 협상하고, 추천하는 스마트 쇼핑 플랫폼</p>
        <div style={s.heroButtons}>
          <Link href="/market/products" style={s.btnPrimary}>상품 둘러보기</Link>
          <Link href="/market/group-buy" style={s.btnSecondary}>공동구매 참여</Link>
        </div>

        {/* 음성/자연어 쇼핑 */}
        <div style={{ maxWidth: '640px', margin: '0 auto' }}>
          <div style={{ fontSize: '14px', color: '#94a3b8', marginBottom: '12px' }}>
            🛒 자연어로 쇼핑하기 — &quot;감자 5kg 가장 싸게 사줘&quot;
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              style={s.voiceInput}
              value={voiceText}
              onChange={e => setVoiceText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleVoiceShop()}
              placeholder="원하는 상품을 자연어로 입력하세요..."
            />
            <button style={s.micBtn} title="음성 입력 (준비 중)">🎤</button>
            <button style={s.voiceBtn} onClick={handleVoiceShop} disabled={voiceLoading}>
              {voiceLoading ? '⏳' : '검색'}
            </button>
          </div>
          {voiceResult && (
            <div style={{ marginTop: '12px', background: '#0a0a1a', border: '1px solid #4f46e580', borderRadius: '12px', padding: '16px', textAlign: 'left' }}>
              {voiceResult.result ? (
                <>
                  <div style={{ fontSize: '12px', color: '#818cf8', marginBottom: '8px' }}>
                    파싱: {voiceResult.intent.product} × {voiceResult.intent.quantity}개 ({voiceResult.intent.condition})
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>
                    {voiceResult.result.product.title}
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#4f46e5', marginBottom: '8px' }}>
                    {voiceResult.result.totalPrice.toLocaleString()} {voiceResult.result.product.currency}
                  </div>
                  <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '12px' }}>{voiceResult.result.reason}</div>
                  <Link href={`/market/products/${voiceResult.result.product.id}`} style={{ ...s.voiceBtn, display: 'inline-block', textDecoration: 'none', padding: '8px 16px' }}>
                    상품 보기 →
                  </Link>
                </>
              ) : (
                <div style={{ color: '#f87171', fontSize: '14px' }}>{voiceResult.message}</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={s.container}>
        {loading ? (
          <p style={{ color: '#666', textAlign: 'center' }}>데이터 로딩 중...</p>
        ) : stats ? (
          <>
            <div style={s.statsGrid}>
              <div style={s.statCard}>
                <div style={s.statNum}>{stats.products.total.toLocaleString()}</div>
                <div style={s.statLabel}>전체 상품</div>
              </div>
              <div style={s.statCard}>
                <div style={s.statNum}>{stats.products.verified.toLocaleString()}</div>
                <div style={s.statLabel}>AI 검증 완료</div>
              </div>
              <div style={s.statCard}>
                <div style={s.statNum}>{stats.groupBuys.open.toLocaleString()}</div>
                <div style={s.statLabel}>진행 중 공동구매</div>
              </div>
              <div style={s.statCard}>
                <div style={s.statNum}>{stats.orders.total.toLocaleString()}</div>
                <div style={s.statLabel}>총 주문</div>
              </div>
              <div style={s.statCard}>
                <div style={{ ...s.statNum, color: '#22c55e' }}>
                  {stats.orders.revenue.toLocaleString()}
                </div>
                <div style={s.statLabel}>총 거래액</div>
              </div>
            </div>

            {/* 개인화 추천 */}
            {recommendations.length > 0 && (
              <>
                <h2 style={s.sectionTitle}>✨ 당신을 위한 추천</h2>
                <div style={s.grid3}>
                  {recommendations.map(rec => (
                    <Link key={rec.product.id} href={`/market/products/${rec.product.id}`} style={{ textDecoration: 'none' }}>
                      <div style={s.recCard}>
                        <div style={s.recRank}>#{rec.rank}</div>
                        <div style={{ ...s.productTitle, paddingRight: '32px' }}>{rec.product.title}</div>
                        <div style={s.productPrice}>{rec.product.price.toLocaleString()} {rec.product.currency}</div>
                        <div style={s.recScore}>매칭 {rec.matchScore}점</div>
                        <div style={s.recReason}>{rec.reason}</div>
                        <div style={s.productMeta}>
                          <span>⭐ {rec.product.avgRating}</span>
                          <span>리뷰 {rec.product.reviewCount}</span>
                          {rec.product.verifyScore > 0 && verifyBadge(rec.product.verifyScore)}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
                <div style={s.seeMore}>
                  <Link href="/market/products" style={s.seeMoreLink}>더 많은 추천 보기 →</Link>
                </div>
              </>
            )}

            <h2 style={{ ...s.sectionTitle, marginTop: '48px' }}>🔥 인기 상품 TOP 5</h2>
            <div style={s.grid3}>
              {stats.topProducts.map(p => (
                <Link key={p.id} href={`/market/products/${p.id}`} style={{ textDecoration: 'none' }}>
                  <div style={s.productCard}>
                    <div style={s.productTitle}>{p.title}</div>
                    <div style={s.productPrice}>{p.price.toLocaleString()} {p.currency}</div>
                    <div style={s.productMeta}>
                      <span>구매 {p.buyCount}회</span>
                      {p.verifyScore > 0 && verifyBadge(p.verifyScore)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            {stats.topProducts.length === 0 && (
              <p style={{ color: '#555', textAlign: 'center', marginBottom: '48px' }}>
                아직 상품이 없습니다.{' '}
                <Link href="/market/sell" style={{ color: '#4f46e5' }}>첫 상품을 등록해보세요!</Link>
              </p>
            )}

            <h2 style={s.sectionTitle}>⚡ 최근 주문</h2>
            {stats.recentOrders.length > 0 ? (
              <div style={{ background: '#111', border: '1px solid #222', borderRadius: '12px', overflow: 'hidden', marginBottom: '32px' }}>
                {stats.recentOrders.map((o, i) => (
                  <div key={o.id} style={{ padding: '16px 20px', borderBottom: i < stats.recentOrders.length - 1 ? '1px solid #1a1a1a' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '14px', color: '#fff', fontWeight: 500 }}>{o.product?.title}</div>
                      <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>{o.buyerName} · {new Date(o.createdAt).toLocaleDateString('ko-KR')}</div>
                    </div>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: '#4f46e5' }}>
                      {o.totalPrice.toLocaleString()} {o.currency}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: '#555', textAlign: 'center', marginBottom: '32px' }}>아직 주문이 없습니다.</p>
            )}

            <div style={s.seeMore}>
              <Link href="/market/products" style={s.seeMoreLink}>모든 상품 보기 →</Link>
            </div>
          </>
        ) : (
          <p style={{ color: '#f87171', textAlign: 'center' }}>데이터를 불러올 수 없습니다.</p>
        )}
      </div>
    </div>
  );
}
