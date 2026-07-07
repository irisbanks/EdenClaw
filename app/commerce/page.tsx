'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

type ExternalPremiumProduct = {
  id: string;
  name: string;
  title: string;
  description: string;
  price: number;
  pvValue: number;
  bvValue: number;
};

type TokenPack = {
  id: string;
  name: string;
  priceUsd: number;
  priceKrw: number;
  tokens: number;
};

const s = {
  page: { minHeight: '100vh', background: '#0a0a0a', color: '#e8e8e8', fontFamily: 'Arial, sans-serif' },
  nav: { background: '#111', borderBottom: '1px solid #222', padding: '0 24px', display: 'flex', alignItems: 'center', gap: '24px', height: '56px' },
  navBrand: { fontSize: '18px', fontWeight: 700, color: '#fff', textDecoration: 'none' } as React.CSSProperties,
  container: { maxWidth: '720px', margin: '0 auto', padding: '32px 24px' },
  title: { fontSize: '24px', fontWeight: 700, color: '#fff', marginBottom: '8px' },
  subtitle: { fontSize: '14px', color: '#888', marginBottom: '20px' },
  demoBanner: {
    background: '#3f2d00', border: '1px solid #7a5c00', borderRadius: '10px',
    padding: '14px 16px', fontSize: '13px', color: '#fde68a', lineHeight: 1.6, marginBottom: '24px',
  },
  section: { background: '#111', border: '1px solid #222', borderRadius: '14px', padding: '24px', marginBottom: '20px' },
  sectionTitle: { fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '16px' },
  card: (selected: boolean) => ({
    border: selected ? '1px solid #4f46e5' : '1px solid #222',
    background: selected ? 'rgba(79,70,229,0.08)' : '#0a0a0a',
    borderRadius: '10px', padding: '16px', marginBottom: '12px', cursor: 'pointer',
  }),
  cardTitle: { fontSize: '15px', fontWeight: 700, color: '#fff' },
  cardDesc: { fontSize: '13px', color: '#888', marginTop: '4px' },
  cardPrice: { fontSize: '14px', color: '#a5b4fc', marginTop: '8px', fontWeight: 600 },
  label: { fontSize: '13px', color: '#888', marginBottom: '6px', display: 'block', fontWeight: 500 },
  input: { width: '100%', padding: '10px 14px', background: '#0a0a0a', border: '1px solid #333', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box' as const },
  btnSubmit: { width: '100%', padding: '14px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', marginTop: '16px' },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  success: { background: '#14532d', border: '1px solid #166534', borderRadius: '10px', padding: '16px', color: '#4ade80', fontSize: '13px', lineHeight: 1.6, marginTop: '16px' },
  error: { background: '#1c0000', border: '1px solid #7f1d1d', borderRadius: '8px', padding: '12px 14px', fontSize: '13px', color: '#f87171', marginTop: '16px' },
};

function formatKRW(value: number): string {
  return value.toLocaleString('ko-KR') + '원';
}

function CommerceContent() {
  const searchParams = useSearchParams();
  const initialItem = searchParams.get('item') || '';

  const [premiumProducts, setPremiumProducts] = useState<ExternalPremiumProduct[]>([]);
  const [tokenPacks, setTokenPacks] = useState<TokenPack[]>([]);
  const [selected, setSelected] = useState<string>(initialItem);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    fetch('/api/commerce/products').then((r) => r.json()).then((d) => {
      if (d.ok) setPremiumProducts(d.products);
    }).catch(() => undefined);
    fetch('/api/commerce/token-pack').then((r) => r.json()).then((d) => {
      if (d.ok) setTokenPacks(d.packs);
    }).catch(() => undefined);
  }, []);

  const isTokenPack = tokenPacks.some((p) => p.id === selected);
  const isPremium = premiumProducts.some((p) => p.id === selected);

  async function handlePurchase() {
    if (!selected || !email.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const endpoint = isTokenPack ? '/api/commerce/token-pack' : '/api/commerce/buy';
      const payload = isTokenPack
        ? { email, packId: selected }
        : { email, productId: selected };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setResult({ ok: false, message: data.error || data.message || '처리 중 오류가 발생했습니다.' });
        return;
      }
      if (isTokenPack) {
        setResult({
          ok: true,
          message: `충전 완료. 잔여 토큰: ${data.quota.remaining.toLocaleString('ko-KR')} / ${data.quota.allocated.toLocaleString('ko-KR')}`,
        });
      } else {
        setResult({
          ok: true,
          message: `구매 완료. 상위 라인 ${data.rollup?.depth ?? 0}단계 수당 반영. 트랜잭션: ${data.transactionId}`,
        });
      }
    } catch {
      setResult({ ok: false, message: '네트워크 오류로 처리하지 못했습니다.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.page}>
      <nav style={s.nav}>
        <Link href="/" style={s.navBrand}>EDENCLAW</Link>
      </nav>
      <div style={s.container}>
        <div style={s.title}>충전 / 구매</div>
        <div style={s.subtitle}>AI 사용료 토큰 충전 및 프리미엄 패키지 구매</div>

        <div style={s.demoBanner}>
          ⚠ 실제 카드 결제 게이트웨이 연동 전 단계입니다. 이메일 확인만으로 즉시 토큰/상품이
          지급되는 테스트 모드이며, 실제 금액이 청구되지 않습니다. 실결제 연동 후 이 배너는
          제거됩니다.
        </div>

        <div style={s.section}>
          <div style={s.sectionTitle}>토큰 충전팩</div>
          {tokenPacks.map((pack) => (
            <div key={pack.id} style={s.card(selected === pack.id)} onClick={() => setSelected(pack.id)}>
              <div style={s.cardTitle}>{pack.name}</div>
              <div style={s.cardDesc}>{pack.tokens.toLocaleString('ko-KR')} 토큰</div>
              <div style={s.cardPrice}>{formatKRW(pack.priceKrw)} (${pack.priceUsd})</div>
            </div>
          ))}
        </div>

        <div style={s.section}>
          <div style={s.sectionTitle}>프리미엄 패키지</div>
          {premiumProducts.map((product) => (
            <div key={product.id} style={s.card(selected === product.id)} onClick={() => setSelected(product.id)}>
              <div style={s.cardTitle}>{product.title}</div>
              <div style={s.cardDesc}>{product.description}</div>
              <div style={s.cardPrice}>{formatKRW(product.price)}</div>
            </div>
          ))}
        </div>

        <div style={s.section}>
          <label style={s.label}>가입 이메일</label>
          <input
            style={s.input}
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            style={{ ...s.btnSubmit, ...((!selected || !email.trim() || loading) ? s.btnDisabled : {}) }}
            disabled={!selected || !email.trim() || loading || (!isTokenPack && !isPremium)}
            onClick={handlePurchase}
          >
            {loading ? '처리 중…' : '충전/구매하기'}
          </button>
          {result ? (
            <div style={result.ok ? s.success : s.error}>{result.message}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function CommercePage() {
  return (
    <Suspense fallback={<div style={s.page} />}>
      <CommerceContent />
    </Suspense>
  );
}
