'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_TARGET_PATH = 'app/api/swarm/generated/route.ts';
const PROGRESS_LOG_URL = '/api/swarm/logs';
const MAX_TERMINAL_LINES = 160;

type TerminalLine = {
  id: number;
  text: string;
  tone?: 'info' | 'ok' | 'error' | 'muted';
};

const INITIAL_TERMINAL_LINES: TerminalLine[] = [
  {
    id: 1,
    tone: 'muted',
    text: '[ready] READY · Codex → Claude build feedback loop 대기 중',
  },
];

function nowLabel(): string {
  return new Date().toLocaleTimeString();
}

function toneFromLogLine(line: string): TerminalLine['tone'] {
  if (/\[(ERROR|FATAL|FAIL|TSC_FAIL)\]|\bfailed\b|\berror\b/i.test(line)) return 'error';
  if (/\[DONE\]|deployment-ready|build passed|SWARM_LOOP_RUNNING|\[TSC_OK\]/i.test(line)) return 'ok';
  if (/\[(WARN)\]|Feedback|feeding/i.test(line)) return 'info';
  return 'muted';
}

function timestampFromLogLine(line: string): number | null {
  const match = line.match(/^\[([^\]]+)\]/);
  if (!match) return null;

  const timestamp = Date.parse(match[1]);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export default function TradingPage() {
  const lineIdRef = useRef(1);
  const progressPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartedAtRef = useRef(0);
  const pollErrorReportedRef = useRef(false);
  const [task, setTask] = useState('');
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<TerminalLine[]>(INITIAL_TERMINAL_LINES);

  const canRun = useMemo(() => task.trim().length > 0 && !running, [task, running]);

  useEffect(() => {
    return () => {
      if (progressPollingRef.current) {
        clearInterval(progressPollingRef.current);
      }
    };
  }, []);

  function push(text: string, tone: TerminalLine['tone'] = 'info') {
    setLines((prev) => [
      ...prev,
      {
        id: ++lineIdRef.current,
        tone,
        text: `[${nowLabel()}] ${text}`,
      },
    ].slice(-120));
  }

  function stopProgressPolling() {
    if (!progressPollingRef.current) return;
    clearInterval(progressPollingRef.current);
    progressPollingRef.current = null;
  }

  function applyProgressLog(logText: string): { done: boolean; failed: boolean } {
    const rawLines = logText.split(/\r?\n/).filter(Boolean);
    const latestLines = rawLines.slice(-MAX_TERMINAL_LINES);
    const renderedLines = latestLines.map((line, index): TerminalLine => ({
      id: index + 1,
      tone: toneFromLogLine(line),
      text: line,
    }));

    if (renderedLines.length > 0) {
      lineIdRef.current = Math.max(lineIdRef.current, renderedLines.length + 1);
      setLines(renderedLines);
    }

    const isCurrentRun = (line: string) => {
      const timestamp = timestampFromLogLine(line);
      return timestamp === null || timestamp >= pollStartedAtRef.current;
    };

    const done = rawLines.some((line) => /\[DONE\]|deployment-ready/i.test(line) && isCurrentRun(line));
    const failed = rawLines.some((line) => /\[(FAIL|FATAL)\]/i.test(line) && isCurrentRun(line));

    return { done, failed };
  }

  async function pollProgressLog() {
    try {
      const response = await fetch(`${PROGRESS_LOG_URL}?ts=${Date.now()}`, {
        cache: 'no-store',
      });

      if (!response.ok) return;

      const logText = await response.text();
      const { done, failed } = applyProgressLog(logText);

      if (done || failed) {
        stopProgressPolling();
        setRunning(false);
        if (failed) push('SWARM LOOP FAILED — 원본 파일이 복구되었습니다.', 'error');
        else push('SWARM LOOP DONE — deployment-ready', 'ok');
      }
    } catch (error) {
      if (!pollErrorReportedRef.current) {
        pollErrorReportedRef.current = true;
        push(`LOG POLL ERROR · ${error instanceof Error ? error.message : 'progress log fetch failed'}`, 'error');
      }
    }
  }

  function startProgressPolling() {
    stopProgressPolling();
    pollErrorReportedRef.current = false;
    pollStartedAtRef.current = Date.now() - 1000;
    void pollProgressLog();
    progressPollingRef.current = setInterval(() => {
      void pollProgressLog();
    }, 1000);
  }

  async function runSwarm() {
    const prompt = task.trim();
    if (!prompt || running) return;

    setRunning(true);
    startProgressPolling();
    push('Codex 단계 준비 · 작업 프롬프트를 백엔드 루프에 전달합니다.', 'info');
    push(`TARGET · ${DEFAULT_TARGET_PATH}`, 'muted');

    try {
      const response = await fetch('/api/swarm/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: prompt,
          targetPath: DEFAULT_TARGET_PATH,
        }),
      });

      const text = await response.text();
      const payload = text ? JSON.parse(text) as Record<string, unknown> : {};

      if (!response.ok) {
        push(`ERROR · ${String(payload.error ?? `HTTP ${response.status}`)}`, 'error');
        return;
      }

      push('Codex 단계 시작 · 파일 자동 생성/기록이 백그라운드에서 실행됩니다.', 'ok');
      push('Claude 단계 예약 · 파일 저장 직후 npm run build 검증이 이어집니다.', 'ok');
      push(`SWARM_LOOP_RUNNING · pid=${String(payload.pid ?? 'unknown')}`, 'info');
      push('결과 로그는 서버 프로세스에서 계속 누적됩니다. UI는 락 없이 즉시 반환되었습니다.', 'muted');
    } catch (error) {
      push(`ERROR · ${error instanceof Error ? error.message : 'Swarm 요청 실패'}`, 'error');
      setRunning(false);
    }
  }

  return (
    <main className="min-h-[calc(100dvh-46px)] bg-black p-4 text-white">
      <section className="mx-auto flex min-h-[calc(100dvh-78px)] w-full max-w-6xl flex-col border border-zinc-900 bg-black">
        <header className="border-b border-zinc-900 px-4 py-3">
          <h1 className="font-mono text-sm font-bold uppercase tracking-[0.24em] text-white">
            EdenClaw Autonomous Agent Loop
          </h1>
          <p className="mt-1 font-mono text-xs text-zinc-500">
            Codex writes files → Claude build-checks → compile errors feed back → repeat up to 5 attempts.
          </p>
        </header>

        <div className="border-b border-zinc-900 p-4">
          <textarea
            value={task}
            onChange={(event) => setTask(event.target.value)}
            placeholder="작업 지시를 입력하세요. 예: Create a safe status API route that returns current swarm state."
            className="min-h-[180px] w-full resize-y rounded-none border border-zinc-900 bg-black p-4 font-mono text-sm leading-relaxed text-white outline-none placeholder:text-zinc-700 focus:border-[#0052FF]"
          />
        </div>

        <div className="border-b border-zinc-900 p-4">
          <button
            type="button"
            onClick={runSwarm}
            disabled={!canRun}
            className="w-full rounded-none border border-zinc-900 bg-white px-4 py-3 font-mono text-sm font-bold uppercase tracking-[0.2em] text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-900 disabled:text-zinc-600"
          >
            {running ? 'SWARM LOOP STARTING…' : 'Swarm 가동'}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden p-4">
          <div className="h-full min-h-[360px] overflow-y-auto rounded-none border border-zinc-900 bg-zinc-950 p-4 font-mono text-xs leading-relaxed">
            {lines.map((line) => (
              <div
                key={line.id}
                className={
                  line.tone === 'ok'
                    ? 'text-emerald-300'
                    : line.tone === 'error'
                      ? 'text-red-300'
                      : line.tone === 'muted'
                        ? 'text-zinc-600'
                        : 'text-zinc-300'
                }
              >
                {line.text}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
