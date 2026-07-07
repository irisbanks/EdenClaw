'use client';

import { useMemo, useState } from 'react';

const DEFAULT_TARGET_PATH = 'app/api/swarm/generated/route.ts';

type TerminalLine = {
  id: number;
  text: string;
  tone?: 'info' | 'ok' | 'error' | 'muted';
};

function nowLabel(): string {
  return new Date().toLocaleTimeString();
}

export default function TradingPage() {
  const [task, setTask] = useState('');
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<TerminalLine[]>([
    {
      id: 1,
      tone: 'muted',
      text: `[${nowLabel()}] READY · Codex → Claude build feedback loop 대기 중`,
    },
  ]);

  const canRun = useMemo(() => task.trim().length > 0 && !running, [task, running]);

  function push(text: string, tone: TerminalLine['tone'] = 'info') {
    setLines((prev) => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        tone,
        text: `[${nowLabel()}] ${text}`,
      },
    ].slice(-120));
  }

  async function runSwarm() {
    const prompt = task.trim();
    if (!prompt || running) return;

    setRunning(true);
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
    } finally {
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
