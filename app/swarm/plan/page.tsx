'use client';

// 대화형 기획 → 자동 빌드 핸드오프 페이지
// 1) 질문하면 답하고  2) 대화로 기획서(spec)가 누적되고  3) ready 되면 OMX 자율 빌드로 넘긴다.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface PlanSpec {
  title?: string;
  summary?: string;
  decisions?: Record<string, string>;
  requirements?: string[];
  open_questions?: string[];
  deliverables?: string[];
}
type ChatTurn = { role: 'user' | 'ai'; text: string; provider?: string };
interface PlanResponse { answer: string; spec: PlanSpec; ready: boolean; questions: string[]; provider: string }

export default function PlanPage() {
  const [email, setEmail] = useState('');
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [spec, setSpec] = useState<PlanSpec>({});
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [build, setBuild] = useState<{ jobId: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('edenclaw-email') : '';
    if (saved) setEmail(saved);
  }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [chat, busy]);

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setInput(''); setError(''); setBuild(null);
    const history = chat.map((t) => ({ role: t.role === 'ai' ? 'assistant' : 'user', content: t.text }));
    setChat((c) => [...c, { role: 'user', text: message }]);
    setBusy(true);
    try {
      const r = await fetch('/api/plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, message, spec }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? `기획 실패 (${r.status})`); setChat((c) => c.slice(0, -1)); return; }
      const res = d as PlanResponse;
      setChat((c) => [...c, { role: 'ai', text: res.answer, provider: res.provider }]);
      setSpec(res.spec ?? {});
      setReady(Boolean(res.ready));
    } catch (e) {
      setError(e instanceof Error ? e.message : '네트워크 오류');
      setChat((c) => c.slice(0, -1));
    } finally { setBusy(false); }
  }

  async function startBuild() {
    if (busy) return;
    if (email.trim()) window.localStorage.setItem('edenclaw-email', email.trim());
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ async: true, spec, userId: email.trim() || undefined }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? `빌드 시작 실패 (${r.status})`); return; }
      setBuild({ jobId: d.jobId });
    } catch (e) {
      setError(e instanceof Error ? e.message : '네트워크 오류');
    } finally { setBusy(false); }
  }

  const specEmpty = !spec.title && !spec.summary && !(spec.requirements?.length) && !(spec.decisions && Object.keys(spec.decisions).length);

  return (
    <main className="grid h-[calc(100dvh-46px)] grid-cols-1 overflow-hidden bg-slate-950 text-slate-100 lg:grid-cols-[1fr_minmax(320px,40%)]">
      {/* ── 좌: 대화 ── */}
      <section className="flex min-h-0 flex-col border-r border-slate-800">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 p-3">
          <h1 className="text-sm font-bold text-white">🧭 기획 대화 → 자동 개발</h1>
          <Link href="/swarm/autonomous" className="text-[11px] text-sky-400 hover:underline">자율 루프 관제탑 →</Link>
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {chat.length === 0 && (
            <p className="text-xs text-slate-600">질문을 입력하세요. 예: &ldquo;스마트폰에서 300W급 근적외선 LED를 제어하려면 어떻게 해야 하지?&rdquo;<br />답변과 함께 우측에 기획서가 점점 채워지고, 충분히 확정되면 자동 개발을 시작할 수 있습니다.</p>
          )}
          {chat.map((t, i) => t.role === 'user' ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-lg border border-sky-800/50 bg-sky-950/30 px-3 py-1.5 text-xs text-sky-100"><span className="mr-1 font-bold text-sky-400">YOU</span>{t.text}</div>
          ) : (
            <div key={i} className="max-w-[92%] rounded-lg border border-emerald-800/50 bg-emerald-950/20 px-3 py-2 text-xs">
              <div className="mb-0.5 font-semibold text-emerald-400">기획 아키텍트{t.provider ? ` · ${t.provider}` : ''}</div>
              <div className="whitespace-pre-wrap leading-relaxed text-slate-200">{t.text}</div>
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-[11px] text-sky-300"><span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />생성 중…</div>}
        </div>
        {error && <div className="shrink-0 border-t border-red-900 bg-red-950/40 px-3 py-1.5 text-xs text-red-300">{error}</div>}
        <div className="shrink-0 border-t border-slate-800 p-3">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} disabled={busy}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(); }}
            placeholder="질문/요구사항 입력 (⌘/Ctrl+Enter)"
            className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none disabled:opacity-60" />
          <button onClick={() => void send()} disabled={busy || !input.trim()} className="mt-1.5 w-full rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-50">전송 ▷</button>
        </div>
      </section>

      {/* ── 우: 기획서(spec) + 빌드 핸드오프 ── */}
      <section className="flex min-h-0 flex-col bg-[#0b1020]">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-3 py-2 text-xs">
          <span className="font-semibold text-slate-300">📋 기획서 (spec)</span>
          <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${ready ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300'}`}>{ready ? '개발 준비 완료' : '수립 중'}</span>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-xs">
          {specEmpty ? <p className="text-slate-600">대화가 시작되면 기획서가 여기에 누적됩니다.</p> : (
            <>
              {spec.title && <div><div className="text-[10px] uppercase text-slate-500">제목</div><div className="font-semibold text-white">{spec.title}</div></div>}
              {spec.summary && <div><div className="text-[10px] uppercase text-slate-500">개요</div><div className="text-slate-300">{spec.summary}</div></div>}
              {spec.decisions && Object.keys(spec.decisions).length > 0 && (
                <div><div className="text-[10px] uppercase text-slate-500">결정사항</div>
                  <ul className="mt-0.5 space-y-0.5">{Object.entries(spec.decisions).map(([k, v]) => <li key={k} className="text-slate-300"><span className="text-emerald-400">{k}</span>: {v}</li>)}</ul>
                </div>
              )}
              {spec.requirements?.length ? (
                <div><div className="text-[10px] uppercase text-slate-500">요구사항</div>
                  <ul className="mt-0.5 list-disc pl-4 text-slate-300">{spec.requirements.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
              ) : null}
              {spec.deliverables?.length ? (
                <div><div className="text-[10px] uppercase text-slate-500">산출물</div>
                  <ul className="mt-0.5 list-disc pl-4 text-slate-300">{spec.deliverables.map((d, i) => <li key={i} className="font-mono">{d}</li>)}</ul></div>
              ) : null}
              {spec.open_questions?.length ? (
                <div><div className="text-[10px] uppercase text-amber-500">미결정 (답하면 채워짐)</div>
                  <ul className="mt-0.5 list-disc pl-4 text-amber-300/90">{spec.open_questions.map((q, i) => <li key={i}>{q}</li>)}</ul></div>
              ) : null}
            </>
          )}
        </div>
        <div className="shrink-0 space-y-2 border-t border-slate-800 p-3">
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="email (빌드 가스 미터링용, 선택)"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none" />
          {build ? (
            <div className="rounded-lg border border-emerald-700 bg-emerald-950/30 px-3 py-2 text-[11px] text-emerald-300">
              🚀 자동 개발 시작됨 — <span className="font-mono">{build.jobId}</span><br />
              <Link href="/swarm/autonomous" className="text-sky-400 underline">관제탑에서 진행 보기 →</Link>
            </div>
          ) : (
            <button onClick={() => void startBuild()} disabled={busy || specEmpty}
              className={`w-full rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50 ${ready ? 'animate-pulse bg-gradient-to-r from-emerald-500 to-sky-500 text-slate-950' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`}>
              🚀 이 기획서로 자동 개발 시작{!ready && ' (미완성 상태로도 가능)'}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
