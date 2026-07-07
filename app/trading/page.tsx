'use client';

import { Component, Fragment, useRef, useState, type ReactNode } from 'react';
import { useUser, type Quota } from '@/components/UserProvider';

// 코드 캔버스 렌더 크래시 방어 (가상 소스 파싱/렌더 중 에러가 페이지 전체를 죽이지 않도록)
class CanvasErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { err: string }> {
  state = { err: '' };
  static getDerivedStateFromError(e: unknown) { return { err: e instanceof Error ? e.message : String(e) }; }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: '' });
  }
  render() {
    if (this.state.err) return <div className="p-4 font-mono text-xs text-red-400">⚠ 코드 캔버스 렌더 오류가 방어되었습니다 (페이지는 정상): {this.state.err}</div>;
    return this.props.children;
  }
}

type DevLog = { id: number; kind: 'start' | 'done' | 'retry' | 'emergency' | 'query' | 'you'; agent: string; stage: number; text: string; tokens: number; ms: number; at: string; provider?: string; tier?: 'free' | 'premium' | 'compute' };
type Chat = { id: number; role: 'user' | 'ai'; text: string; tokens?: number; model?: string };
type SandFile = { path: string; content: string; status: 'pending' | 'ok' | 'fail'; error?: string; engine?: string };
type Mode = 'solo' | 'swarm';

const STAGES = [
  { key: 'Thinking', label: '기획', icon: '🧠', active: 'border-violet-400 text-violet-200 shadow-[0_0_18px_rgba(167,139,250,0.8)] ring-1 ring-violet-400', dot: 'bg-violet-400' },
  { key: 'Context', label: '컨텍스트', icon: '🔭', active: 'border-fuchsia-400 text-fuchsia-200 shadow-[0_0_18px_rgba(232,121,249,0.85)] ring-1 ring-fuchsia-400', dot: 'bg-fuchsia-400' },
  { key: 'Coding', label: '개발', icon: '⌨️', active: 'border-sky-400 text-sky-200 shadow-[0_0_18px_rgba(56,189,248,0.8)] ring-1 ring-sky-400', dot: 'bg-sky-400' },
  { key: 'Build/Test', label: '검증', icon: '🧪', active: 'border-amber-400 text-amber-200 shadow-[0_0_18px_rgba(251,191,36,0.8)] ring-1 ring-amber-400', dot: 'bg-amber-400' },
  { key: 'Deploy', label: '배포', icon: '🚀', active: 'border-emerald-400 text-emerald-200 shadow-[0_0_18px_rgba(52,211,153,0.8)] ring-1 ring-emerald-400', dot: 'bg-emerald-400' },
];

type StreamEvent = Record<string, unknown> & { type?: 'init' | 'stage' | 'done' | 'error' | string; status?: string };

function eventText(v: unknown, fallback = '') {
  try {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (v == null) return fallback;
    return JSON.stringify(v) ?? fallback;
  } catch {
    return fallback;
  }
}

function eventNumber(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function cleanFilePath(v: unknown) {
  const path = eventText(v, 'generated.md').replace(/[\0\r\n]/g, '').trim();
  return (path || 'generated.md').slice(0, 180);
}

function canvasFallback(error: unknown) {
  return error instanceof Error ? error.message : eventText(error, '알 수 없는 렌더 오류');
}

function isDraftLikePrompt(v: string) {
  const s = ` ${v.toLowerCase()} `;
  return [
    '기획', '브레인스토밍', '아이디어', '설계', '와이어프레임', '스펙', '사양', '아키텍처', '구조', '뼈대',
    '파일 트리', '파일트리', '초안', 'draft', 'ideation', 'brainstorm', 'wireframe', 'architecture', 'spec',
    'pebble', '페블', '폼팩터', 'on-device', '온디바이스', 'npu', '하드웨어',
  ].some((k) => s.includes(k));
}

function providerBadge(provider?: string) {
  if (!provider) return null;
  const isGemma = provider === 'Gemma 31B Private Engine' || provider.includes('Gemma 31B');
  return {
    label: isGemma ? 'Gemma 31B' : provider,
    className: isGemma ? 'bg-green-500 text-white' : 'bg-blue-500 text-white',
  };
}

export default function DevLoopPage() {
  const { email, quota, loading, error, loadUser, registerUser, setQuota } = useUser();
  const [inputEmail, setInputEmail] = useState('');
  const [inputName, setInputName] = useState('');
  const [mode, setMode] = useState<Mode>('swarm');
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<DevLog[]>([]);
  const [chat, setChat] = useState<Chat[]>([]);
  const [stage, setStage] = useState(-1);
  const [activeAgent, setActiveAgent] = useState('');
  const [code, setCode] = useState('');
  const [files, setFiles] = useState<SandFile[]>([]);
  const [selected, setSelected] = useState('');
  const [paused, setPaused] = useState(false);
  const [pausedPhase, setPausedPhase] = useState<'env' | 'build' | ''>('');
  const [masterMode, setMasterMode] = useState(false);
  const [charged, setCharged] = useState(false);
  const [input, setInput] = useState('');
  const [localError, setLocalError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const logId = useRef(0);
  const streamId = useRef(0); // 현재 스트리밍 중인 AI 버블 id
  const abortRef = useRef<AbortController | null>(null);
  const lastPrompt = useRef('');
  const priorCode = useRef('');
  const priorError = useRef('');

  function pushLog(l: Omit<DevLog, 'id' | 'at'>) {
    setLogs((prev) => [{ ...l, id: ++logId.current, at: new Date().toLocaleTimeString() }, ...prev].slice(0, 80));
  }

  function updateStreamingBubble(updater: (m: Chat) => Chat) {
    let id = streamId.current;
    if (!id) {
      id = ++logId.current;
      streamId.current = id;
    }
    setChat((prev) => {
      const seeded = prev.some((m) => m.id === id) ? prev : [{ id, role: 'ai' as const, text: '', model: '스트리밍…' }, ...prev].slice(0, 60);
      return seeded.map((m) => (m.id === id ? updater(m) : m));
    });
  }

  function appendStreamingDelta(delta: unknown) {
    const text = eventText(delta);
    if (!text) return;
    updateStreamingBubble((m) => ({ ...m, text: `${m.text}${text}` }));
  }

  function upsertCanvasFile(ev: StreamEvent) {
    try {
      const path = cleanFilePath(ev.path);
      const content = eventText(ev.content);
      setFiles((prev) => {
        try {
          const next = prev.filter((f) => cleanFilePath(f.path) !== path);
          return [...next, { path, content, status: 'pending' as const }].slice(-80);
        } catch {
          return [{ path, content, status: 'pending' as const }];
        }
      });
      setSelected((s) => s || path);
    } catch (e) {
      setLocalError(`파일 캔버스 이벤트 방어: ${canvasFallback(e)}`);
    }
  }

  function updateSandboxResult(ev: StreamEvent) {
    const path = cleanFilePath(ev.path);
    const ok = Boolean(ev.ok);
    const engine = eventText(ev.engine);
    const errorText = eventText(ev.error);
    setFiles((prev) => {
      try {
        return prev.map((f) => cleanFilePath(f.path) === path ? { ...f, path, status: ok ? 'ok' : 'fail', error: errorText, engine } : f);
      } catch {
        return prev;
      }
    });
    pushLog({ kind: ok ? 'retry' : 'emergency', agent: 'Sandbox', stage: 3, text: `${ok ? '✅' : '❌'} build ${path} [${engine}]${ok ? '' : ` — ${errorText}`}`, tokens: 0, ms: 0 });
  }

  function pauseForUser(ev: StreamEvent) {
    priorCode.current = eventText(ev.code);
    priorError.current = eventText(ev.errorLog);
    setPausedPhase((ev.phase === 'env' ? 'env' : 'build'));
    setPaused(true);
    pushLog({ kind: 'query', agent: ev.phase === 'env' ? '🤖 환경 검증' : 'EdenClaw Swarm', stage: eventNumber(ev.stage, 3), text: eventText(ev.question), tokens: 0, ms: 0 });
  }

  function finishStage(ev: StreamEvent, runMode: Mode) {
    const stg = eventNumber(ev.stage, -1);
    const content = eventText(ev.content);
    if ((stg === 2 || ev.tier === 'premium') && content) setCode(content);
    if (runMode === 'swarm') {
      pushLog({
        kind: 'done',
        agent: eventText(ev.agent, 'Agent'),
        stage: stg,
        text: content,
        tokens: eventNumber(ev.tokens),
        ms: eventNumber(ev.ms),
        provider: eventText(ev.provider),
        tier: (ev.tier as 'free' | 'premium' | 'compute') ?? 'compute',
      });
      return;
    }
    updateStreamingBubble((m) => ({
      ...m,
      text: m.text || content,
      tokens: eventNumber(ev.tokens),
      model: eventText(ev.provider, m.model || '완료'),
    }));
  }

  function handleStageEvent(ev: StreamEvent, runMode: Mode) {
    const status = eventText(ev.status, 'done');
    const stg = eventNumber(ev.stage, -1);
    if (status === 'start' || status === 'ideation' || status === 'premium_computation') {
      setStage(stg);
      setActiveAgent(eventText(ev.agent));
      if (runMode === 'swarm') pushLog({ kind: 'start', agent: eventText(ev.agent, 'Agent'), stage: stg, text: eventText(ev.note, status === 'ideation' ? '무료 기획 중...' : status === 'premium_computation' ? '프리미엄 연산 중...' : '실행 중...'), tokens: 0, ms: 0 });
      else updateStreamingBubble((m) => ({ ...m, model: '스트리밍…' }));
      return;
    }
    if (status === 'paywall_blocked') {
      setStage(stg);
      setActiveAgent(eventText(ev.agent, 'Gas Gateway'));
      pushLog({ kind: 'emergency', agent: eventText(ev.agent, 'Gas Gateway'), stage: stg, text: eventText(ev.note, eventText(ev.error, '가스 게이트에서 실행이 일시 중단되었습니다.')), tokens: 0, ms: 0 });
      return;
    }
    if (status === 'chunk') { appendStreamingDelta(ev.delta ?? ev.content); return; }
    if (status === 'file') { upsertCanvasFile(ev); return; }
    if (status === 'sandbox') { updateSandboxResult(ev); return; }
    if (status === 'retry') { pushLog({ kind: 'retry', agent: eventText(ev.agent, 'Kimi AI'), stage: 2, text: eventText(ev.msg), tokens: 0, ms: 0 }); return; }
    if (status === 'emergency') {
      setMasterMode(true);
      pushLog({ kind: 'emergency', agent: eventText(ev.agent, 'B200 Master'), stage: 2, text: eventText(ev.msg), tokens: 0, ms: 0 });
      return;
    }
    if (status === 'paused_awaiting_user') { pauseForUser(ev); return; }
    finishStage(ev, runMode);
  }

  function handleEvent(ev: StreamEvent, runMode: Mode) {
    try {
      const type = eventText(ev.type);
      if (type === 'init') return;
      if (type === 'stage') { handleStageEvent(ev, runMode); return; }
      // 이전 배포의 이벤트도 잠깐 공존할 수 있게 받아준다.
      if (type === 'chunk') { appendStreamingDelta(ev.delta ?? ev.content); return; }
      if (type === 'file') { upsertCanvasFile(ev); return; }
      if (type === 'sandbox') { updateSandboxResult(ev); return; }
      if (type === 'retry') { pushLog({ kind: 'retry', agent: eventText(ev.agent, 'Kimi AI'), stage: 2, text: eventText(ev.msg), tokens: 0, ms: 0 }); return; }
      if (type === 'emergency') { setMasterMode(true); pushLog({ kind: 'emergency', agent: eventText(ev.agent, 'B200 Master'), stage: 2, text: eventText(ev.msg), tokens: 0, ms: 0 }); return; }
      if (type === 'paused_awaiting_user') { pauseForUser(ev); return; }
      if (type === 'done') {
        if (ev.quota) setQuota(ev.quota as Quota);
        if (ev.code) setCode(eventText(ev.code));
        setStage(-1); setActiveAgent(''); setMasterMode(false); setPaused(false);
        priorCode.current = ''; priorError.current = '';
        if (Boolean(ev.freeRun)) setNotice(`✓ 완료 — 실연산 0ms, 가스 0 차감`);
        else { setCharged(true); setTimeout(() => setCharged(false), 1400); setNotice(`🚀 배포 완료 · B200 실연산 ${eventNumber(ev.computeMs).toLocaleString()}ms → 가스 ${eventNumber(ev.gasCharged).toLocaleString()} 원자 차감 (토큰량 무관)`); }
        return;
      }
      if (type === 'error') {
        const msg = eventText(ev.error, '스트리밍 오류');
        setLocalError(msg);
        if (ev.quota) setQuota(ev.quota as Quota);
        updateStreamingBubble((m) => ({ ...m, text: m.text || msg, model: eventText(ev.status, '오류') }));
      }
    } catch (e) {
      setLocalError(`스트림 이벤트 처리 오류: ${canvasFallback(e)}`);
    }
  }

  async function execute(opts: { resume?: boolean; escalate?: boolean; guidance?: string; newPrompt?: string }) {
    if (!email || running) return;
    const runMode = mode;
    if (opts.newPrompt) {
      lastPrompt.current = opts.newPrompt;
      if (runMode === 'swarm') { setLogs([]); setCode(''); setFiles([]); setSelected(''); }
      if (runMode === 'solo') {
        const userId = ++logId.current;
        const aiId = ++logId.current;
        streamId.current = aiId;
        setChat((c) => [
          { id: aiId, role: 'ai' as const, text: '', model: '스트리밍 대기…' },
          { id: userId, role: 'user' as const, text: opts.newPrompt! },
          ...c,
        ].slice(0, 60));
      } else {
        streamId.current = 0;
      }
    }
    if (!lastPrompt.current.trim()) return;
    setRunning(true); setLocalError(''); setNotice(''); setStage(-1); setActiveAgent(''); setMasterMode(false); setPaused(false);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    try {
      const res = await fetch('/api/swarm/execute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({
          email, mode: runMode, prompt: lastPrompt.current,
          resume: !!opts.resume, escalate: !!opts.escalate,
          currentFiles: files.map((f) => ({ path: f.path, content: f.content })),
          priorCode: priorCode.current, errorLog: priorError.current, guidance: opts.guidance ?? '',
        }),
      });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); setLocalError(j.error ?? `실행 실패 (${res.status})`); return; }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      const processLine = (line: string) => {
        const raw = line.trim();
        if (!raw) return;
        try {
          handleEvent(JSON.parse(raw) as StreamEvent, runMode);
        } catch (e) {
          setLocalError(`스트림 파싱 오류: ${canvasFallback(e)}`);
        }
      };
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const ln of lines) processLine(ln);
      }
      if (buf.trim()) processLine(buf);
    } catch (e) { if ((e as Error).name !== 'AbortError') setLocalError(e instanceof Error ? e.message : '네트워크 오류'); }
    finally { setRunning(false); setActiveAgent(''); setStage(-1); abortRef.current = null; }
  }

  function submit() {
    const v = input.trim(); if (!v) return; setInput('');
    if (paused) { pushLog({ kind: 'you', agent: 'YOU', stage: 3, text: v, tokens: 0, ms: 0 }); void execute({ resume: true, guidance: v }); }
    else void execute({ newPrompt: v });
  }
  function escalateMaster() {
    const v = input.trim(); setInput('');
    pushLog({ kind: 'you', agent: 'YOU', stage: 2, text: `🚨 마스터에게 위임${v ? `: ${v}` : ''}`, tokens: 0, ms: 0 });
    void execute({ escalate: true, guidance: v });
  }
  function stopRun() { abortRef.current?.abort(); }

  async function ledgerAction(action: 'overdraft' | 'reset') {
    if (!email) return;
    setBusy(true); setLocalError(''); setNotice('');
    try {
      const res = await fetch('/api/trading/quota', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, action }) });
      const json = await res.json();
      // 409(이미 선지급) 등 락다운도 데모 세션에선 200 DEMO_NOTICE 로 내려와 빨간 에러 없이 안내된다.
      if (!res.ok) {
        // 데모가 아닌 일반 락다운: 충전 실패는 에러가 아니라 안내성 notice 로 부드럽게 처리(시연 중단 방지).
        const msg = json.error ?? '충전을 진행할 수 없습니다.';
        if (json.code === 'ALREADY_ADVANCED') { if (json.quota) setQuota(json.quota); setNotice(`ℹ️ ${msg}`); }
        else setLocalError(msg);
        return;
      }
      setQuota(json);
      if (action === 'reset') { setLogs([]); setChat([]); setCode(''); setFiles([]); setSelected(''); setPaused(false); return; }
      if (json.mode === 'DEMO_NOTICE') { setNotice(`ℹ️ ${json.message ?? '데모 세션 — 게스트 샌드박스로 진행됩니다.'}`); return; }
      setCharged(true); setTimeout(() => setCharged(false), 1400);
      const swapped = Number(json.swapped) || 0;
      setNotice(`${json.mode === 'REAL_SWAP' ? '⚡ 원장 스왑' : '⚡ 선지급'} → 가스 ${swapped.toLocaleString()} 충전`);
    } finally { setBusy(false); }
  }

  // 미로그인
  if (!email || !quota) {
    return (
      <main className="flex min-h-[calc(100dvh-46px)] items-center justify-center bg-slate-950 px-4 text-slate-100">
        <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h1 className="mb-1 text-xl font-bold text-white">AI 개발 관제탑</h1>
          <p className="mb-4 text-sm text-slate-400">이메일로 조회/가입하면 인터랙티브 개발 루프가 열립니다.</p>
          <div className="flex flex-col gap-2">
            <input value={inputEmail} onChange={(e) => setInputEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadUser(inputEmail)} type="email" placeholder="email" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none" />
            <input value={inputName} onChange={(e) => setInputName(e.target.value)} placeholder="이름(가입 시)" className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none" />
            <div className="flex gap-2">
              <button onClick={() => loadUser(inputEmail)} disabled={loading} className="flex-1 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">조회</button>
              <button onClick={() => registerUser(inputEmail, inputName)} disabled={loading} className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">가입</button>
            </div>
          </div>
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        </div>
      </main>
    );
  }

  const remainPct = Math.max(0, 100 - quota.percentUsed);
  const barColor = remainPct > 50 ? 'bg-emerald-500' : remainPct > 20 ? 'bg-amber-500' : 'bg-red-500';
  const lg = quota.ledger;
  const canSubmitPrompt = input.trim().length > 0;

  return (
    <main className="grid h-[calc(100dvh-46px)] grid-cols-1 overflow-hidden bg-slate-950 text-slate-100 lg:grid-cols-[2fr_3fr]">
      {/* ===== 좌측 40%: 컨트롤 / 대화 / 역질문 콘솔 ===== */}
      <section className="flex min-h-0 flex-col border-r border-slate-800">
        {/* 헤더 + 모드 + 게이지 */}
        <div className="shrink-0 border-b border-slate-800 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h1 className="text-sm font-bold text-white">AI 인터랙티브 개발 루프 허브</h1>
            <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5 text-xs">
              {(['solo', 'swarm'] as const).map((m) => (
                <button key={m} onClick={() => { if (!running) setMode(m); }} disabled={running}
                  className={`rounded px-2 py-1 ${mode === m ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'} disabled:opacity-60`}>
                  {m === 'solo' ? '단독' : 'Swarm'}
                </button>
              ))}
            </div>
          </div>
          <div className={`rounded-lg border bg-slate-900 p-2 transition-all ${charged ? 'border-emerald-500 shadow-[0_0_18px_rgba(52,211,153,0.5)]' : 'border-slate-800'}`}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">잔여 가스 <b className="text-white tabular-nums">{quota.remaining.toLocaleString()}</b></span>
              <span className="text-slate-500">소진 {quota.consumed.toLocaleString()} · {quota.percentUsed.toFixed(1)}%</span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-800"><div className={`h-full ${barColor} transition-[width] duration-700`} style={{ width: `${remainPct}%` }} /></div>
          </div>
          {/* 파이프라인 스테퍼 (Swarm) */}
          {mode === 'swarm' && (
            <div className="mt-2 flex items-center">
              {STAGES.map((s, i) => (
                <Fragment key={s.key}>
                  <div className={`flex flex-1 flex-col items-center rounded-md border py-1 text-center transition-all ${running && i === stage ? `${s.active} animate-pulse` : 'border-slate-800 text-slate-600'}`}>
                    <span className="text-sm">{s.icon}</span><span className="text-[9px]">{s.label}</span>
                  </div>
                  {i < STAGES.length - 1 && <div className={`h-0.5 w-1.5 ${running && i < stage ? s.dot : 'bg-slate-700'}`} />}
                </Fragment>
              ))}
            </div>
          )}
        </div>

        {notice && <div className="shrink-0 border-b border-emerald-900 bg-emerald-950/40 px-3 py-1.5 text-xs text-emerald-300">{notice}</div>}
        {localError && <div className="shrink-0 border-b border-red-900 bg-red-950/40 px-3 py-1.5 text-xs text-red-300">{localError}</div>}

        {/* 콘솔 (스크롤) */}
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
          {mode === 'solo' ? (
            chat.length === 0 ? <p className="text-xs text-slate-600">질문을 입력하면 수석 아키텍트가 답합니다.</p> :
            chat.map((m) => m.role === 'user' ? (
              <div key={m.id} className="rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-xs"><span className="mr-1 font-bold text-sky-400">YOU</span>{m.text}</div>
            ) : (
              <div key={m.id} className="rounded-lg border border-emerald-800/50 bg-emerald-950/20 px-2.5 py-1.5 text-xs">
                <div className="mb-0.5 flex justify-between"><span className="font-semibold text-emerald-400">AI · {m.model}</span><span className="text-amber-400">{(m.tokens ?? 0).toLocaleString()} tok</span></div>
                <div className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-200">{m.text}</div>
              </div>
            ))
          ) : (
            logs.length === 0 ? <p className="text-xs text-slate-600">작업을 입력하고 ▶ 실행하면 단계별 실황이 중계됩니다.</p> :
            logs.map((l) => l.kind === 'query' ? (
              <div key={l.id} className="rounded-lg border-2 border-amber-500 bg-amber-950/40 px-3 py-2 text-xs text-amber-200 shadow-[0_0_16px_rgba(251,191,36,0.5)]"><div className="mb-0.5 font-bold text-amber-300">🤖 에이전트 긴급 질의 — 일시정지</div>{l.text}</div>
            ) : l.kind === 'you' ? (
              <div key={l.id} className="rounded-lg border border-sky-700 bg-sky-950/30 px-2.5 py-1.5 text-xs text-sky-200"><span className="mr-1 font-bold">YOU ▶</span>{l.text}</div>
            ) : l.kind === 'emergency' ? (
              <div key={l.id} className="rounded-lg border border-red-500 bg-red-950/40 px-2.5 py-1.5 text-xs font-bold text-red-300 shadow-[0_0_14px_rgba(248,113,113,0.6)] animate-pulse">{l.text}</div>
            ) : l.kind === 'retry' ? (
              <div key={l.id} className="flex items-center gap-1.5 rounded-lg border border-emerald-800/50 bg-emerald-950/20 px-2.5 py-1 text-[11px] text-emerald-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />{l.text}</div>
            ) : l.kind === 'start' ? (
              <div key={l.id} className="flex items-center gap-1.5 px-1 text-[11px]"><span className={`h-1.5 w-1.5 animate-pulse rounded-full ${STAGES[l.stage]?.dot ?? 'bg-slate-400'}`} /><span className="font-semibold text-sky-300">{STAGES[l.stage]?.icon} {l.agent}</span><span className="italic text-slate-500">{l.text}</span></div>
            ) : (
              (() => {
                const badge = providerBadge(l.provider);
                return (
                  <div key={l.id} className={`rounded-lg border px-2.5 py-1.5 ${l.tier === 'premium' ? 'border-red-700/60 bg-red-950/20' : 'border-slate-800 bg-slate-800/30'}`}>
                    <div className="mb-0.5 flex flex-wrap items-center justify-between gap-1 text-[11px]">
                      <span className="font-semibold text-sky-300">{STAGES[l.stage]?.icon ?? '⚡'} {STAGES[l.stage]?.key ?? l.agent}</span>
                      <span className="flex items-center gap-1">
                        <span className={`rounded px-1 py-px text-[9px] font-semibold ${l.tier === 'premium' ? 'bg-red-500/20 text-red-300' : 'bg-cyan-500/15 text-cyan-300'}`}>{l.ms ? `${l.ms.toLocaleString()}ms` : '—'}</span>
                        {badge && <span className={`rounded px-2 py-0.5 text-[9px] font-semibold ${badge.className}`}>{badge.label}</span>}
                      </span>
                    </div>
                    <div className="line-clamp-4 whitespace-pre-wrap font-mono text-[11px] leading-snug text-slate-300">{l.text}</div>
                  </div>
                );
              })()
            ))
          )}
        </div>

        {/* Overdraft (가스 0일 때) */}
        {quota.depleted && (
          <div className="shrink-0 border-t border-amber-800 bg-amber-950/30 p-2 text-xs">
            <div className="mb-1 flex items-center justify-between text-amber-300"><span>⛽ 가스 고갈 (스왑가능 {(lg?.swappableGas ?? 0).toLocaleString()})</span></div>
            <button onClick={() => ledgerAction('overdraft')} disabled={busy} className="w-full animate-pulse rounded-md bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1.5 font-bold text-slate-950 disabled:opacity-60">⚡ Overdraft 가스 충전</button>
          </div>
        )}

        {/* 입력 바 — 일반 프롬프트 / 일시정지 시 답변 */}
        <div className="shrink-0 border-t border-slate-800 p-3">
          {running && (
            <div className="mb-1.5 flex items-center gap-2 rounded-md border border-sky-600/50 bg-sky-950/40 px-2.5 py-1.5 text-[11px] font-medium text-sky-300">
              <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
              🤖 에덴클로 수석 아키텍트가 답변을 생성 중입니다... {activeAgent && <span className="text-slate-400">({activeAgent})</span>}
            </div>
          )}
          {paused && <div className="mb-1.5 rounded-md border border-amber-600/50 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-300">{pausedPhase === 'env' ? '⏸ 🤖 환경 검증 대기 — 하드웨어/에뮬레이터·보드·핀·언어를 답하면 그 환경으로 자동 진행합니다.' : '⏸ 일시정지 — 가이드를 답하면 멈춘 지점부터 자동 재개됩니다.'}</div>}
          <textarea value={input} onChange={(e) => setInput(e.target.value)} disabled={running}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
            rows={2} placeholder={paused ? 'AI 질문에 대한 가이드/답변 입력 (⌘/Ctrl+Enter)' : mode === 'swarm' ? '개발 작업 요청 (⌘/Ctrl+Enter)' : '수석 아키텍트에게 질문 (⌘/Ctrl+Enter)'}
            className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none disabled:opacity-60" />
          <div className="mt-1.5 flex gap-2">
            {running ? (
              <button onClick={stopRun} className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500">■ 정지</button>
            ) : (
              <button onClick={submit} disabled={!canSubmitPrompt} className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{paused ? '↻ 답변·자동 재개' : mode === 'swarm' ? '▶ 실행' : '전송 ▷'}</button>
            )}
            {paused && !running && <button onClick={escalateMaster} disabled={quota.depleted} className="rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-2 text-sm font-bold text-slate-950 hover:from-amber-400 disabled:opacity-50">🚨 마스터 위임</button>}
            <button onClick={() => ledgerAction('reset')} disabled={busy || running} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50">↺</button>
          </div>
        </div>
      </section>

      {/* ===== 우측 60%: 실제 파일트리 + IDE 캔버스 (가상 샌드박스 컴파일) ===== */}
      <CanvasErrorBoundary resetKey={`${selected}:${files.length}:${running ? 'running' : 'idle'}`}>
      <section className={`grid min-h-0 grid-cols-[minmax(140px,30%)_1fr] bg-[#0b1020] transition-all ${masterMode ? 'shadow-[inset_0_0_40px_rgba(248,113,113,0.35)]' : ''}`}>
        {/* 파일 트리 */}
        <div className="flex min-h-0 flex-col border-r border-slate-800">
          <div className="shrink-0 border-b border-slate-800 px-3 py-2 text-xs font-semibold text-slate-400">📁 프로젝트 ({files.length})</div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {files.length === 0 ? <p className="px-2 py-3 text-[11px] text-slate-600">실행하면 생성된 파일이 여기에 실재로 나타납니다.</p> :
              files.map((f) => (
                <button key={cleanFilePath(f.path)} onClick={() => setSelected(cleanFilePath(f.path))}
                  className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] ${selected === cleanFilePath(f.path) ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800/50'}`}>
                  <span>{f.status === 'ok' ? '✅' : f.status === 'fail' ? '❌' : '📄'}</span>
                  <span className="truncate font-mono">{cleanFilePath(f.path)}</span>
                </button>
              ))}
          </div>
        </div>
        {/* 코드 뷰어 */}
        <div className="flex min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-3 py-2 text-xs">
            <span className="font-mono text-slate-300">{selected || '— 파일 선택 —'}</span>
            <span className="flex items-center gap-2">
              {running && <span className="flex items-center gap-1 text-emerald-400"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />{activeAgent || '실행'}…</span>}
              {(() => { const sel = files.find((f) => cleanFilePath(f.path) === selected); return sel?.status === 'fail' ? <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-300">❌ {eventText(sel.engine)}</span> : sel?.status === 'ok' ? <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">✅ {eventText(sel.engine)}</span> : null; })()}
            </span>
          </div>
          {(() => {
            try {
              const sel = files.find((f) => cleanFilePath(f.path) === selected);
              if (!sel) return <pre className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-xs leading-relaxed text-slate-500">{'// 좌측에서 작업을 실행하면 실제 파일이 생성되고\n// 백엔드 가상 샌드박스에서 build/compile이 수행됩니다.\n//\n// JS/JSX → Node V8 (vm), TS/TSX → tsc, JSON → parse (실 컴파일)\n// 그 외(파이썬 등) → 정적 휴리스틱 (정직 표기)\n//\n// 하드웨어 요청 시 코딩 전 [🤖 환경 검증]에서 일시정지하고\n// 답변하면 그 환경에 맞춰 자동 재개합니다.'}</pre>;
              return (
                <>
                  {sel.status === 'fail' && <div className="shrink-0 border-b border-red-900 bg-red-950/40 px-3 py-1.5 font-mono text-[11px] text-red-300">build error: {eventText(sel.error)}</div>}
                  <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-xs leading-relaxed text-slate-200">{eventText(sel.content)}</pre>
                </>
              );
            } catch (e) {
              return <div className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-xs text-red-300">코드 캔버스 렌더 오류 방어: {canvasFallback(e)}</div>;
            }
          })()}
        </div>
      </section>
      </CanvasErrorBoundary>
    </main>
  );
}
