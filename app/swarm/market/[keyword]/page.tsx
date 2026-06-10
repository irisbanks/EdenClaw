'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface MarketEvent { type: string; detail?: string; price?: number; count?: number; botName?: string }
interface MarketSession { id: string; keyword: string; totalTransactions: number; totalRevenue: number; status: string }

export default function SwarmMarketPage() {
  const { keyword } = useParams<{ keyword: string }>();
  const decoded = decodeURIComponent(keyword);
  const [events, setEvents] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [sessions, setSessions] = useState<MarketSession[]>([]);
  const [buyerCount, setBuyerCount] = useState(100);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/swarm/stats`).then(r => r.json()).then(d => {
      setSessions((d.topMarkets || []) as MarketSession[]);
    }).catch(() => {});
  }, [decoded]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  async function triggerSearch() {
    if (running) return;
    setRunning(true);
    setEvents([]);

    const res = await fetch('/api/swarm/trigger-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: decoded, buyerCount }),
    });
    if (!res.body) { setRunning(false); return; }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        try {
          const evt: MarketEvent = JSON.parse(line.slice(5).trim());
          const icons: Record<string, string> = { market_open:'🏪', deal:'✅', negotiate:'💬', groupbuy:'👥', market_close:'🔒', done:'🎯', error:'❌' };
          const msg = `${icons[evt.type]||'•'} ${evt.detail || evt.type}${evt.price?` — ${evt.price.toLocaleString()} ET`:''}`;
          setEvents(p => [...p.slice(-300), msg]);
        } catch { /* skip */ }
      }
    }
    setRunning(false);
  }

  const s = {
    page: { minHeight: '100vh', background: '#050510', color: '#e0e0ff', fontFamily: 'monospace' },
    nav: { background: '#0a0a1a', borderBottom: '1px solid #1a1a3a', padding: '0 24px', display: 'flex', alignItems: 'center', gap: '16px', height: '52px' } as React.CSSProperties,
    container: { maxWidth: '1100px', margin: '0 auto', padding: '24px' },
    title: { fontSize: '26px', fontWeight: 800, color: '#fff', marginBottom: '4px' },
    card: { background: '#0a0a20', border: '1px solid #1a1a3a', borderRadius: '12px', padding: '20px', marginBottom: '16px' } as React.CSSProperties,
  };

  return (
    <div style={s.page}>
      <nav style={s.nav}>
        <Link href="/swarm" style={{ color: '#818cf8', textDecoration: 'none' }}>← 스웜 대시보드</Link>
        <span style={{ color: '#fff', fontWeight: 700 }}>🏪 "{decoded}" 시장</span>
      </nav>

      <div style={s.container}>
        <div style={s.title}>"{decoded}" 재래시장</div>
        <p style={{ color: '#666', fontSize: '13px', marginBottom: '24px' }}>봇이 검색어 "{decoded}" 발화 시 자동 형성되는 가상 시장</p>

        <div style={s.card}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: '#aaa' }}>구매봇 수:</span>
            <input type="number" value={buyerCount} onChange={e => setBuyerCount(parseInt(e.target.value)||50)}
              style={{ width: '80px', padding: '6px', background: '#050510', border: '1px solid #333', color: '#fff', borderRadius: '6px', fontSize: '13px' }} />
            <button onClick={triggerSearch} disabled={running}
              style={{ padding: '8px 20px', background: running ? '#333' : '#4f46e5', color: '#fff', border: 'none', borderRadius: '8px', cursor: running ? 'default' : 'pointer', fontWeight: 700, fontSize: '13px' }}>
              {running ? '⏳ 시장 운영 중...' : `▶ "${decoded}" 검색 발화 (${buyerCount}명)`}
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {/* 이벤트 로그 */}
          <div style={s.card}>
            <div style={{ fontWeight: 700, marginBottom: '12px', color: '#818cf8' }}>📡 시장 이벤트</div>
            <div ref={logRef} style={{ height: '400px', overflowY: 'auto', fontSize: '11px', lineHeight: 1.8 }}>
              {events.length === 0
                ? <div style={{ color: '#333', textAlign: 'center', paddingTop: '40px' }}>검색 발화를 트리거하세요</div>
                : events.map((e, i) => (
                  <div key={i} style={{ color: e.startsWith('✅') ? '#22c55e' : e.startsWith('❌') ? '#f87171' : '#aaa' }}>{e}</div>
                ))
              }
            </div>
          </div>

          {/* 통계 */}
          <div style={s.card}>
            <div style={{ fontWeight: 700, marginBottom: '12px', color: '#818cf8' }}>📊 시장 현황</div>
            <div style={{ fontSize: '13px', color: '#aaa', lineHeight: 2 }}>
              <div>검색어: <span style={{ color: '#fff' }}>{decoded}</span></div>
              <div>총 거래 이벤트: <span style={{ color: '#22c55e' }}>{events.filter(e => e.startsWith('✅')).length}건</span></div>
              <div>협상 이벤트: <span style={{ color: '#3b82f6' }}>{events.filter(e => e.startsWith('💬')).length}건</span></div>
            </div>
            <div style={{ marginTop: '20px' }}>
              <div style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>인기 시장 현황</div>
              {sessions.slice(0, 5).map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#aaa', borderBottom: '1px solid #111', paddingBottom: '4px', marginBottom: '4px' }}>
                  <span>{s.keyword}</span>
                  <span style={{ color: '#22c55e' }}>{s.totalTransactions}건</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
