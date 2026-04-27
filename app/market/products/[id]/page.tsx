'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Product {
  id: string; title: string; description: string; price: number; currency: string;
  category: string; tags: string; images: string; sellerName: string; sellerId: string; sellerRating: number;
  stock: number; status: string; verifyScore: number; verifyComment: string;
  buyCount: number; viewCount: number; createdAt: string;
  reviews: Review[];
  groupBuys: GroupBuy[];
}
interface Review { id: string; reviewerName: string; rating: number; comment: string; helpful: number; createdAt: string }
interface GroupBuy { id: string; title: string; discountRate: number; discountedPrice: number; targetCount: number; currentCount: number; deadline: string; status: string }
interface VerificationResult {
  totalScore: number;
  grade: string;
  dimensions: Record<string, { score: number; label: string; comment: string }>;
  overallComment: string;
  risks: string[];
}
interface PriceTrend {
  stats: { current: number; min: number; max: number; avg: number; changeRate: number };
  chart: { labels: string[]; prices: number[]; forecastLabels: string[]; forecast: number[] };
  aiAnalysis: { recommendation: string; recommendIcon: string; analysis: string; buyAdvice: string };
}
interface SellerRep {
  badge: string; badgeEmoji: string; totalScore: number;
  metrics: { completionRate: number; avgRating: number; responseSpeed: number; claimRate: number; activeDays: number };
}

const s = {
  page: { minHeight: '100vh', background: '#0a0a0a', color: '#e8e8e8', fontFamily: 'Arial, sans-serif' },
  nav: { background: '#111', borderBottom: '1px solid #222', padding: '0 24px', display: 'flex', alignItems: 'center', gap: '24px', height: '56px' },
  navBrand: { fontSize: '18px', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none' } as React.CSSProperties,
  navLink: { color: '#aaa', fontSize: '14px', textDecoration: 'none' } as React.CSSProperties,
  navSell: { marginLeft: 'auto', background: '#4f46e5', color: '#fff', padding: '8px 16px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, textDecoration: 'none' } as React.CSSProperties,
  container: { maxWidth: '1100px', margin: '0 auto', padding: '32px 24px' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 340px', gap: '32px' } as React.CSSProperties,
  section: { background: '#111', border: '1px solid #222', borderRadius: '12px', padding: '24px', marginBottom: '24px' },
  title: { fontSize: '24px', fontWeight: 700, color: '#fff', marginBottom: '12px', lineHeight: 1.4 },
  price: { fontSize: '32px', fontWeight: 800, color: '#4f46e5', marginBottom: '16px' },
  badge: (bg: string, color: string) => ({ display: 'inline-block', padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 600, background: bg, color, marginRight: '6px' }),
  btnPrimary: { width: '100%', padding: '14px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '16px', fontWeight: 700, cursor: 'pointer', marginBottom: '12px' },
  btnSecondary: { width: '100%', padding: '12px', background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: '10px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' },
  btnVerify: { width: '100%', padding: '10px', background: '#0f3460', color: '#60a5fa', border: '1px solid #1e3a5f', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', marginBottom: '8px' },
  btnNegotiate: { width: '100%', padding: '10px', background: '#1a0a2e', color: '#a78bfa', border: '1px solid #4f46e580', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', marginBottom: '8px' },
  scoreBar: { height: '8px', background: '#222', borderRadius: '4px', overflow: 'hidden', marginTop: '8px' },
  gbCard: { background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: '10px', padding: '16px', marginBottom: '12px' },
  progressBar: { height: '6px', background: '#222', borderRadius: '3px', marginTop: '8px', overflow: 'hidden' },
  reviewCard: { borderBottom: '1px solid #1a1a1a', paddingBottom: '16px', marginBottom: '16px' },
  stars: (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n),
};

// 5각형 레이더 차트 (SVG)
function RadarChart({ dimensions }: { dimensions: VerificationResult['dimensions'] }) {
  const keys = ['price', 'seller', 'description', 'meta', 'review'];
  const labels = ['가격 적정성', '판매자 신뢰', '상품 설명', '메타 완성도', '리뷰 진정성'];
  const scores = keys.map(k => (dimensions[k]?.score || 0) / 100);

  const cx = 120, cy = 120, r = 90;
  const angles = keys.map((_, i) => (i * 2 * Math.PI) / keys.length - Math.PI / 2);

  const toXY = (angle: number, radius: number) => ({
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  });

  const gridLevels = [0.25, 0.5, 0.75, 1.0];
  const dataPoints = scores.map((s, i) => toXY(angles[i], s * r));
  const dataPath = dataPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';

  return (
    <svg width="240" height="240" viewBox="0 0 240 240" style={{ display: 'block', margin: '0 auto' }}>
      {/* Grid */}
      {gridLevels.map(lvl => {
        const pts = angles.map(a => toXY(a, lvl * r));
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
        return <path key={lvl} d={d} fill="none" stroke="#333" strokeWidth="1" />;
      })}
      {/* Axes */}
      {angles.map((a, i) => {
        const end = toXY(a, r);
        return <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="#444" strokeWidth="1" />;
      })}
      {/* Data */}
      <path d={dataPath} fill="#4f46e540" stroke="#4f46e5" strokeWidth="2" />
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="4" fill="#4f46e5" />
      ))}
      {/* Labels */}
      {angles.map((a, i) => {
        const lp = toXY(a, r + 22);
        const score = Math.round((scores[i] || 0) * 100);
        return (
          <text key={i} x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill="#aaa">
            {labels[i]}
            <tspan x={lp.x} dy="11" fill="#4f46e5" fontWeight="bold">{score}</tspan>
          </text>
        );
      })}
    </svg>
  );
}

// 가격 라인 차트 (SVG)
function LineChart({ labels, prices, forecast, forecastLabels, currency }: {
  labels: string[]; prices: number[]; forecast: number[]; forecastLabels: string[]; currency: string;
}) {
  const allPrices = [...prices, ...forecast];
  const minV = Math.min(...allPrices) * 0.95;
  const maxV = Math.max(...allPrices) * 1.05;
  const W = 500, H = 140, PAD = 40;

  const toX = (i: number, total: number) => PAD + (i / (total - 1)) * (W - PAD * 2);
  const toY = (v: number) => H - PAD / 2 - ((v - minV) / (maxV - minV)) * (H - PAD);

  const histPoints = prices.map((v, i) => ({ x: toX(i, prices.length + forecast.length), y: toY(v) }));
  const forePoints = forecast.map((v, i) => ({ x: toX(prices.length + i, prices.length + forecast.length), y: toY(v) }));

  const histPath = histPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const forecastPath = forePoints.length > 0
    ? `M ${histPoints[histPoints.length - 1].x} ${histPoints[histPoints.length - 1].y} ` +
      forePoints.map((p) => `L ${p.x} ${p.y}`).join(' ')
    : '';

  const allLabels = [...labels.filter((_, i) => i % Math.ceil(labels.length / 5) === 0), '예측→'];

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 20}`} style={{ overflow: 'visible' }}>
      {/* Grid lines */}
      {[0.25, 0.5, 0.75, 1].map(lvl => {
        const y = toY(minV + (maxV - minV) * lvl);
        const price = Math.round(minV + (maxV - minV) * lvl);
        return (
          <g key={lvl}>
            <line x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="#222" strokeWidth="1" />
            <text x={PAD - 4} y={y} textAnchor="end" fontSize="9" fill="#555" dominantBaseline="middle">
              {price >= 1000 ? `${Math.round(price / 1000)}K` : price}
            </text>
          </g>
        );
      })}
      {/* Divider between history and forecast */}
      {histPoints.length > 0 && forePoints.length > 0 && (
        <line
          x1={histPoints[histPoints.length - 1].x}
          y1={PAD / 2}
          x2={histPoints[histPoints.length - 1].x}
          y2={H - PAD / 2}
          stroke="#444"
          strokeWidth="1"
          strokeDasharray="4"
        />
      )}
      {/* Historical line */}
      <path d={histPath} fill="none" stroke="#4f46e5" strokeWidth="2" />
      {/* Forecast line */}
      {forecastPath && <path d={forecastPath} fill="none" stroke="#f59e0b" strokeWidth="2" strokeDasharray="6 3" />}
      {/* Current price dot */}
      {histPoints.length > 0 && (
        <circle cx={histPoints[histPoints.length - 1].x} cy={histPoints[histPoints.length - 1].y} r="4" fill="#4f46e5" />
      )}
      {/* Legend */}
      <g>
        <line x1={W - 160} y1={10} x2={W - 140} y2={10} stroke="#4f46e5" strokeWidth="2" />
        <text x={W - 135} y={10} fontSize="9" fill="#888" dominantBaseline="middle">실제 가격</text>
        <line x1={W - 90} y1={10} x2={W - 70} y2={10} stroke="#f59e0b" strokeWidth="2" strokeDasharray="4" />
        <text x={W - 65} y={10} fontSize="9" fill="#888" dominantBaseline="middle">예측</text>
      </g>
      {/* Axis label */}
      <text x={W / 2} y={H + 16} textAnchor="middle" fontSize="9" fill="#555">{currency} 가격 트렌드 (30일 + 7일 예측)</text>
    </svg>
  );
}

function VerifyBadge({ score }: { score: number }) {
  if (score <= 0) return <span style={s.badge('#222', '#888')}>미검증</span>;
  if (score >= 90) return <span style={s.badge('#1e3a5f', '#60a5fa')}>🥇 프리미엄</span>;
  if (score >= 75) return <span style={s.badge('#14532d', '#4ade80')}>✅ 우수</span>;
  if (score >= 60) return <span style={s.badge('#422006', '#fb923c')}>📋 표준</span>;
  if (score >= 40) return <span style={s.badge('#2d1800', '#fbbf24')}>⚠️ 주의</span>;
  return <span style={s.badge('#1c0000', '#f87171')}>❌ 비추천</span>;
}

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [orderDone, setOrderDone] = useState(false);
  const [qty, setQty] = useState(1);
  const [verifyResult, setVerifyResult] = useState<VerificationResult | null>(null);
  const [priceTrend, setPriceTrend] = useState<PriceTrend | null>(null);
  const [sellerRep, setSellerRep] = useState<SellerRep | null>(null);
  const [showVerify, setShowVerify] = useState(false);
  const [showTrend, setShowTrend] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/market/products/${id}`)
      .then(r => r.json())
      .then(d => { setProduct(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!product) return;
    // 가격 트렌드 자동 로드
    fetch(`/api/market/products/${id}/price-trend`)
      .then(r => r.json())
      .then(d => setPriceTrend(d))
      .catch(() => {});
    // 판매자 신뢰도
    if (product.sellerId) {
      fetch(`/api/market/seller/${product.sellerId}/calculate-reputation`)
        .then(r => r.json())
        .then(d => setSellerRep(d))
        .catch(() => {});
    }
  }, [product, id]);

  async function runVerifyV2() {
    if (!product) return;
    setVerifying(true);
    setShowVerify(true);
    try {
      const res = await fetch(`/api/market/verify/${product.id}`, { method: 'POST' });
      const data = await res.json();
      setVerifyResult(data);
      setProduct(prev => prev ? { ...prev, verifyScore: data.totalScore, verifyComment: `${data.grade} | ${data.overallComment}` } : prev);
    } finally {
      setVerifying(false);
    }
  }

  async function placeOrder() {
    if (!product) return;
    setOrdering(true);
    const res = await fetch('/api/market/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, buyerName: '구매자', quantity: qty }),
    });
    if (res.ok) {
      setOrderDone(true);
      setProduct(prev => prev ? { ...prev, stock: prev.stock - qty, buyCount: prev.buyCount + qty } : prev);
    }
    setOrdering(false);
  }

  if (loading) return (
    <div style={s.page}>
      <p style={{ color: '#666', textAlign: 'center', padding: '100px' }}>로딩 중...</p>
    </div>
  );

  if (!product) return (
    <div style={s.page}>
      <p style={{ color: '#f87171', textAlign: 'center', padding: '100px' }}>상품을 찾을 수 없습니다.</p>
    </div>
  );

  const tags = JSON.parse(product.tags || '[]') as string[];
  const openGroupBuys = product.groupBuys?.filter(g => g.status === 'open') || [];

  return (
    <div style={s.page}>
      <nav style={s.nav}>
        <Link href="/market" style={s.navBrand}>🏪 AI Market</Link>
        <Link href="/market" style={s.navLink}>홈</Link>
        <Link href="/market/products" style={s.navLink}>상품</Link>
        <Link href="/market/group-buy" style={s.navLink}>공동구매</Link>
        <Link href="/market/sell" style={s.navSell}>+ 판매하기</Link>
      </nav>

      <div style={s.container}>
        <div style={{ marginBottom: '16px' }}>
          <Link href="/market/products" style={{ color: '#666', fontSize: '13px', textDecoration: 'none' }}>← 상품 목록</Link>
        </div>

        <div style={s.grid}>
          {/* Left */}
          <div>
            <div style={s.section}>
              <h1 style={s.title}>{product.title}</h1>
              <div style={{ marginBottom: '12px' }}>
                <VerifyBadge score={product.verifyScore} />
                <span style={s.badge('#1a1a1a', '#888')}>{product.category}</span>
                {product.stock === 0 && <span style={s.badge('#1c0000', '#f87171')}>품절</span>}
                {sellerRep && (
                  <span style={s.badge('#111', '#f59e0b')}>
                    {sellerRep.badgeEmoji} {sellerRep.badge} 판매자
                  </span>
                )}
              </div>
              <div style={s.price}>{product.price.toLocaleString()} {product.currency}</div>
              <p style={{ fontSize: '14px', color: '#aaa', lineHeight: 1.7, marginBottom: '16px' }}>{product.description}</p>

              {tags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
                  {tags.map((t, i) => (
                    <span key={i} style={s.badge('#1a1a2e', '#818cf8')}>#{t}</span>
                  ))}
                </div>
              )}

              <div style={{ fontSize: '13px', color: '#666', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <span>판매자: <strong style={{ color: '#aaa' }}>{product.sellerName}</strong></span>
                <span>재고: <strong style={{ color: product.stock > 0 ? '#4ade80' : '#f87171' }}>{product.stock}개</strong></span>
                <span>조회: {product.viewCount}</span>
                <span>구매: {product.buyCount}</span>
              </div>
            </div>

            {/* 가격 트렌드 */}
            {priceTrend && (
              <div style={s.section}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>📈 가격 트렌드</h2>
                  <button
                    onClick={() => setShowTrend(!showTrend)}
                    style={{ background: 'transparent', border: '1px solid #333', color: '#888', padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}
                  >
                    {showTrend ? '접기' : '차트 보기'}
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '16px' }}>
                  {[
                    { label: '현재가', value: `${priceTrend.stats.current.toLocaleString()}`, color: '#4f46e5' },
                    { label: '30일 최저', value: `${priceTrend.stats.min.toLocaleString()}`, color: '#4ade80' },
                    { label: '30일 최고', value: `${priceTrend.stats.max.toLocaleString()}`, color: '#f87171' },
                    { label: '변동', value: `${priceTrend.stats.changeRate > 0 ? '+' : ''}${priceTrend.stats.changeRate}%`, color: priceTrend.stats.changeRate > 0 ? '#f87171' : '#4ade80' },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: '#0a0a0a', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', color: '#555', marginBottom: '4px' }}>{label}</div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color }}>{value}</div>
                    </div>
                  ))}
                </div>

                {showTrend && priceTrend.chart.prices.length > 1 && (
                  <div style={{ marginBottom: '16px', overflowX: 'auto' }}>
                    <LineChart
                      labels={priceTrend.chart.labels}
                      prices={priceTrend.chart.prices}
                      forecast={priceTrend.chart.forecast}
                      forecastLabels={priceTrend.chart.forecastLabels}
                      currency={product.currency}
                    />
                  </div>
                )}

                <div style={{ background: '#0a0a0a', borderRadius: '8px', padding: '12px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#fff', marginBottom: '6px' }}>
                    {priceTrend.aiAnalysis.recommendIcon}
                  </div>
                  <div style={{ fontSize: '12px', color: '#aaa', lineHeight: 1.6 }}>{priceTrend.aiAnalysis.buyAdvice}</div>
                </div>
              </div>
            )}

            {/* AI 검증 v2 */}
            {showVerify && (
              <div style={s.section}>
                <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '16px' }}>
                  🔬 AI 검증 v2 — 5차원 분석
                </h2>
                {verifying ? (
                  <p style={{ color: '#666', textAlign: 'center', padding: '24px' }}>⏳ 검증 중...</p>
                ) : verifyResult ? (
                  <>
                    <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                      <div style={{ fontSize: '36px', fontWeight: 800, color: '#60a5fa' }}>{verifyResult.totalScore}점</div>
                      <div style={{ fontSize: '16px', color: '#aaa', marginTop: '4px' }}>{verifyResult.grade}</div>
                    </div>
                    <RadarChart dimensions={verifyResult.dimensions} />
                    <div style={{ display: 'grid', gap: '8px', marginTop: '16px' }}>
                      {Object.entries(verifyResult.dimensions).map(([key, dim]) => (
                        <div key={key} style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '12px', color: '#888' }}>{dim.label}</span>
                          <div style={s.scoreBar}>
                            <div style={{ height: '100%', width: `${dim.score}%`, background: dim.score >= 70 ? '#4ade80' : dim.score >= 40 ? '#f59e0b' : '#f87171', borderRadius: '4px' }} />
                          </div>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: '#fff', minWidth: '30px', textAlign: 'right' }}>{dim.score}</span>
                        </div>
                      ))}
                    </div>
                    {verifyResult.risks.length > 0 && (
                      <div style={{ marginTop: '12px', background: '#1c0a00', border: '1px solid #f5703480', borderRadius: '8px', padding: '10px' }}>
                        <div style={{ fontSize: '12px', color: '#f87171', fontWeight: 600, marginBottom: '4px' }}>⚠️ 위험 요소</div>
                        {verifyResult.risks.map((r, i) => (
                          <div key={i} style={{ fontSize: '12px', color: '#aaa' }}>• {r}</div>
                        ))}
                      </div>
                    )}
                    {verifyResult.overallComment && (
                      <p style={{ fontSize: '13px', color: '#aaa', lineHeight: 1.6, marginTop: '12px' }}>{verifyResult.overallComment}</p>
                    )}
                  </>
                ) : null}
              </div>
            )}

            {/* 판매자 신뢰도 */}
            {sellerRep && (
              <div style={s.section}>
                <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '16px' }}>
                  {sellerRep.badgeEmoji} 판매자 신뢰도 — {sellerRep.badge}
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
                  <div style={{ fontSize: '40px', fontWeight: 800, color: '#f59e0b' }}>{sellerRep.totalScore}</div>
                  <div>
                    <div style={{ fontSize: '13px', color: '#fff', fontWeight: 600 }}>{product.sellerName}</div>
                    <div style={{ fontSize: '12px', color: '#666' }}>종합 신뢰도 점수</div>
                  </div>
                </div>
                <div style={{ display: 'grid', gap: '8px' }}>
                  {[
                    { label: '거래 완료율', value: sellerRep.metrics.completionRate },
                    { label: '평균 평점', value: Math.round(sellerRep.metrics.avgRating * 20) },
                    { label: '응답 속도', value: sellerRep.metrics.responseSpeed },
                    { label: '클레임 안전도', value: Math.round(100 - sellerRep.metrics.claimRate * 100) },
                    { label: '활동 성실도', value: Math.min(100, Math.round(sellerRep.metrics.activeDays / 365 * 100)) },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ display: 'grid', gridTemplateColumns: '100px 1fr auto', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12px', color: '#888' }}>{label}</span>
                      <div style={s.scoreBar}>
                        <div style={{ height: '100%', width: `${value}%`, background: '#f59e0b', borderRadius: '4px' }} />
                      </div>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#f59e0b', minWidth: '30px', textAlign: 'right' }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Group buys */}
            {openGroupBuys.length > 0 && (
              <div style={s.section}>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#fff', marginBottom: '16px' }}>⚡ 진행 중 공동구매</h2>
                {openGroupBuys.map(gb => {
                  const pct = Math.round((gb.currentCount / gb.targetCount) * 100);
                  const hours = Math.max(0, Math.floor((new Date(gb.deadline).getTime() - Date.now()) / 3600000));
                  return (
                    <Link key={gb.id} href={`/market/group-buy/${gb.id}`} style={{ textDecoration: 'none' }}>
                      <div style={s.gbCard}>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff', marginBottom: '4px' }}>{gb.title}</div>
                        <div style={{ fontSize: '13px', color: '#60a5fa', fontWeight: 700 }}>
                          {gb.discountedPrice.toLocaleString()} {product.currency}
                          <span style={{ color: '#666', fontWeight: 400, marginLeft: '8px' }}>{gb.discountRate}% 할인</span>
                        </div>
                        <div style={s.progressBar}>
                          <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: pct >= 100 ? '#22c55e' : '#4f46e5', borderRadius: '3px' }} />
                        </div>
                        <div style={{ fontSize: '12px', color: '#888', marginTop: '6px', display: 'flex', justifyContent: 'space-between' }}>
                          <span>{gb.currentCount}/{gb.targetCount}명 ({pct}%)</span>
                          <span>{hours}시간 남음</span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            {/* Reviews */}
            <div style={s.section}>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#fff', marginBottom: '16px' }}>
                💬 리뷰 ({product.reviews?.length || 0}개)
              </h2>
              {product.reviews?.length === 0 ? (
                <p style={{ color: '#555', fontSize: '14px' }}>아직 리뷰가 없습니다.</p>
              ) : (
                product.reviews?.map(r => (
                  <div key={r.id} style={s.reviewCard}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <strong style={{ fontSize: '14px', color: '#fff' }}>{r.reviewerName}</strong>
                      <span style={{ color: '#fbbf24', fontSize: '14px' }}>{s.stars(r.rating)}</span>
                    </div>
                    <p style={{ fontSize: '13px', color: '#aaa', lineHeight: 1.6 }}>{r.comment}</p>
                    <div style={{ fontSize: '12px', color: '#555', marginTop: '6px' }}>
                      {new Date(r.createdAt).toLocaleDateString('ko-KR')} · 도움됨 {r.helpful}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right: buy box */}
          <div>
            <div style={{ ...s.section, position: 'sticky', top: '24px' }}>
              <div style={{ fontSize: '13px', color: '#666', marginBottom: '8px' }}>구매 수량</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                <button onClick={() => setQty(q => Math.max(1, q - 1))} style={{ padding: '6px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontSize: '16px' }}>-</button>
                <span style={{ fontSize: '18px', fontWeight: 700, color: '#fff', minWidth: '30px', textAlign: 'center' }}>{qty}</span>
                <button onClick={() => setQty(q => Math.min(product.stock, q + 1))} style={{ padding: '6px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: '6px', color: '#fff', cursor: 'pointer', fontSize: '16px' }}>+</button>
              </div>

              <div style={{ fontSize: '13px', color: '#666', marginBottom: '4px' }}>합계</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#4f46e5', marginBottom: '20px' }}>
                {(product.price * qty).toLocaleString()} {product.currency}
              </div>

              {orderDone ? (
                <div style={{ padding: '14px', background: '#14532d', borderRadius: '10px', textAlign: 'center', color: '#4ade80', fontWeight: 600, marginBottom: '12px' }}>
                  ✅ 주문 완료!
                </div>
              ) : (
                <button
                  style={{ ...s.btnPrimary, opacity: product.stock === 0 ? 0.4 : 1 }}
                  onClick={placeOrder}
                  disabled={ordering || product.stock === 0}
                >
                  {ordering ? '처리 중...' : product.stock === 0 ? '품절' : '바로 구매'}
                </button>
              )}

              {openGroupBuys.length > 0 && (
                <Link href={`/market/group-buy/${openGroupBuys[0].id}`} style={{ ...s.btnSecondary, display: 'block', textAlign: 'center', marginBottom: '8px', textDecoration: 'none' }}>
                  ⚡ {openGroupBuys[0].discountRate}% 할인 공동구매
                </Link>
              )}

              <Link href={`/market/products/${id}/negotiate`} style={{ display: 'block', textDecoration: 'none' }}>
                <button style={s.btnNegotiate}>🤝 AI 협상으로 더 싸게</button>
              </Link>

              <button style={s.btnVerify} onClick={runVerifyV2} disabled={verifying}>
                {verifying ? '검증 중...' : '🔬 AI 검증 v2 (5차원)'}
              </button>

              {product.verifyScore > 0 && (
                <div style={{ background: '#0a0a0a', borderRadius: '8px', padding: '12px' }}>
                  <div style={{ fontSize: '12px', color: '#888', marginBottom: '6px' }}>검증 점수</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#60a5fa' }}>{product.verifyScore}점</div>
                  <div style={s.scoreBar}>
                    <div style={{ height: '100%', width: `${product.verifyScore}%`, background: product.verifyScore >= 70 ? '#4ade80' : product.verifyScore >= 50 ? '#fb923c' : '#f87171', borderRadius: '4px' }} />
                  </div>
                  {product.verifyComment && (
                    <p style={{ fontSize: '12px', color: '#aaa', marginTop: '8px', lineHeight: 1.5 }}>{product.verifyComment.slice(0, 100)}</p>
                  )}
                </div>
              )}

              {priceTrend && (
                <div style={{ marginTop: '12px', background: '#0a0a0a', borderRadius: '8px', padding: '10px' }}>
                  <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>AI 구매 추천</div>
                  <div style={{ fontSize: '13px', color: '#fff', fontWeight: 600 }}>{priceTrend.aiAnalysis.recommendIcon}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
