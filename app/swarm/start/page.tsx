'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SwarmStartPage() {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error,    setError]    = useState('');

  async function handleStart() {
    setStarting(true);
    setError('');
    try {
      const res = await fetch('/api/swarm/start-day', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Redirect to live dashboard — simulation will stream there
      router.push('/swarm');
    } catch (e) {
      setError(`시작 실패: ${String(e)}`);
      setStarting(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#050510', color: '#e0e0ff',
      fontFamily: 'monospace', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: '32px',
    }}>
      {/* Logo / Title */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '56px', marginBottom: '8px' }}>🤖</div>
        <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 900, letterSpacing: '2px', color: '#818cf8' }}>
          SWARM 재래시장
        </h1>
        <p style={{ margin: '8px 0 0', color: '#444', fontSize: '13px' }}>
          500-Bot AI 전자상거래 생태계 — 하루 시뮬레이션
        </p>
      </div>

      {/* Spec cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 160px)', gap: '12px' }}>
        {[
          { icon: '🤖', label: '봇 수',     value: '500봇' },
          { icon: '🏪', label: '검색 파동', value: '30회' },
          { icon: '💬', label: '협상 턴',   value: '3턴/건' },
          { icon: '👥', label: '공동구매',  value: '20 라운드' },
          { icon: '🔗', label: '다단계',    value: '127노드' },
          { icon: '⚡', label: '동시 협상', value: '30건' },
        ].map(c => (
          <div key={c.label} style={{
            background: '#0d0d20', border: '1px solid #1a1a3a', borderRadius: '10px',
            padding: '14px', textAlign: 'center',
          }}>
            <div style={{ fontSize: '22px' }}>{c.icon}</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#818cf8', marginTop: '4px' }}>{c.value}</div>
            <div style={{ fontSize: '10px', color: '#444', marginTop: '2px' }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Start button */}
      <div style={{ textAlign: 'center' }}>
        <button
          onClick={handleStart}
          disabled={starting}
          style={{
            padding: '16px 48px', fontSize: '17px', fontWeight: 900,
            background: starting ? '#333' : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
            color: '#fff', border: 'none', borderRadius: '12px', cursor: starting ? 'not-allowed' : 'pointer',
            letterSpacing: '1px',
            boxShadow: starting ? 'none' : '0 0 32px #4f46e566',
            transition: 'all 0.2s',
          }}
        >
          {starting ? '⏳ 시뮬레이션 시작 중...' : '▶ START SIMULATION'}
        </button>
        {error && <div style={{ marginTop: '12px', color: '#f87171', fontSize: '12px' }}>{error}</div>}
        <p style={{ marginTop: '12px', color: '#333', fontSize: '11px' }}>
          약 15분 내외 소요 (압축 24시간 시뮬레이션)
        </p>
      </div>

      {/* Links */}
      <div style={{ display: 'flex', gap: '16px', fontSize: '12px' }}>
        <a href="/swarm"   style={{ color: '#555', textDecoration: 'none' }}>← 대시보드</a>
        <a href="/market"  style={{ color: '#555', textDecoration: 'none' }}>🏪 마켓</a>
      </div>
    </div>
  );
}
