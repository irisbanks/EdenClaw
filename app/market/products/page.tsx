'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';

interface Product {
  id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  category: string;
  sellerName: string;
  stock: number;
  verifyScore: number;
  buyCount: number;
  avgRating: number;
  reviewCount: number;
  aiReason?: string;
  aiScore?: number;
}

interface AgentMessage {
  type: 'agent' | 'thinking' | 'found' | 'done' | 'error';
  message: string;
}

interface SearchIntent {
  keywords: string[];
  category: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  intent: string;
  pitch: string;
}

const CATEGORIES = ['전체', 'electronics', 'fashion', 'food', 'beauty', 'sports', 'books', 'digital', 'home', 'etc'];
const SORTS = [
  { value: 'createdAt', label: '최신순' },
  { value: 'buyCount', label: '인기순' },
  { value: 'price', label: '가격순' },
  { value: 'verifyScore', label: '검증순' },
];

const s = {
  page: { minHeight: '100vh', background: '#0a0a0a', color: '#e8e8e8', fontFamily: 'Arial, sans-serif' },
  nav: { background: '#111', borderBottom: '1px solid #222', padding: '0 24px', display: 'flex', alignItems: 'center', gap: '24px', height: '56px' },
  navBrand: { fontSize: '18px', fontWeight: 700, color: '#fff', textDecoration: 'none' } as React.CSSProperties,
  navLink: { color: '#aaa', fontSize: '14px', textDecoration: 'none' } as React.CSSProperties,
  navLinkActive: { color: '#fff', fontSize: '14px', textDecoration: 'none', fontWeight: 600 } as React.CSSProperties,
  navSell: { marginLeft: 'auto', background: '#4f46e5', color: '#fff', padding: '8px 16px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, textDecoration: 'none' } as React.CSSProperties,
  container: { maxWidth: '1200px', margin: '0 auto', padding: '32px 24px' },
  searchBar: { position: 'relative' as const, marginBottom: '16px' },
  searchInput: { width: '100%', padding: '14px 52px 14px 18px', background: '#111', border: '1px solid #333', borderRadius: '12px', color: '#fff', fontSize: '16px', outline: 'none', boxSizing: 'border-box' as const },
  searchBtn: { position: 'absolute' as const, right: '12px', top: '50%', transform: 'translateY(-50%)', background: '#4f46e5', border: 'none', borderRadius: '8px', padding: '6px 14px', color: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: 600 },
  aiModeToggle: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' },
  toggleBtn: (on: boolean) => ({ padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', border: 'none', background: on ? '#4f46e5' : '#1a1a1a', color: on ? '#fff' : '#888' }),
  // 에이전트 패널
  agentPanel: { background: 'linear-gradient(135deg, #0d1a3f 0%, #0a1428 100%)', border: '1px solid #1e3a6f', borderRadius: '14px', padding: '20px', marginBottom: '20px' },
  agentHeader: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' },
  agentAvatar: { width: '36px', height: '36px', background: '#4f46e5', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 },
  agentName: { fontSize: '14px', fontWeight: 700, color: '#60a5fa' },
  agentStatus: { fontSize: '11px', color: '#4f70a8', marginTop: '2px' },
  agentMessages: { display: 'flex', flexDirection: 'column' as const, gap: '8px', maxHeight: '160px', overflowY: 'auto' as const },
  agentMsg: (type: string) => ({
    padding: '8px 12px', borderRadius: '8px', fontSize: '13px', lineHeight: 1.5,
    background: type === 'thinking' ? '#0a1020' : type === 'found' ? '#0a1e10' : type === 'done' ? '#0a1e0a' : '#111620',
    color: type === 'thinking' ? '#6a8fc8' : type === 'found' ? '#4ade80' : type === 'done' ? '#22c55e' : '#a8c0e8',
    borderLeft: `3px solid ${type === 'thinking' ? '#2a4a8f' : type === 'found' ? '#166534' : type === 'done' ? '#15803d' : '#1e3a6f'}`,
  }),
  agentDot: { display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#4f46e5', marginRight: '6px', animation: 'pulse 1s infinite' },
  pitchBox: { background: 'linear-gradient(135deg, #1a1a3e 0%, #0f2460 100%)', border: '1px solid #2a3a6f', borderRadius: '12px', padding: '16px 20px', marginBottom: '20px', display: 'flex', gap: '12px', alignItems: 'flex-start' },
  pitchText: { fontSize: '14px', color: '#a8c0e8', lineHeight: 1.6 },
  pitchKeywords: { display: 'flex', gap: '6px', flexWrap: 'wrap' as const, marginTop: '8px' },
  pitchTag: { padding: '2px 8px', borderRadius: '12px', fontSize: '11px', background: '#2a3a6f', color: '#60a5fa' },
  filterBar: { display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' as const, alignItems: 'center' },
  select: { padding: '8px 12px', background: '#111', border: '1px solid #333', borderRadius: '8px', color: '#fff', fontSize: '13px', outline: 'none', cursor: 'pointer' },
  catPill: (active: boolean) => ({ padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', border: 'none', background: active ? '#4f46e5' : '#1a1a1a', color: active ? '#fff' : '#888' }),
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '20px' },
  card: { background: '#111', border: '1px solid #222', borderRadius: '12px', padding: '20px', display: 'block', textDecoration: 'none', transition: 'border-color 0.2s', animation: 'fadeSlideIn 0.4s ease' } as React.CSSProperties,
  cardTitle: { fontSize: '15px', fontWeight: 600, color: '#fff', marginBottom: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  cardDesc: { fontSize: '12px', color: '#666', marginBottom: '10px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const },
  cardPrice: { fontSize: '20px', fontWeight: 700, color: '#4f46e5', marginBottom: '8px' },
  aiReason: { fontSize: '11px', color: '#60a5fa', background: '#0f1a3f', borderRadius: '6px', padding: '4px 8px', marginTop: '8px', lineHeight: 1.5 },
  badge: (bg: string, color: string) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: bg, color }),
  seller: { fontSize: '12px', color: '#666', marginTop: '6px' },
  noResults: { textAlign: 'center' as const, padding: '80px 24px', color: '#555' },
  pageBtn: (active: boolean) => ({ padding: '6px 12px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', border: 'none', background: active ? '#4f46e5' : '#1a1a1a', color: active ? '#fff' : '#888' }),
  pagination: { display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '40px', flexWrap: 'wrap' as const },
  loadingSpinner: { textAlign: 'center' as const, padding: '60px', color: '#666' },
};

function VerifyBadge({ score }: { score: number }) {
  if (!score || score <= 0) return null;
  if (score >= 90) return <span style={s.badge('#1e3a5f', '#60a5fa')}>🥇 프리미엄</span>;
  if (score >= 70) return <span style={s.badge('#14532d', '#4ade80')}>✅ 표준</span>;
  if (score >= 50) return <span style={s.badge('#422006', '#fb923c')}>⚠️ 주의</span>;
  return null;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [inputVal, setInputVal] = useState('');
  const [category, setCategory] = useState('전체');
  const [sort, setSort] = useState('createdAt');
  const [loading, setLoading] = useState(true);
  // AI 에이전트 모드
  const [aiMode, setAiMode] = useState(false);
  const [streamMode, setStreamMode] = useState(false);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentStatus, setAgentStatus] = useState<'idle' | 'running' | 'done'>('idle');
  const [intent, setIntent] = useState<SearchIntent | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const msgEndRef = useRef<HTMLDivElement>(null);

  const fetchProducts = useCallback(() => {
    if (aiMode && search) return;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '12', sort, order: 'desc' });
    if (search) params.set('search', search);
    if (category !== '전체') params.set('category', category);

    fetch(`/api/market/products?${params}`)
      .then(r => r.json())
      .then(d => {
        setProducts(d.products || []);
        setTotal(d.total || 0);
        setPages(d.pages || 1);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page, search, category, sort, aiMode]);

  // 일반 AI 검색 (비스트리밍)
  const fetchAI = useCallback(async (q: string) => {
    if (!q.trim()) { fetchProducts(); return; }
    setLoading(true);
    setIntent(null);
    try {
      const res = await fetch(`/api/market/search?q=${encodeURIComponent(q)}&limit=12`);
      const d = await res.json();
      setProducts(d.results || []);
      setTotal(d.total || 0);
      setPages(1);
      setIntent(d.intent || null);
    } catch {}
    setLoading(false);
  }, [fetchProducts]);

  // 스트리밍 AI 에이전트 검색
  const fetchStream = useCallback(async (q: string) => {
    if (!q.trim()) { fetchProducts(); return; }

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setProducts([]);
    setAgentMessages([]);
    setAgentStatus('running');
    setLoading(false);
    setIntent(null);

    try {
      const res = await fetch(`/api/market/search/stream?q=${encodeURIComponent(q)}&limit=10`, {
        signal: abortRef.current.signal,
      });
      if (!res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'agent' || ev.type === 'thinking' || ev.type === 'found' || ev.type === 'done' || ev.type === 'error') {
              setAgentMessages(prev => [...prev, { type: ev.type, message: ev.message }]);
              if (ev.type === 'done') setAgentStatus('done');
            } else if (ev.type === 'intent') {
              setIntent(ev.data);
            } else if (ev.type === 'product') {
              setProducts(prev => [...prev, ev.product]);
              setTotal(prev => prev + 1);
            }
          } catch {}
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setAgentMessages(prev => [...prev, { type: 'error', message: '스트리밍 오류 발생' }]);
      }
    }
    setAgentStatus('done');
  }, [fetchProducts]);

  useEffect(() => {
    if (!aiMode || !search) fetchProducts();
  }, [fetchProducts, aiMode, search]);

  useEffect(() => {
    if (!aiMode || !search.trim()) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      if (streamMode) fetchStream(search);
      else fetchAI(search);
    }, 800);
    return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); };
  }, [search, aiMode, streamMode, fetchStream, fetchAI]);

  useEffect(() => { setPage(1); }, [search, category, sort]);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agentMessages]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const val = inputVal.trim();
    setSearch(val);
    if (aiMode && val) {
      if (streamMode) fetchStream(val);
      else fetchAI(val);
    }
  }

  return (
    <div style={s.page}>
      <style>{`
        @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      <nav style={s.nav}>
        <Link href="/market" style={s.navBrand}>🏪 AI Market</Link>
        <Link href="/market" style={s.navLink}>홈</Link>
        <Link href="/market/products" style={s.navLinkActive}>상품</Link>
        <Link href="/market/group-buy" style={s.navLink}>공동구매</Link>
        <Link href="/market/sell" style={s.navSell}>+ 판매하기</Link>
      </nav>

      <div style={s.container}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#fff', marginBottom: '20px' }}>
          상품 목록{' '}
          <span style={{ fontSize: '14px', color: '#666', fontWeight: 400 }}>({total.toLocaleString()}개)</span>
        </h1>

        {/* 검색 모드 선택 */}
        <div style={s.aiModeToggle}>
          <button style={s.toggleBtn(!aiMode)} onClick={() => { setAiMode(false); setIntent(null); setAgentMessages([]); setAgentStatus('idle'); }}>
            🔍 일반 검색
          </button>
          <button style={s.toggleBtn(aiMode && !streamMode)} onClick={() => { setAiMode(true); setStreamMode(false); }}>
            🤖 AI 검색
          </button>
          <button style={s.toggleBtn(aiMode && streamMode)} onClick={() => { setAiMode(true); setStreamMode(true); }}>
            ⚡ 에이전트 실시간
          </button>
          {aiMode && streamMode && <span style={{ fontSize: '12px', color: '#4f46e5' }}>AI 에이전트가 실시간으로 상품을 가져옵니다</span>}
          {aiMode && !streamMode && <span style={{ fontSize: '12px', color: '#4f46e5' }}>자연어로 원하는 상품을 설명해보세요</span>}
        </div>

        {/* 검색창 */}
        <form onSubmit={handleSearch} style={s.searchBar}>
          <input
            style={s.searchInput}
            placeholder={aiMode ? '예: 30만원 이하 무선 이어폰 추천해줘' : '상품명 검색...'}
            value={inputVal}
            onChange={e => { setInputVal(e.target.value); if (!aiMode) setSearch(e.target.value); }}
          />
          <button type="submit" style={s.searchBtn}>
            {aiMode && agentStatus === 'running' ? (
              <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
            ) : aiMode ? '🤖' : '🔍'}
          </button>
        </form>

        {/* 스트리밍 에이전트 패널 */}
        {aiMode && streamMode && (agentMessages.length > 0 || agentStatus === 'running') && (
          <div style={s.agentPanel}>
            <div style={s.agentHeader}>
              <div style={s.agentAvatar}>🤖</div>
              <div>
                <div style={s.agentName}>AI 판매 에이전트</div>
                <div style={s.agentStatus}>
                  {agentStatus === 'running' ? '🟢 검색 중...' : agentStatus === 'done' ? `✅ 완료 - ${products.length}개 상품` : '⏸ 대기중'}
                </div>
              </div>
            </div>
            <div style={s.agentMessages}>
              {agentMessages.map((msg, i) => (
                <div key={i} style={s.agentMsg(msg.type)}>
                  {msg.type === 'thinking' && <span style={s.agentDot} />}
                  {msg.message}
                </div>
              ))}
              <div ref={msgEndRef} />
            </div>
          </div>
        )}

        {/* AI 의도 분석 결과 */}
        {aiMode && intent && search && (
          <div style={s.pitchBox}>
            <span style={{ fontSize: '24px', flexShrink: 0 }}>🤖</span>
            <div>
              <div style={s.pitchText}>{intent.pitch}</div>
              {intent.keywords.length > 0 && (
                <div style={s.pitchKeywords}>
                  {intent.keywords.map(k => <span key={k} style={s.pitchTag}>#{k}</span>)}
                  {intent.category && <span style={{ ...s.pitchTag, background: '#1a3a2a', color: '#4ade80' }}>📁 {intent.category}</span>}
                  {intent.minPrice !== null && <span style={{ ...s.pitchTag, background: '#3a2a1a', color: '#fb923c' }}>₩{intent.minPrice.toLocaleString()}↑</span>}
                  {intent.maxPrice !== null && <span style={{ ...s.pitchTag, background: '#3a2a1a', color: '#fb923c' }}>₩{intent.maxPrice.toLocaleString()}↓</span>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 일반 검색 필터 */}
        {!aiMode && (
          <>
            <div style={s.filterBar}>
              <select style={s.select} value={sort} onChange={e => setSort(e.target.value)}>
                {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '24px' }}>
              {CATEGORIES.map(cat => (
                <button key={cat} style={s.catPill(category === cat)} onClick={() => setCategory(cat)}>{cat}</button>
              ))}
            </div>
          </>
        )}

        {/* 상품 그리드 */}
        {loading ? (
          <div style={s.loadingSpinner}>로딩 중...</div>
        ) : products.length === 0 && agentStatus !== 'running' ? (
          <div style={s.noResults}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
            <p style={{ fontSize: '16px', marginBottom: '8px' }}>
              {aiMode ? 'AI가 적합한 상품을 찾지 못했습니다. 다른 표현으로 검색해 보세요.' : '검색 결과가 없습니다'}
            </p>
            <Link href="/market/sell" style={{ color: '#4f46e5', fontSize: '14px' }}>상품 등록하기</Link>
          </div>
        ) : (
          <>
            <div style={s.grid}>
              {products.map((p, idx) => (
                <Link key={p.id} href={`/market/products/${p.id}`} style={{ ...s.card, animationDelay: `${idx * 0.05}s` }}>
                  <div style={s.cardTitle}>{p.title}</div>
                  <div style={s.cardDesc}>{p.description}</div>
                  <div style={s.cardPrice}>{p.price.toLocaleString()} {p.currency}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                    <VerifyBadge score={p.verifyScore} />
                    {p.stock !== undefined && p.stock <= 5 && p.stock > 0 && <span style={s.badge('#3d1a00', '#fb923c')}>재고 {p.stock}개</span>}
                    {p.stock === 0 && <span style={s.badge('#1c0000', '#f87171')}>품절</span>}
                    {p.aiScore !== undefined && p.aiScore >= 85 && <span style={s.badge('#1a2e1a', '#4ade80')}>🎯 정확</span>}
                  </div>
                  <div style={s.seller}>
                    {p.sellerName} · 구매 {p.buyCount}회
                    {p.avgRating > 0 && ` · ★ ${p.avgRating.toFixed(1)}`}
                  </div>
                  {p.aiReason && <div style={s.aiReason}>🤖 {p.aiReason}</div>}
                </Link>
              ))}
              {/* 스트리밍 중 로딩 카드 */}
              {agentStatus === 'running' && (
                <div style={{ ...s.card as object, background: '#0d1528', border: '1px dashed #2a3a6f', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '150px' } as React.CSSProperties}>
                  <div style={{ textAlign: 'center', color: '#4f70a8' }}>
                    <div style={{ fontSize: '24px', marginBottom: '8px', animation: 'pulse 1s infinite' }}>🤖</div>
                    <div style={{ fontSize: '12px' }}>상품 탐색 중...</div>
                  </div>
                </div>
              )}
            </div>

            {!aiMode && pages > 1 && (
              <div style={s.pagination}>
                {Array.from({ length: pages }, (_, i) => i + 1).map(p => (
                  <button key={p} style={s.pageBtn(page === p)} onClick={() => setPage(p)}>{p}</button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
