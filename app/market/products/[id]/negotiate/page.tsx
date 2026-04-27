'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface Product { id: string; title: string; price: number; currency: string; sellerName: string; stock: number }
interface Message {
  type: string;
  turn?: number;
  agent?: string;
  agentType?: string;
  content?: string;
  proposedPrice?: number;
  currency?: string;
  agreedPrice?: number;
  originalPrice?: number;
  discount?: number;
  message?: string;
  paymentReady?: boolean;
}

const agentColors: Record<string, string> = {
  buyer: '#4f46e5',
  seller: '#e54f4f',
  mediator: '#4fa84f',
};
const agentIcons: Record<string, string> = {
  buyer: '🛒',
  seller: '🏪',
  mediator: '⚖️',
};

const s = {
  page: { minHeight: '100vh', background: '#0a0a0a', color: '#e8e8e8', fontFamily: 'Arial, sans-serif' },
  nav: { background: '#111', borderBottom: '1px solid #222', padding: '0 24px', display: 'flex', alignItems: 'center', gap: '24px', height: '56px' },
  navBrand: { fontSize: '18px', fontWeight: 700, color: '#fff', textDecoration: 'none' } as React.CSSProperties,
  navLink: { color: '#aaa', fontSize: '14px', textDecoration: 'none' } as React.CSSProperties,
  container: { maxWidth: '900px', margin: '0 auto', padding: '32px 24px' },
  header: { background: '#111', border: '1px solid #222', borderRadius: '12px', padding: '24px', marginBottom: '24px' },
  title: { fontSize: '22px', fontWeight: 700, color: '#fff', marginBottom: '8px' },
  price: { fontSize: '28px', fontWeight: 800, color: '#4f46e5', marginBottom: '4px' },
  chatArea: { background: '#111', border: '1px solid #222', borderRadius: '12px', padding: '0', marginBottom: '24px', overflow: 'hidden' },
  chatHeader: { padding: '16px 24px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', gap: '8px' },
  chatBody: { height: '450px', overflowY: 'auto' as const, padding: '20px', display: 'flex', flexDirection: 'column' as const, gap: '16px' },
  msgWrapper: (agentType: string) => ({
    display: 'flex',
    justifyContent: agentType === 'buyer' ? 'flex-end' : 'flex-start',
    gap: '8px',
    alignItems: 'flex-start',
  } as React.CSSProperties),
  msgBubble: (agentType: string) => ({
    maxWidth: '70%',
    background: agentType === 'buyer' ? '#1e1b4b' : agentType === 'seller' ? '#1c0000' : '#0a2010',
    border: `1px solid ${agentColors[agentType] || '#333'}44`,
    borderRadius: agentType === 'buyer' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
    padding: '12px 16px',
  } as React.CSSProperties),
  msgAgent: (agentType: string) => ({ fontSize: '11px', color: agentColors[agentType] || '#888', fontWeight: 600, marginBottom: '4px' } as React.CSSProperties),
  msgContent: { fontSize: '14px', color: '#e8e8e8', lineHeight: 1.6 },
  priceTag: (agentType: string) => ({
    marginTop: '8px',
    padding: '6px 12px',
    background: agentColors[agentType] || '#333',
    borderRadius: '8px',
    fontSize: '15px',
    fontWeight: 700,
    color: '#fff',
    display: 'inline-block',
  } as React.CSSProperties),
  agreementBox: { background: '#0a2d0a', border: '1px solid #22c55e', borderRadius: '12px', padding: '24px', marginBottom: '24px', textAlign: 'center' as const },
  failBox: { background: '#2d0a0a', border: '1px solid #f87171', borderRadius: '12px', padding: '24px', marginBottom: '24px', textAlign: 'center' as const },
  startForm: { background: '#111', border: '1px solid #222', borderRadius: '12px', padding: '24px', marginBottom: '24px' },
  input: { width: '100%', padding: '12px', background: '#0a0a0a', border: '1px solid #333', borderRadius: '8px', color: '#fff', fontSize: '14px', marginBottom: '12px', boxSizing: 'border-box' as const },
  btnStart: { width: '100%', padding: '14px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '16px', fontWeight: 700, cursor: 'pointer' },
  btnBuy: { padding: '14px 32px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '16px', fontWeight: 700, cursor: 'pointer', marginTop: '16px' },
  progressBar: { background: '#1a1a1a', height: '4px', borderRadius: '2px', overflow: 'hidden', marginBottom: '16px' },
  progressFill: (pct: number) => ({ height: '100%', background: '#4f46e5', width: `${pct}%`, transition: 'width 0.5s' } as React.CSSProperties),
  turnBadge: { display: 'inline-block', padding: '2px 8px', background: '#1a1a2e', border: '1px solid #4f46e5', borderRadius: '12px', fontSize: '11px', color: '#818cf8', fontWeight: 600 },
  systemMsg: { textAlign: 'center' as const, color: '#555', fontSize: '12px', padding: '8px 0' },
};

export default function NegotiatePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [product, setProduct] = useState<Product | null>(null);
  const [targetPrice, setTargetPrice] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [negotiating, setNegotiating] = useState(false);
  const [result, setResult] = useState<Message | null>(null);
  const [currentTurn, setCurrentTurn] = useState(0);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/market/products/${id}`)
      .then(r => r.json())
      .then(d => {
        setProduct(d);
        setTargetPrice(Math.floor(d.price * 0.8).toString());
      })
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  async function startNegotiation() {
    if (!product || negotiating) return;
    setNegotiating(true);
    setMessages([]);
    setResult(null);
    setCurrentTurn(0);

    const tp = parseInt(targetPrice) || Math.floor(product.price * 0.8);

    try {
      const res = await fetch('/api/market/negotiation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, targetPrice: tp }),
      });

      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const json = line.replace(/^data:\s*/, '');
          try {
            const evt = JSON.parse(json) as Message;
            if (evt.type === 'session_start') {
              setMessages(prev => [...prev, evt]);
            } else if (evt.type === 'message') {
              if (evt.turn && evt.turn > currentTurn) setCurrentTurn(evt.turn);
              setMessages(prev => [...prev, evt]);
            } else if (evt.type === 'agreement' || evt.type === 'failed') {
              setResult(evt);
            } else if (evt.type === 'done') {
              setNegotiating(false);
            }
          } catch { /* skip */ }
        }
      }
    } catch (e) {
      console.error(e);
      setNegotiating(false);
    }
  }

  const progress = Math.min((currentTurn / 5) * 100, 100);

  if (!product) {
    return (
      <div style={s.page}>
        <p style={{ textAlign: 'center', padding: '100px', color: '#666' }}>로딩 중...</p>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <nav style={s.nav}>
        <Link href="/market" style={s.navBrand}>🏪 AI Market</Link>
        <Link href="/market/products" style={s.navLink}>상품</Link>
        <Link href={`/market/products/${id}`} style={s.navLink}>← 상품 상세</Link>
      </nav>

      <div style={s.container}>
        <div style={s.header}>
          <div style={{ fontSize: '13px', color: '#666', marginBottom: '8px' }}>AI 협상룸</div>
          <div style={s.title}>{product.title}</div>
          <div style={s.price}>{product.price.toLocaleString()} {product.currency}</div>
          <div style={{ fontSize: '13px', color: '#888' }}>판매자: {product.sellerName}</div>
        </div>

        {!negotiating && messages.length === 0 && !result && (
          <div style={s.startForm}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '16px' }}>
              🤝 AI 협상 시작
            </h2>
            <p style={{ fontSize: '13px', color: '#888', marginBottom: '16px', lineHeight: 1.6 }}>
              구매자·판매자·중개자 AI 에이전트가 최대 5턴 동안 실시간 가격 협상을 진행합니다.
              합의가 이루어지면 자동으로 결제 준비 상태로 진입합니다.
            </p>
            <label style={{ fontSize: '13px', color: '#aaa', display: 'block', marginBottom: '6px' }}>
              목표 구매 가격 ({product.currency})
            </label>
            <input
              style={s.input}
              type="number"
              value={targetPrice}
              onChange={e => setTargetPrice(e.target.value)}
              placeholder={`예: ${Math.floor(product.price * 0.8)}`}
            />
            <div style={{ fontSize: '12px', color: '#555', marginBottom: '16px' }}>
              정가의 80% = {(product.price * 0.8).toLocaleString()} {product.currency} | 판매자 최소가 ≈ {(product.price * 0.85).toLocaleString()} {product.currency}
            </div>
            <button style={s.btnStart} onClick={startNegotiation}>
              🚀 협상 시작
            </button>
          </div>
        )}

        {(negotiating || messages.length > 0) && (
          <div style={s.chatArea}>
            <div style={s.chatHeader}>
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>🤝 협상 진행 중</span>
              {negotiating && <span style={{ ...s.turnBadge, marginLeft: 'auto' }}>턴 {currentTurn}/5</span>}
            </div>

            {negotiating && (
              <div style={s.progressBar}>
                <div style={s.progressFill(progress)} />
              </div>
            )}

            <div style={s.chatBody} ref={chatRef}>
              {messages.map((msg, i) => {
                if (msg.type === 'session_start') {
                  return <div key={i} style={s.systemMsg}>{msg.message}</div>;
                }
                if (msg.type === 'message' && msg.agentType) {
                  return (
                    <div key={i} style={s.msgWrapper(msg.agentType)}>
                      {msg.agentType !== 'buyer' && (
                        <div style={{ fontSize: '20px', flexShrink: 0 }}>
                          {agentIcons[msg.agentType] || '🤖'}
                        </div>
                      )}
                      <div style={s.msgBubble(msg.agentType)}>
                        <div style={s.msgAgent(msg.agentType)}>
                          {agentIcons[msg.agentType]} {msg.agent}
                          {msg.turn && <span style={{ marginLeft: '8px', ...s.turnBadge }}>턴 {msg.turn}</span>}
                        </div>
                        <div style={s.msgContent}>{msg.content}</div>
                        {msg.proposedPrice != null && (
                          <div style={s.priceTag(msg.agentType)}>
                            💰 {msg.proposedPrice.toLocaleString()} {msg.currency}
                          </div>
                        )}
                      </div>
                      {msg.agentType === 'buyer' && (
                        <div style={{ fontSize: '20px', flexShrink: 0 }}>🛒</div>
                      )}
                    </div>
                  );
                }
                return null;
              })}

              {negotiating && (
                <div style={s.systemMsg}>
                  <span style={{ animation: 'pulse 1s infinite' }}>⏳ AI 에이전트가 협상 중...</span>
                </div>
              )}
            </div>
          </div>
        )}

        {result?.type === 'agreement' && (
          <div style={s.agreementBox}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>🎉</div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#4ade80', marginBottom: '8px' }}>
              협상 합의!
            </div>
            <div style={{ fontSize: '32px', fontWeight: 800, color: '#fff', marginBottom: '4px' }}>
              {result.agreedPrice?.toLocaleString()} {result.currency}
            </div>
            <div style={{ fontSize: '14px', color: '#888', marginBottom: '4px' }}>
              원가 {result.originalPrice?.toLocaleString()} → {result.discount}% 할인
            </div>
            <div style={{ fontSize: '14px', color: '#4ade80', marginBottom: '16px' }}>{result.message}</div>
            <button
              style={s.btnBuy}
              onClick={() => router.push(`/market/products/${id}`)}
            >
              ✅ 이 가격으로 구매하기
            </button>
          </div>
        )}

        {result?.type === 'failed' && (
          <div style={s.failBox}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>😔</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#f87171', marginBottom: '8px' }}>협상 결렬</div>
            <div style={{ fontSize: '14px', color: '#aaa', marginBottom: '16px' }}>{result.message}</div>
            <button style={{ ...s.btnStart, width: 'auto', padding: '10px 24px' }} onClick={startNegotiation}>
              🔄 다시 협상
            </button>
          </div>
        )}

        {result && (
          <div style={{ textAlign: 'center', marginTop: '16px' }}>
            <button
              style={{ background: 'transparent', border: '1px solid #333', color: '#888', padding: '8px 20px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
              onClick={() => { setMessages([]); setResult(null); setCurrentTurn(0); }}
            >
              새 협상 시작
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
