'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJson } from '@/lib/fetch-json';

interface Msg { role: 'user' | 'assistant' | 'system'; text: string; locked?: boolean; checkoutUrl?: string }
interface Quota { remaining: number; allocated: number; percentUsed: number }

const fmt = (n: number) => n.toLocaleString('ko-KR');

export default function FloatingChatWidget({ userId, refreshMs = 5000 }: { userId: string; refreshMs?: number }) {
  const [open, setOpen] = useState(false);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: 'assistant', text: '안녕하세요! 에덴클로 AI 비서입니다. 무엇을 도와드릴까요?' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadQuota = useCallback(async () => {
    try {
      const { ok, data } = await fetchJson<{ quota: Quota }>(
        `/api/office/${encodeURIComponent(userId)}`,
        { cache: 'no-store' }
      );
      if (ok && data) setQuota(data.quota);
    } catch { /* ignore */ }
  }, [userId]);

  useEffect(() => {
    loadQuota();
    const t = setInterval(loadQuota, refreshMs);
    return () => clearInterval(t);
  }, [loadQuota, refreshMs]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      const { ok, status, data } = await fetchJson<{
        message?: string; checkoutUrl?: string; error?: string; response?: string;
      }>('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, message: text }),
      });
      if (status === 402) {
        setMsgs((m) => [...m, { role: 'system', text: data?.message || '토큰이 고갈되었습니다.', locked: true, checkoutUrl: data?.checkoutUrl }]);
      } else if (!ok) {
        setMsgs((m) => [...m, { role: 'system', text: `⚠ 오류: ${data?.error || status}` }]);
      } else {
        setMsgs((m) => [...m, { role: 'assistant', text: data?.response || '(응답 없음)' }]);
      }
    } catch {
      setMsgs((m) => [...m, { role: 'system', text: '⚠ 네트워크 오류' }]);
    } finally {
      setBusy(false);
      loadQuota();
    }
  };

  const pct = quota ? (quota.allocated > 0 ? (quota.remaining / quota.allocated) * 100 : 0) : 100;
  const barColor = pct < 10 ? 'bg-red-500' : pct < 30 ? 'bg-amber-400' : 'bg-emerald-400';

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end">
      {open && (
        <div className="mb-3 flex h-[460px] w-[340px] flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
          {/* 헤더 + 쿼터 바 */}
          <div className="border-b border-slate-700 bg-slate-800 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-white">🤖 에덴클로 AI</span>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="mt-2">
              <div className="mb-1 flex justify-between text-[11px] text-slate-400">
                <span>토큰 잔액</span>
                <span>{quota ? `${fmt(quota.remaining)} / ${fmt(quota.allocated)}` : '…'}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700">
                <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>

          {/* 메시지 */}
          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  m.role === 'user' ? 'bg-sky-600 text-white'
                  : m.locked ? 'bg-red-500/15 text-red-200 border border-red-500/30'
                  : m.role === 'system' ? 'bg-slate-700 text-slate-300'
                  : 'bg-slate-800 text-slate-100 border border-slate-700'
                }`}>
                  <div className="whitespace-pre-wrap">{m.text}</div>
                  {m.locked && m.checkoutUrl && (
                    <a href={m.checkoutUrl} className="mt-2 block rounded-lg bg-emerald-500 px-3 py-1.5 text-center text-xs font-semibold text-white hover:bg-emerald-600">
                      💳 토큰 충전하러 가기
                    </a>
                  )}
                </div>
              </div>
            ))}
            {busy && <div className="text-xs text-slate-500">에덴클로가 입력 중…</div>}
          </div>

          {/* 입력 */}
          <div className="flex gap-2 border-t border-slate-700 p-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="메시지를 입력하세요…"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
            />
            <button onClick={send} disabled={busy} className="rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
              전송
            </button>
          </div>
        </div>
      )}

      {/* 플로팅 토글 버튼 */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-2xl shadow-2xl transition hover:scale-105"
        aria-label="AI 채팅 열기"
      >
        {open ? '✕' : '💬'}
        {!open && quota && pct < 10 && (
          <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-slate-900 bg-red-500" />
        )}
      </button>
    </div>
  );
}
