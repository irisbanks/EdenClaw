'use client';

import { useState } from 'react';
import Link from 'next/link';

type Tab = 'product' | 'groupbuy' | 'verify';

const CATEGORIES = ['electronics', 'fashion', 'food', 'beauty', 'sports', 'books', 'digital', 'home', 'etc'];

const s = {
  page: { minHeight: '100vh', background: '#0a0a0a', color: '#e8e8e8', fontFamily: 'Arial, sans-serif' },
  nav: { background: '#111', borderBottom: '1px solid #222', padding: '0 24px', display: 'flex', alignItems: 'center', gap: '24px', height: '56px' },
  navBrand: { fontSize: '18px', fontWeight: 700, color: '#fff', textDecoration: 'none' } as React.CSSProperties,
  navLink: { color: '#aaa', fontSize: '14px', textDecoration: 'none' } as React.CSSProperties,
  navLinkActive: { color: '#fff', fontSize: '14px', textDecoration: 'none', fontWeight: 600 } as React.CSSProperties,
  container: { maxWidth: '800px', margin: '0 auto', padding: '32px 24px' },
  tabs: { display: 'flex', gap: '4px', marginBottom: '32px', background: '#111', borderRadius: '10px', padding: '4px', width: 'fit-content' },
  tab: (active: boolean) => ({
    padding: '10px 24px', borderRadius: '8px', fontSize: '14px', fontWeight: active ? 600 : 400,
    cursor: 'pointer', border: 'none', background: active ? '#4f46e5' : 'transparent', color: active ? '#fff' : '#888',
  }),
  section: { background: '#111', border: '1px solid #222', borderRadius: '14px', padding: '28px' },
  sectionTitle: { fontSize: '20px', fontWeight: 700, color: '#fff', marginBottom: '24px' },
  formGroup: { marginBottom: '18px' },
  label: { fontSize: '13px', color: '#888', marginBottom: '6px', display: 'block', fontWeight: 500 },
  input: { width: '100%', padding: '10px 14px', background: '#0a0a0a', border: '1px solid #333', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box' as const },
  textarea: { width: '100%', padding: '10px 14px', background: '#0a0a0a', border: '1px solid #333', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box' as const, minHeight: '100px', resize: 'vertical' as const },
  select: { width: '100%', padding: '10px 14px', background: '#0a0a0a', border: '1px solid #333', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', cursor: 'pointer' },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' } as React.CSSProperties,
  btnSubmit: { width: '100%', padding: '14px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', marginTop: '8px' },
  success: { background: '#14532d', border: '1px solid #166534', borderRadius: '10px', padding: '20px', textAlign: 'center' as const, color: '#4ade80' },
  error: { background: '#1c0000', border: '1px solid #7f1d1d', borderRadius: '8px', padding: '12px 14px', fontSize: '13px', color: '#f87171', marginBottom: '16px' },
  tip: { background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: '8px', padding: '14px', marginBottom: '20px', fontSize: '13px', color: '#94a3b8', lineHeight: 1.6 },
};

function ProductForm() {
  const [form, setForm] = useState({
    title: '', description: '', price: '', currency: 'KRW', category: 'etc',
    sellerName: '', stock: '1', tags: '', images: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ id: string; title: string } | null>(null);
  const [error, setError] = useState('');

  function update(k: string, v: string) { setForm(p => ({ ...p, [k]: v })); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    const tagsArr = form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const imagesArr = form.images ? form.images.split('\n').map(t => t.trim()).filter(Boolean) : [];

    const res = await fetch('/api/market/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: form.title,
        description: form.description,
        price: Number(form.price),
        currency: form.currency,
        category: form.category,
        sellerName: form.sellerName || '익명',
        stock: Number(form.stock),
        tags: tagsArr,
        images: imagesArr,
      }),
    });

    const data = await res.json();
    if (res.ok) {
      setResult(data);
    } else {
      setError(data.error || '등록 실패');
    }
    setSubmitting(false);
  }

  if (result) return (
    <div style={s.section}>
      <div style={s.success}>
        <div style={{ fontSize: '36px', marginBottom: '12px' }}>🎉</div>
        <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>상품 등록 완료!</div>
        <div style={{ fontSize: '14px', marginBottom: '20px', color: '#86efac' }}>{result.title}</div>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <Link href={`/market/products/${result.id}`} style={{ background: '#4f46e5', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, textDecoration: 'none' }}>
            상품 보기
          </Link>
          <button onClick={() => { setResult(null); setForm({ title: '', description: '', price: '', currency: 'KRW', category: 'etc', sellerName: '', stock: '1', tags: '', images: '' }); }}
            style={{ background: '#1a1a1a', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '14px', border: '1px solid #333', cursor: 'pointer' }}>
            추가 등록
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={s.section}>
      <h2 style={s.sectionTitle}>🏪 상품 등록</h2>
      <div style={s.tip}>
        💡 <strong>AI 검증 에이전트</strong>가 상품을 자동으로 평가합니다. 상세한 설명과 이미지를 추가하면 높은 점수를 받을 수 있습니다.
      </div>

      {error && <div style={s.error}>{error}</div>}

      <form onSubmit={submit}>
        <div style={s.formGroup}>
          <label style={s.label}>상품명 *</label>
          <input style={s.input} value={form.title} onChange={e => update('title', e.target.value)} placeholder="10~60자 입력 시 가산점" required />
        </div>

        <div style={s.formGroup}>
          <label style={s.label}>상품 설명 *</label>
          <textarea style={s.textarea} value={form.description} onChange={e => update('description', e.target.value)} placeholder="50자 이상 입력 시 가산점" required />
        </div>

        <div style={{ ...s.row, ...s.formGroup }}>
          <div>
            <label style={s.label}>가격 *</label>
            <input style={s.input} type="number" min="0" value={form.price} onChange={e => update('price', e.target.value)} placeholder="0" required />
          </div>
          <div>
            <label style={s.label}>통화</label>
            <select style={s.select} value={form.currency} onChange={e => update('currency', e.target.value)}>
              <option value="KRW">KRW (원)</option>
              <option value="USD">USD (달러)</option>
              <option value="EUR">EUR (유로)</option>
              <option value="ET">ET (에덴토큰)</option>
            </select>
          </div>
        </div>

        <div style={{ ...s.row, ...s.formGroup }}>
          <div>
            <label style={s.label}>카테고리</label>
            <select style={s.select} value={form.category} onChange={e => update('category', e.target.value)}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={s.label}>재고 수량 *</label>
            <input style={s.input} type="number" min="0" value={form.stock} onChange={e => update('stock', e.target.value)} required />
          </div>
        </div>

        <div style={s.formGroup}>
          <label style={s.label}>판매자명</label>
          <input style={s.input} value={form.sellerName} onChange={e => update('sellerName', e.target.value)} placeholder="익명으로 등록됩니다" />
        </div>

        <div style={s.formGroup}>
          <label style={s.label}>태그 (쉼표로 구분)</label>
          <input style={s.input} value={form.tags} onChange={e => update('tags', e.target.value)} placeholder="스마트폰, 무선, 가전" />
        </div>

        <div style={s.formGroup}>
          <label style={s.label}>이미지 URL (줄바꿈으로 구분)</label>
          <textarea style={{ ...s.textarea, minHeight: '70px' }} value={form.images} onChange={e => update('images', e.target.value)} placeholder="https://example.com/image1.jpg" />
        </div>

        <button type="submit" style={s.btnSubmit} disabled={submitting}>
          {submitting ? '등록 중...' : '상품 등록하기'}
        </button>
      </form>
    </div>
  );
}

function GroupBuyForm() {
  const [form, setForm] = useState({
    productId: '', title: '', description: '', targetCount: '10', discountRate: '10',
    deadline: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ id: string } | null>(null);
  const [error, setError] = useState('');

  function update(k: string, v: string) { setForm(p => ({ ...p, [k]: v })); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    const res = await fetch('/api/market/group-buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: form.productId,
        title: form.title,
        description: form.description,
        targetCount: Number(form.targetCount),
        discountRate: Number(form.discountRate),
        deadline: new Date(form.deadline).toISOString(),
      }),
    });

    const data = await res.json();
    if (res.ok) setResult(data);
    else setError(data.error || '개설 실패');
    setSubmitting(false);
  }

  if (result) return (
    <div style={s.section}>
      <div style={s.success}>
        <div style={{ fontSize: '36px', marginBottom: '12px' }}>⚡</div>
        <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '16px' }}>공동구매 개설 완료!</div>
        <Link href={`/market/group-buy/${result.id}`} style={{ background: '#4f46e5', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, textDecoration: 'none' }}>
          공동구매 보기
        </Link>
      </div>
    </div>
  );

  const minDate = new Date();
  minDate.setHours(minDate.getHours() + 1);
  const minDateStr = minDate.toISOString().slice(0, 16);

  return (
    <div style={s.section}>
      <h2 style={s.sectionTitle}>⚡ 공동구매 개설</h2>
      <div style={s.tip}>
        💡 상품 ID는 상품 등록 후 상품 상세 페이지 URL에서 확인할 수 있습니다. 할인율 1~90% 범위로 설정하세요.
      </div>

      {error && <div style={s.error}>{error}</div>}

      <form onSubmit={submit}>
        <div style={s.formGroup}>
          <label style={s.label}>상품 ID *</label>
          <input style={s.input} value={form.productId} onChange={e => update('productId', e.target.value)} placeholder="상품 상세 페이지에서 확인" required />
        </div>

        <div style={s.formGroup}>
          <label style={s.label}>공동구매 제목 *</label>
          <input style={s.input} value={form.title} onChange={e => update('title', e.target.value)} placeholder="예: 스마트폰 공동구매 - 10명이서 20% 절약" required />
        </div>

        <div style={s.formGroup}>
          <label style={s.label}>설명</label>
          <textarea style={s.textarea} value={form.description} onChange={e => update('description', e.target.value)} placeholder="공동구매 설명을 입력하세요" />
        </div>

        <div style={{ ...s.row, ...s.formGroup }}>
          <div>
            <label style={s.label}>목표 인원 *</label>
            <input style={s.input} type="number" min="2" max="10000" value={form.targetCount} onChange={e => update('targetCount', e.target.value)} required />
          </div>
          <div>
            <label style={s.label}>할인율 (%) *</label>
            <input style={s.input} type="number" min="1" max="90" value={form.discountRate} onChange={e => update('discountRate', e.target.value)} required />
          </div>
        </div>

        <div style={s.formGroup}>
          <label style={s.label}>마감 일시 *</label>
          <input style={s.input} type="datetime-local" min={minDateStr} value={form.deadline} onChange={e => update('deadline', e.target.value)} required />
        </div>

        <button type="submit" style={s.btnSubmit} disabled={submitting}>
          {submitting ? '개설 중...' : '공동구매 개설'}
        </button>
      </form>
    </div>
  );
}

function VerifyPanel() {
  const [productId, setProductId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ score: number; grade: string; comment: string; breakdown: Record<string, number> } | null>(null);
  const [error, setError] = useState('');

  async function runVerify() {
    if (!productId.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);

    const res = await fetch('/api/market/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: productId.trim() }),
    });

    const data = await res.json();
    if (res.ok) setResult(data);
    else setError(data.error || '검증 실패');
    setLoading(false);
  }

  return (
    <div style={s.section}>
      <h2 style={s.sectionTitle}>✅ AI 검증 에이전트</h2>
      <div style={s.tip}>
        💡 상품 ID를 입력하면 AI 에이전트가 상품을 자동으로 분석하고 신뢰도 점수를 부여합니다.
        점수는 0~100점이며, 70점 이상이면 ✅ 표준 인증을 받습니다.
      </div>

      {error && <div style={s.error}>{error}</div>}

      <div style={s.formGroup}>
        <label style={s.label}>상품 ID</label>
        <div style={{ display: 'flex', gap: '10px' }}>
          <input style={{ ...s.input, flex: 1 }} value={productId} onChange={e => setProductId(e.target.value)} placeholder="검증할 상품의 ID를 입력하세요" onKeyDown={e => e.key === 'Enter' && runVerify()} />
          <button onClick={runVerify} disabled={loading || !productId.trim()}
            style={{ padding: '10px 20px', background: '#0f3460', color: '#60a5fa', border: '1px solid #1e3a5f', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '14px', whiteSpace: 'nowrap' as const }}>
            {loading ? '검증 중...' : '🤖 검증 실행'}
          </button>
        </div>
      </div>

      {result && (
        <div style={{ background: '#0a0a0a', borderRadius: '10px', padding: '20px', marginTop: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
            <div style={{ fontSize: '36px', fontWeight: 800, color: result.score >= 70 ? '#4ade80' : result.score >= 50 ? '#fb923c' : '#f87171' }}>
              {result.score}점
            </div>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>{result.grade}</div>
              <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>{result.comment}</div>
            </div>
          </div>

          <div style={{ height: '8px', background: '#222', borderRadius: '4px', overflow: 'hidden', marginBottom: '20px' }}>
            <div style={{ height: '100%', width: `${result.score}%`, background: result.score >= 70 ? '#4ade80' : result.score >= 50 ? '#fb923c' : '#f87171', borderRadius: '4px', transition: 'width 1s' }} />
          </div>

          <div style={{ fontSize: '13px', color: '#666', marginBottom: '10px', fontWeight: 600 }}>점수 내역</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {Object.entries(result.breakdown).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: '#111', borderRadius: '6px' }}>
                <span style={{ color: '#aaa', fontSize: '13px' }}>{k}</span>
                <span style={{ color: '#fff', fontWeight: 600, fontSize: '13px' }}>{v}점</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SellPage() {
  const [tab, setTab] = useState<Tab>('product');

  return (
    <div style={s.page}>
      <nav style={s.nav}>
        <Link href="/market" style={s.navBrand}>🏪 AI Market</Link>
        <Link href="/market" style={s.navLink}>홈</Link>
        <Link href="/market/products" style={s.navLink}>상품</Link>
        <Link href="/market/group-buy" style={s.navLink}>공동구매</Link>
        <Link href="/market/sell" style={s.navLinkActive}>판매하기</Link>
      </nav>

      <div style={s.container}>
        <h1 style={{ fontSize: '26px', fontWeight: 700, color: '#fff', marginBottom: '28px' }}>🏪 판매자 대시보드</h1>

        <div style={s.tabs}>
          <button style={s.tab(tab === 'product')} onClick={() => setTab('product')}>상품 등록</button>
          <button style={s.tab(tab === 'groupbuy')} onClick={() => setTab('groupbuy')}>공동구매 개설</button>
          <button style={s.tab(tab === 'verify')} onClick={() => setTab('verify')}>AI 검증</button>
        </div>

        {tab === 'product' && <ProductForm />}
        {tab === 'groupbuy' && <GroupBuyForm />}
        {tab === 'verify' && <VerifyPanel />}
      </div>
    </div>
  );
}
