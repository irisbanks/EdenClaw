'use client';

// P3: 자율 루프 전용 고도화 대시보드 (잡 기반 — 60초 한계 무관, 밤샘 진행 추적)
// - POST /api/swarm/jobs 로 enqueue → GET /api/swarm/jobs/[id]?since= 로 증분 폴링
// - 모델별 시도 타임라인 + 실제 tsc 진단 로그 + 파일트리/뷰어 + 실행 히스토리 + 가스 분해
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type GenFile = { path: string; content: string };
type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

interface SwarmJob {
  id: string;
  email: string;
  prompt: string;
  maxAttempts: number;
  status: JobStatus;
  attempts: number;
  gasCharged: number;
  finalProvider?: string;
  error?: string;
  files: GenFile[];
  createdAt: string;
  updatedAt: string;
}

type LoopEvent =
  | { type: 'attempt_start'; attempt: number; tier: string; label: string }
  | { type: 'generated'; attempt: number; tier: string; provider: string; files: number }
  | { type: 'file'; attempt: number; path: string; content: string }
  | { type: 'compile'; attempt: number; ok: boolean; output: string; ms: number }
  | { type: 'escalate'; from: string; to: string; reason: string }
  | { type: 'provider_error'; attempt: number; tier: string; error: string }
  | { type: 'success'; attempt: number; tier: string; provider: string; files?: GenFile[]; gasCharged: number }
  | { type: 'promoted'; attempt: number; tier: string; targetFile: string }
  | { type: 'exhausted'; attempts: number; lastError: string; gasCharged: number };

interface JobEventRecord { seq: number; at: string; event: LoopEvent }

const STATUS_STYLE: Record<JobStatus, string> = {
  queued: 'bg-slate-600 text-slate-100',
  running: 'bg-sky-600 text-white animate-pulse',
  succeeded: 'bg-emerald-600 text-white',
  failed: 'bg-red-600 text-white',
};

export default function AutonomousDashboard() {
  const [email, setEmail] = useState('');
  const [prompt, setPrompt] = useState('');
  const [maxAttempts, setMaxAttempts] = useState(5);
  const [jobId, setJobId] = useState('');
  const [job, setJob] = useState<SwarmJob | null>(null);
  const [events, setEvents] = useState<JobEventRecord[]>([]);
  const [history, setHistory] = useState<SwarmJob[]>([]);
  const [selected, setSelected] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const pollRef = useRef<number | null>(null);
  const cursorRef = useRef(0);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('edenclaw-email') : '';
    if (saved) setEmail(saved);
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch('/api/swarm/jobs');
      if (r.ok) { const d = (await r.json()) as { jobs: SwarmJob[] }; setHistory(d.jobs ?? []); }
    } catch { /* 무시 */ }
  }, []);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const stopPoll = useCallback(() => {
    if (pollRef.current !== null) { window.clearTimeout(pollRef.current); pollRef.current = null; }
  }, []);

  const poll = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/swarm/jobs/${id}?since=${cursorRef.current}`);
      if (r.ok) {
        const d = (await r.json()) as { job: SwarmJob; events: JobEventRecord[]; cursor: number };
        setJob(d.job);
        if (d.events.length) {
          setEvents((prev) => [...prev, ...d.events]);
          cursorRef.current = d.cursor;
          const lastFile = [...d.events].reverse().find((e) => e.event.type === 'file');
          if (lastFile && lastFile.event.type === 'file') {
            const p = lastFile.event.path;
            setSelected((s) => s || p);
          }
        }
        if (d.job.status === 'succeeded' || d.job.status === 'failed') {
          setRunning(false);
          if (d.job.files.length && !selected) setSelected(d.job.files[0].path);
          void loadHistory();
          return;
        }
      }
    } catch { /* 폴링 오류는 다음 틱에서 재시도 */ }
    pollRef.current = window.setTimeout(() => { void poll(id); }, 1500);
  }, [loadHistory, selected]);

  useEffect(() => () => stopPoll(), [stopPoll]);

  async function submit() {
    if (!email.trim() || !prompt.trim() || running) return;
    window.localStorage.setItem('edenclaw-email', email.trim());
    stopPoll();
    setError(''); setEvents([]); setJob(null); setSelected(''); cursorRef.current = 0;
    setRunning(true);
    try {
      const r = await fetch('/api/swarm/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), prompt: prompt.trim(), maxAttempts }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? `enqueue 실패 (${r.status})`); setRunning(false); return; }
      setJobId(d.jobId);
      void poll(d.jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : '네트워크 오류');
      setRunning(false);
    }
  }

  async function openJob(id: string) {
    stopPoll();
    setEvents([]); cursorRef.current = 0; setSelected('');
    try {
      const r = await fetch(`/api/swarm/jobs/${id}?since=0`);
      if (!r.ok) return;
      const d = (await r.json()) as { job: SwarmJob; events: JobEventRecord[]; cursor: number };
      setJobId(id); setJob(d.job); setEvents(d.events); cursorRef.current = d.cursor;
      if (d.job.files.length) setSelected(d.job.files[0].path);
      if (d.job.status === 'queued' || d.job.status === 'running') { setRunning(true); void poll(id); }
    } catch { /* 무시 */ }
  }

  const selectedFile = job?.files.find((f) => f.path === selected);

  return (
    <main className="grid h-[calc(100dvh-46px)] grid-cols-1 overflow-hidden bg-slate-950 text-slate-100 lg:grid-cols-[300px_1fr_minmax(280px,32%)]">
      {/* ── 좌: 입력 + 실행 히스토리 ── */}
      <section className="flex min-h-0 flex-col border-r border-slate-800">
        <div className="shrink-0 border-b border-slate-800 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h1 className="text-sm font-bold text-white">자율 루프 관제탑</h1>
            <Link href="/trading" className="text-[11px] text-sky-400 hover:underline">← 콘솔</Link>
          </div>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="email"
            className="mb-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none" />
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} disabled={running}
            placeholder="개발 작업 요청 (밤샘 자율 루프)"
            className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none disabled:opacity-60" />
          <div className="mt-2 flex items-center gap-2">
            <label className="text-[11px] text-slate-400">최대 시도
              <input type="number" min={3} max={8} value={maxAttempts}
                onChange={(e) => setMaxAttempts(Math.max(3, Math.min(8, Number(e.target.value) || 5)))}
                className="ml-1 w-12 rounded border border-slate-700 bg-slate-800 px-1 py-0.5 text-center text-white" />
            </label>
            <button onClick={() => void submit()} disabled={running || !email.trim() || !prompt.trim()}
              className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
              {running ? '실행 중…' : '▶ 자율 실행'}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>
        <div className="shrink-0 border-b border-slate-800 px-3 py-2 text-xs font-semibold text-slate-400">🕘 실행 히스토리</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {history.length === 0 ? <p className="px-2 py-3 text-[11px] text-slate-600">아직 실행 기록이 없습니다.</p> :
            history.map((h) => (
              <button key={h.id} onClick={() => void openJob(h.id)}
                className={`mb-1 flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[11px] ${jobId === h.id ? 'bg-slate-800' : 'hover:bg-slate-800/50'}`}>
                <span className="truncate font-mono text-slate-300">{h.prompt.slice(0, 28) || h.id}</span>
                <span className={`shrink-0 rounded px-1.5 py-px text-[9px] ${STATUS_STYLE[h.status]}`}>{h.status}</span>
              </button>
            ))}
        </div>
      </section>

      {/* ── 중: 상태 + 모델별 시도 타임라인 ── */}
      <section className="flex min-h-0 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-2 text-xs">
          {job ? (
            <>
              <span className={`rounded px-2 py-0.5 font-semibold ${STATUS_STYLE[job.status]}`}>{job.status}</span>
              <span className="text-slate-400">시도 <b className="text-white tabular-nums">{job.attempts}</b>/{job.maxAttempts}</span>
              <span className="text-slate-400">가스 <b className="text-amber-300 tabular-nums">{job.gasCharged.toLocaleString()}</b></span>
              {job.finalProvider && <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-300">{job.finalProvider}</span>}
              <span className="ml-auto font-mono text-[10px] text-slate-600">{job.id}</span>
            </>
          ) : <span className="text-slate-500">작업을 입력하고 ▶ 자율 실행을 누르면 모델별 진행이 실시간 중계됩니다.</span>}
        </div>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
          {events.length === 0 && !job && <p className="text-xs text-slate-600">대기 중…</p>}
          {events.map((rec) => <TimelineRow key={rec.seq} rec={rec} />)}
          {job?.status === 'failed' && job.error && (
            <div className="rounded-lg border border-red-700 bg-red-950/30 p-3 text-xs text-red-300">
              <div className="mb-1 font-bold">❌ 자율 한도 초과 — 마지막 컴파일 에러</div>
              <pre className="whitespace-pre-wrap font-mono text-[11px]">{job.error}</pre>
            </div>
          )}
        </div>
      </section>

      {/* ── 우: 파일트리 + 코드 뷰어 ── */}
      <section className="grid min-h-0 grid-rows-[auto_1fr] border-l border-slate-800 bg-[#0b1020]">
        <div className="border-b border-slate-800 px-3 py-2 text-xs font-semibold text-slate-400">📁 최종 산출물 ({job?.files.length ?? 0})</div>
        <div className="grid min-h-0 grid-cols-[minmax(120px,38%)_1fr]">
          <div className="min-h-0 overflow-y-auto border-r border-slate-800 p-1.5">
            {(job?.files ?? []).length === 0 ? <p className="px-2 py-3 text-[11px] text-slate-600">통과 시 생성 파일이 표시됩니다.</p> :
              job?.files.map((f) => (
                <button key={f.path} onClick={() => setSelected(f.path)}
                  className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] ${selected === f.path ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800/50'}`}>
                  <span>📄</span><span className="truncate font-mono">{f.path}</span>
                </button>
              ))}
          </div>
          <pre className="min-h-0 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-200">
            {selectedFile?.content ?? '// 파일을 선택하세요'}
          </pre>
        </div>
      </section>
    </main>
  );
}

function TimelineRow({ rec }: { rec: JobEventRecord }) {
  const e = rec.event;
  switch (e.type) {
    case 'attempt_start':
      return <div className="flex items-center gap-1.5 px-1 pt-2 text-[11px]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" /><span className="font-semibold text-sky-300">시도 #{e.attempt}</span><span className="text-slate-400">{e.label}</span></div>;
    case 'generated':
      return <div className="px-3 text-[11px] text-slate-500">코드 생성 — {e.provider} · {e.files}개 파일</div>;
    case 'compile':
      return (
        <div className={`rounded-lg border px-2.5 py-1.5 ${e.ok ? 'border-emerald-800/60 bg-emerald-950/20' : 'border-red-800/60 bg-red-950/20'}`}>
          <div className="mb-0.5 flex items-center justify-between text-[11px]">
            <span className={`font-semibold ${e.ok ? 'text-emerald-300' : 'text-red-300'}`}>{e.ok ? '✅ tsc 통과' : '❌ tsc 실패'} (#{e.attempt})</span>
            <span className="rounded bg-cyan-500/15 px-1 py-px text-[9px] text-cyan-300">{e.ms.toLocaleString()}ms</span>
          </div>
          {!e.ok && <pre className="max-h-36 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-snug text-red-200/90">{e.output}</pre>}
        </div>
      );
    case 'escalate':
      return <div className="flex items-center gap-1.5 rounded-lg border border-amber-700/50 bg-amber-950/20 px-2.5 py-1 text-[11px] text-amber-300">🔀 에스컬레이션 <b>{e.from}</b> → <b>{e.to}</b> <span className="text-amber-400/70">({e.reason})</span></div>;
    case 'provider_error':
      return <div className="rounded-lg border border-orange-800/50 bg-orange-950/20 px-2.5 py-1 text-[11px] text-orange-300">⚠ provider 오류 ({e.tier}): {e.error}</div>;
    case 'promoted':
      return <div className="rounded-lg border border-emerald-700/60 bg-emerald-950/20 px-2.5 py-1 text-[11px] text-emerald-300">🚀 승격(promote) → <span className="font-mono">{e.targetFile}</span> (시도 #{e.attempt})</div>;
    case 'success':
      return <div className="rounded-lg border border-emerald-600 bg-emerald-950/30 px-2.5 py-1.5 text-[11px] font-bold text-emerald-300 shadow-[0_0_14px_rgba(52,211,153,0.4)]">🎉 통과 — {e.provider} (시도 #{e.attempt}) · 가스 {e.gasCharged.toLocaleString()}</div>;
    case 'exhausted':
      return <div className="rounded-lg border border-red-600 bg-red-950/30 px-2.5 py-1.5 text-[11px] font-bold text-red-300">한도 초과 — {e.attempts}회 시도 후 실패</div>;
    default:
      return null;
  }
}
