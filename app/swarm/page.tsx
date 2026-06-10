'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';

type BotStatus = 'sleeping' | 'searching' | 'negotiating' | 'trading' | 'groupbuying';

interface SwarmEvent {
  type:     string;
  botId?:   string;
  botName?: string;
  keyword?: string;
  detail?:  string;
  price?:   number;
  count?:   number;
  stats?:   Record<string, unknown>;
  ts?:      number;
}

interface Stats {
  totalBots:    number;
  activeBots:   number;
  totalDeals:   number;
  totalRevenue: number;
  activeMarkets: number;
  groupBuys:    number;
  referrals:    number;
  topBots:      { id: string; name: string; earnings: number; deals: number }[];
  topMarkets:   { keyword: string; totalTransactions: number; totalRevenue: number }[];
}

const STATUS_COLORS: Record<BotStatus, string> = {
  sleeping:    '#1e1e2e',
  searching:   '#fbbf24',
  negotiating: '#3b82f6',
  trading:     '#22c55e',
  groupbuying: '#a855f7',
};

const TOTAL_BOTS = 5000;
const GRID_COLS  = 100;
const GRID_ROWS  = 50;
const DOT_SIZE   = 6;
const GAP        = 2;

export default function SwarmPage() {
  const [botStates, setBotStates]   = useState<BotStatus[]>(() => Array(TOTAL_BOTS).fill('sleeping'));
  const [botNames,  setBotNames]    = useState<string[]>(() => Array(TOTAL_BOTS).fill(''));
  const [events,    setEvents]      = useState<string[]>([]);
  const [running,   setRunning]     = useState(false);
  const [stats,     setStats]       = useState<Stats | null>(null);
  const [liveStats, setLiveStats]   = useState({ deals: 0, markets: 0, active: 0, revenue: 0 });
  const [keywords,  setKeywords]    = useState<Map<string, number>>(new Map());
  const [tooltip,   setTooltip]     = useState<{ idx: number; x: number; y: number } | null>(null);
  const eventsRef = useRef<HTMLDivElement>(null);
  const abortRef  = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch('/api/swarm/stats').then(r => r.json()).then((d: Stats) => {
      setStats(d);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (eventsRef.current) eventsRef.current.scrollTop = eventsRef.current.scrollHeight;
  }, [events]);

  const processEvent = useCallback((evt: SwarmEvent) => {
    if (evt.botId) {
      const raw = evt.botId.replace('sbot_', '');
      const idx  = parseInt(raw, 10);
      if (!isNaN(idx) && idx < TOTAL_BOTS) {
        const newStatus: BotStatus =
          evt.type === 'deal'      ? 'trading'     :
          evt.type === 'negotiate' ? 'negotiating' :
          evt.type === 'groupbuy'  ? 'groupbuying' :
          evt.type === 'search'    ? 'searching'   : 'sleeping';

        setBotStates(prev => {
          const next = [...prev]; next[idx] = newStatus; return next;
        });
        if (evt.botName) {
          setBotNames(prev => { const next = [...prev]; next[idx] = evt.botName!.split(' ')[0]; return next; });
        }
        if (newStatus !== 'sleeping') {
          setTimeout(() => {
            setBotStates(p => { const n = [...p]; n[idx] = 'sleeping'; return n; });
          }, 2500);
        }
      }
    }

    if (evt.type === 'deal') {
      setLiveStats(s => ({ ...s, deals: s.deals + 1, revenue: s.revenue + (evt.price || 0) }));
    }
    if (evt.type === 'market_open') {
      setLiveStats(s => ({ ...s, markets: s.markets + 1, active: s.active + (evt.count || 0) }));
      if (evt.keyword) setKeywords(prev => new Map(prev.set(evt.keyword!, (prev.get(evt.keyword!) || 0) + 1)));
    }

    const ICONS: Record<string, string> = {
      boot: '🌅', market_open: '🏪', deal: '✅', negotiate: '💬',
      groupbuy: '👥', refer: '🔗', market_close: '🔒', stats: '📊',
      done: '🎉', error: '❌',
    };
    const msg = `${ICONS[evt.type] || '•'} ${evt.detail || evt.type}${evt.price ? ` (${evt.price.toLocaleString()} ET)` : ''}`;
    setEvents(prev => [...prev.slice(-400), msg]);

    if (evt.type === 'done') {
      fetch('/api/swarm/stats').then(r => r.json()).then((d: Stats) => setStats(d)).catch(() => {});
    }
  }, []);

  const startSimulation = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setEvents([]);
    setLiveStats({ deals: 0, markets: 0, active: 0, revenue: 0 });
    setKeywords(new Map());
    abortRef.current = new AbortController();

    try {
      const res = await fetch('/api/swarm/start-day', { method: 'POST', signal: abortRef.current.signal });
      if (!res.body) { setRunning(false); return; }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const chunks = buf.split('\n\n');
        buf = chunks.pop() || '';
        for (const chunk of chunks) {
          if (!chunk.startsWith('data:')) continue;
          try { processEvent(JSON.parse(chunk.slice(5).trim()) as SwarmEvent); } catch { /* skip */ }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setEvents(prev => [...prev, '❌ 연결 오류 — 재시도 필요']);
      }
    } finally {
      setRunning(false);
    }
  }, [running, processEvent]);

  const stopSimulation = () => { abortRef.current?.abort(); setRunning(false); };

  const topKeywords = [...keywords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  const cellW = DOT_SIZE + GAP;
  const svgW  = GRID_COLS * cellW;
  const svgH  = GRID_ROWS * cellW;

  return (
    <div style={{ minHeight: '100vh', background: '#050510', color: '#e0e0ff', fontFamily: 'monospace' }}>
      {/* Nav */}
      <nav style={{ background: '#0a0a1a', borderBottom: '1px solid #1a1a3a', padding: '0 24px', display: 'flex', alignItems: 'center', gap: '24px', height: '52px' }}>
        <Link href="/market" style={{ color: '#818cf8', textDecoration: 'none', fontWeight: 700 }}>🏪 AI Market</Link>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: '15px' }}>🤖 Swarm 재래시장 — 500봇</span>
        <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#555' }}>AI Multi-Agent 전자상거래 생태계</span>
      </nav>

      {/* Stats bar */}
      <div style={{ background: '#0a0a20', borderBottom: '1px solid #1a1a3a', padding: '12px 24px', display: 'flex', gap: '28px', flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { label: '총 봇',    value: (stats?.totalBots || TOTAL_BOTS).toLocaleString(), color: '#818cf8' },
          { label: '활성 봇',  value: liveStats.active.toLocaleString(),                 color: '#fbbf24' },
          { label: '오늘 거래', value: liveStats.deals.toLocaleString(),                  color: '#22c55e' },
          { label: '형성 시장', value: liveStats.markets.toLocaleString(),                color: '#3b82f6' },
          { label: '공동구매', value: (stats?.groupBuys || 0).toLocaleString(),           color: '#a855f7' },
          { label: '총 수익',  value: `${liveStats.revenue.toLocaleString()} ET`,         color: '#f59e0b' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ textAlign: 'center', minWidth: '70px' }}>
            <div style={{ fontSize: '18px', fontWeight: 800, color }}>{value}</div>
            <div style={{ fontSize: '10px', color: '#555' }}>{label}</div>
          </div>
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={running ? stopSimulation : startSimulation}
            style={{ padding: '8px 22px', borderRadius: '8px', border: 'none', cursor: 'pointer',
              background: running ? '#dc2626' : '#4f46e5', color: '#fff', fontWeight: 700, fontSize: '13px',
              boxShadow: running ? '0 0 12px #dc262666' : '0 0 12px #4f46e566' }}
          >
            {running ? '⏹ 중지' : '▶ 하루 시뮬레이션 시작'}
          </button>
          <Link href="/swarm/start"
            style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #333', color: '#aaa', textDecoration: 'none', fontSize: '12px' }}>
            전체 화면 →
          </Link>
        </div>
      </div>

      <div style={{ display: 'flex', height: 'calc(100vh - 142px)' }}>
        {/* Grid */}
        <div style={{ flex: 1, padding: '16px', overflow: 'hidden', position: 'relative' }}>
          {/* Legend */}
          <div style={{ fontSize: '11px', color: '#555', marginBottom: '10px', display: 'flex', gap: '16px' }}>
            {Object.entries(STATUS_COLORS).map(([s, c]) => (
              <span key={s} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: c, borderRadius: '2px' }} />
                {s}
              </span>
            ))}
          </div>

          {/* SVG Bot Grid */}
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <svg width={svgW} height={svgH} style={{ display: 'block', cursor: 'crosshair' }}>
              {botStates.map((status, i) => {
                const col = i % GRID_COLS;
                const row = Math.floor(i / GRID_COLS);
                const x   = col * cellW;
                const y   = row * cellW;
                return (
                  <g key={i}
                    onMouseEnter={e => setTooltip({ idx: i, x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => setTooltip(null)}
                  >
                    <rect
                      x={x} y={y} width={DOT_SIZE} height={DOT_SIZE}
                      rx={2}
                      fill={STATUS_COLORS[status]}
                      opacity={status === 'sleeping' ? 0.35 : 1}
                      style={{ transition: 'fill 0.3s, opacity 0.3s' }}
                    />
                    {status !== 'sleeping' && (
                      <rect x={x} y={y} width={DOT_SIZE} height={DOT_SIZE} rx={2}
                        fill="none" stroke={STATUS_COLORS[status]} strokeWidth={1.5} opacity={0.6} />
                    )}
                  </g>
                );
              })}
            </svg>

            {/* Tooltip */}
            {tooltip !== null && (
              <div style={{
                position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 30,
                background: '#1a1a3a', border: '1px solid #333', borderRadius: '6px',
                padding: '4px 10px', fontSize: '11px', color: '#ddd', pointerEvents: 'none', zIndex: 999,
                whiteSpace: 'nowrap',
              }}>
                <span style={{ color: '#818cf8' }}>sbot_{String(tooltip.idx).padStart(4, '0')}</span>
                {botNames[tooltip.idx] ? <span style={{ marginLeft: 6, color: '#aaa' }}>{botNames[tooltip.idx]}</span> : null}
                <span style={{ marginLeft: 6, color: STATUS_COLORS[botStates[tooltip.idx]] }}>● {botStates[tooltip.idx]}</span>
              </div>
            )}
          </div>

          {/* Popular keywords */}
          {topKeywords.length > 0 && (
            <div style={{ marginTop: '12px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', color: '#555' }}>🔥 활성 시장:</span>
              {topKeywords.map(([kw, cnt]) => (
                <Link key={kw} href={`/swarm/market/${kw}`}
                  style={{ padding: '2px 10px', background: '#12122a', border: '1px solid #2a2a4a', borderRadius: '12px', fontSize: '11px', color: '#818cf8', textDecoration: 'none' }}>
                  {kw} <span style={{ color: '#555' }}>({cnt})</span>
                </Link>
              ))}
            </div>
          )}

          {/* Top markets from stats */}
          {stats?.topMarkets && stats.topMarkets.length > 0 && (
            <div style={{ marginTop: '12px' }}>
              <div style={{ fontSize: '11px', color: '#555', marginBottom: '4px' }}>📊 시장 순위</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {stats.topMarkets.slice(0, 5).map(m => (
                  <div key={m.keyword} style={{ background: '#0d0d20', border: '1px solid #1a1a3a', borderRadius: '6px', padding: '4px 10px', fontSize: '11px' }}>
                    <span style={{ color: '#818cf8' }}>{m.keyword}</span>
                    <span style={{ color: '#22c55e', marginLeft: 6 }}>{m.totalTransactions}건</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Event stream panel */}
        <div style={{ width: '340px', background: '#080818', borderLeft: '1px solid #1a1a3a', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #1a1a3a', fontSize: '12px', fontWeight: 700, color: '#818cf8', display: 'flex', alignItems: 'center', gap: '8px' }}>
            📡 실시간 이벤트
            {running && <span style={{ fontSize: '10px', color: '#fbbf24', animation: 'pulse 1s infinite' }}>● LIVE</span>}
          </div>
          <div ref={eventsRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', fontSize: '11px', lineHeight: 1.75 }}>
            {events.length === 0 ? (
              <div style={{ color: '#2a2a4a', textAlign: 'center', marginTop: '60px', lineHeight: 2 }}>
                ▶ 시뮬레이션을 시작하면<br />실시간 이벤트가 여기 표시됩니다
              </div>
            ) : (
              events.map((e, i) => (
                <div key={i} style={{
                  color: e.startsWith('✅') ? '#22c55e' : e.startsWith('❌') ? '#f87171' :
                         e.startsWith('🎉') ? '#fbbf24' : e.startsWith('🏪') ? '#818cf8' :
                         e.startsWith('👥') ? '#a855f7' : '#666',
                  marginBottom: '1px',
                }}>
                  {e}
                </div>
              ))
            )}
          </div>

          {/* Top bots panel */}
          {stats?.topBots && stats.topBots.length > 0 && (
            <div style={{ borderTop: '1px solid #1a1a3a', padding: '10px 12px', maxHeight: '160px', overflowY: 'auto' }}>
              <div style={{ fontSize: '11px', color: '#555', marginBottom: '6px' }}>🏆 수익 Top 봇</div>
              {stats.topBots.slice(0, 8).map((b, i) => (
                <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#888', marginBottom: '3px' }}>
                  <span style={{ color: i === 0 ? '#fbbf24' : '#888' }}>{i + 1}. {b.name}</span>
                  <span style={{ color: '#22c55e' }}>{b.earnings.toLocaleString()} ET</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>
    </div>
  );
}
