'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface GroupBuy {
  id: string; title: string; description: string;
  discountRate: number; basePrice: number; discountedPrice: number;
  targetCount: number; currentCount: number; deadline: string; status: string;
  progressRate: number; remainingHours: number; savingsAmount: number;
  participantCount: number; orderCount: number;
  product: { id: string; title: string; description: string; price: number; currency: string; sellerName: string; verifyScore: number; images: string };
  participants: Array<{ id: string; name: string; joinedAt: string }>;
}

const s = {
  page: { minHeight: '100vh', background: '#0a0a0a', color: '#e8e8e8', fontFamily: 'Arial, sans-serif' },
  nav: { background: '#111', borderBottom: '1px solid #222', padding: '0 24px', display: 'flex', alignItems: 'center', gap: '24px', height: '56px' },
  navBrand: { fontSize: '18px', fontWeight: 700, color: '#fff', textDecoration: 'none' } as React.CSSProperties,
  navLink: { color: '#aaa', fontSize: '14px', textDecoration: 'none' } as React.CSSProperties,
  navSell: { marginLeft: 'auto', background: '#4f46e5', color: '#fff', padding: '8px 16px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, textDecoration: 'none' } as React.CSSProperties,
  container: { maxWidth: '900px', margin: '0 auto', padding: '32px 24px' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 320px', gap: '28px' } as React.CSSProperties,
  section: { background: '#111', border: '1px solid #222', borderRadius: '12px', padding: '24px', marginBottom: '20px' },
  badge: (bg: string, color: string) => ({ display: 'inline-block', padding: '4px 12px', borderRadius: '20px', fontSize: '13px', fontWeight: 600, background: bg, color }),
  progressBar: { height: '12px', background: '#1a1a1a', borderRadius: '6px', overflow: 'hidden', margin: '12px 0' },
  progressFill: (pct: number, success: boolean) => ({
    height: '100%', borderRadius: '6px', transition: 'width 0.8s ease',
    width: `${Math.min(pct, 100)}%`,
    background: success ? '#22c55e' : pct >= 75 ? '#f59e0b' : '#4f46e5',
  }),
  btnJoin: { width: '100%', padding: '16px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '16px', fontWeight: 700, cursor: 'pointer', marginBottom: '12px' },
  inputRow: { marginBottom: '12px' },
  label: { fontSize: '12px', color: '#888', marginBottom: '4px', display: 'block' },
  input: { width: '100%', padding: '10px 12px', background: '#0a0a0a', border: '1px solid #333', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box' as const },
  participant: { display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #1a1a1a', fontSize: '13px' },
};

export default function GroupBuyDetail() {
  const { id } = useParams<{ id: string }>();
  const [gb, setGb] = useState<GroupBuy | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [joinMsg, setJoinMsg] = useState('');
  const [joinError, setJoinError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (!id) return;
    fetch(`/api/market/group-buy/${id}`)
      .then(r => r.json())
      .then(d => { setGb(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  async function joinGroupBuy() {
    if (!gb) return;
    setJoining(true);
    setJoinError('');

    const res = await fetch(`/api/market/group-buy/${id}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || '익명', email }),
    });
    const data = await res.json();

    if (res.ok) {
      setJoined(true);
      setJoinMsg(data.message);
      setGb(prev => prev ? {
        ...prev,
        currentCount: data.currentCount,
        progressRate: data.progressRate,
        status: data.reachedTarget ? 'success' : prev.status,
        participants: [{ id: data.participant.id, name: name || '익명', joinedAt: new Date().toISOString() }, ...prev.participants],
      } : prev);
    } else {
      setJoinError(data.error || '참여 중 오류가 발생했습니다');
    }
    setJoining(false);
  }

  if (loading) return (
    <div style={s.page}>
      <p style={{ color: '#666', textAlign: 'center', padding: '100px' }}>로딩 중...</p>
    </div>
  );
  if (!gb) return (
    <div style={s.page}>
      <p style={{ color: '#f87171', textAlign: 'center', padding: '100px' }}>공동구매를 찾을 수 없습니다.</p>
    </div>
  );

  const pct = Math.round((gb.currentCount / gb.targetCount) * 100);
  const isOpen = gb.status === 'open';
  const isSuccess = gb.status === 'success';

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
        <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Link href="/market/group-buy" style={{ color: '#666', fontSize: '13px', textDecoration: 'none' }}>← 공동구매 목록</Link>
          <span style={s.badge(isSuccess ? '#14532d' : isOpen ? '#0f172a' : '#1c0000', isSuccess ? '#4ade80' : isOpen ? '#60a5fa' : '#f87171')}>
            {isSuccess ? '🎉 달성 완료' : isOpen ? '⚡ 진행 중' : '마감'}
          </span>
        </div>

        <div style={s.grid}>
          {/* Left */}
          <div>
            <div style={s.section}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                <Link href={`/market/products/${gb.product?.id}`} style={{ color: '#818cf8', textDecoration: 'none' }}>
                  {gb.product?.title}
                </Link>
              </div>
              <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#fff', marginBottom: '16px', lineHeight: 1.4 }}>{gb.title}</h1>

              {gb.description && (
                <p style={{ fontSize: '14px', color: '#aaa', lineHeight: 1.7, marginBottom: '16px' }}>{gb.description}</p>
              )}

              <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '20px' }}>
                <span style={{ fontSize: '32px', fontWeight: 800, color: '#60a5fa' }}>{gb.discountedPrice.toLocaleString()}원</span>
                <span style={{ fontSize: '16px', color: '#555', textDecoration: 'line-through' }}>{gb.basePrice.toLocaleString()}원</span>
                <span style={s.badge('#4f46e5', '#fff')}>-{gb.discountRate}%</span>
              </div>

              <div style={{ fontSize: '14px', color: '#22c55e', fontWeight: 600, marginBottom: '16px' }}>
                💰 {gb.savingsAmount.toLocaleString()}원 절약
              </div>

              <div style={s.progressBar}>
                <div style={s.progressFill(pct, isSuccess)} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#aaa', marginBottom: '8px' }}>
                <span><strong style={{ color: '#fff', fontSize: '18px' }}>{gb.currentCount}</strong>/{gb.targetCount}명 참여</span>
                <span style={{ fontWeight: 600, color: pct >= 100 ? '#22c55e' : '#fff' }}>{pct}%</span>
              </div>

              <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: '#666' }}>
                {isOpen ? (
                  <span>⏰ {gb.remainingHours}시간 남음</span>
                ) : (
                  <span>마감: {new Date(gb.deadline).toLocaleDateString('ko-KR')}</span>
                )}
                <span>목표: {gb.targetCount - gb.currentCount}명 더 필요</span>
              </div>
            </div>

            {/* Participants list */}
            <div style={s.section}>
              <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '16px' }}>
                👥 참여자 ({gb.participantCount}명)
              </h2>
              {gb.participants.length === 0 ? (
                <p style={{ color: '#555', fontSize: '14px' }}>아직 참여자가 없습니다. 첫 번째로 참여해보세요!</p>
              ) : (
                <div>
                  {gb.participants.slice(0, 10).map((p, i) => (
                    <div key={p.id} style={s.participant}>
                      <span style={{ color: i === 0 ? '#fbbf24' : '#aaa' }}>
                        {i === 0 ? '👑 ' : ''}{p.name}
                      </span>
                      <span style={{ color: '#555' }}>{new Date(p.joinedAt).toLocaleDateString('ko-KR')}</span>
                    </div>
                  ))}
                  {gb.participantCount > 10 && (
                    <p style={{ color: '#555', fontSize: '12px', marginTop: '8px' }}>
                      외 {gb.participantCount - 10}명 더...
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right: join box */}
          <div>
            <div style={{ ...s.section, position: 'sticky', top: '24px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '20px' }}>
                {isOpen ? '⚡ 공동구매 참여' : isSuccess ? '🎉 목표 달성!' : '⛔ 마감된 공동구매'}
              </h2>

              {isSuccess && (
                <div style={{ background: '#14532d', borderRadius: '8px', padding: '12px', marginBottom: '16px', textAlign: 'center', color: '#4ade80', fontSize: '14px', fontWeight: 600 }}>
                  🎉 목표 인원을 달성했습니다!<br/>
                  <span style={{ fontSize: '12px', fontWeight: 400 }}>{gb.discountRate}% 할인이 확정되었습니다</span>
                </div>
              )}

              {isOpen && !joined && (
                <>
                  <div style={s.inputRow}>
                    <label style={s.label}>이름 (선택)</label>
                    <input style={s.input} value={name} onChange={e => setName(e.target.value)} placeholder="익명" />
                  </div>
                  <div style={s.inputRow}>
                    <label style={s.label}>이메일 (선택)</label>
                    <input style={s.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="알림 수신용 이메일" />
                  </div>

                  {joinError && (
                    <div style={{ background: '#1c0000', border: '1px solid #7f1d1d', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: '#f87171', marginBottom: '12px' }}>
                      {joinError}
                    </div>
                  )}

                  <button style={s.btnJoin} onClick={joinGroupBuy} disabled={joining}>
                    {joining ? '처리 중...' : `참여하기 (${gb.discountedPrice.toLocaleString()}원)`}
                  </button>
                </>
              )}

              {joined && (
                <div style={{ background: '#14532d', borderRadius: '8px', padding: '16px', textAlign: 'center', color: '#4ade80', fontWeight: 600, marginBottom: '12px' }}>
                  ✅ 참여 완료!<br/>
                  <span style={{ fontSize: '13px', fontWeight: 400 }}>{joinMsg}</span>
                </div>
              )}

              <div style={{ background: '#0a0a0a', borderRadius: '8px', padding: '14px', fontSize: '13px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ color: '#666' }}>정가</span>
                  <span style={{ color: '#aaa' }}>{gb.basePrice.toLocaleString()}원</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ color: '#666' }}>할인율</span>
                  <span style={{ color: '#4ade80' }}>-{gb.discountRate}%</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #222', paddingTop: '8px' }}>
                  <span style={{ color: '#fff', fontWeight: 600 }}>공동구매가</span>
                  <span style={{ color: '#60a5fa', fontWeight: 700, fontSize: '16px' }}>{gb.discountedPrice.toLocaleString()}원</span>
                </div>
              </div>

              <div style={{ marginTop: '16px', fontSize: '12px', color: '#555', lineHeight: 1.6 }}>
                * 목표 인원 달성 시 할인이 자동 확정됩니다<br/>
                * 마감 기한: {new Date(gb.deadline).toLocaleDateString('ko-KR')}
              </div>

              <div style={{ marginTop: '16px' }}>
                <Link href={`/market/products/${gb.product?.id}`} style={{ color: '#818cf8', fontSize: '13px', textDecoration: 'none' }}>
                  상품 상세 보기 →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
