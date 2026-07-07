// P2: 자율 루프 벤치마크 — "튜닝 Gemma 31B가 어디까지 혼자 해내고, 언제 에스컬레이션하는가"를 측정.
// 각 과제를 실제 루프(실 tsc)로 돌려 최종 통과 티어/시도횟수/가스/시간을 집계한다.
import { runAutonomousLoop, type ModelTier } from './autonomous-loop';

export interface BenchmarkTask {
  id: string;
  prompt: string;
}

export interface TaskOutcome {
  id: string;
  success: boolean;
  finalTier?: string;
  attempts: number;
  gasCharged: number;
  ms: number;
}

export interface BenchmarkReport {
  total: number;
  passed: number;
  failed: number;
  /** 1티어(보통 Gemma)가 에스컬레이션 없이 단독 해결한 과제 수 */
  firstTierSolo: number;
  firstTierSoloRate: number;
  /** 통과했지만 상위 티어로 에스컬레이션이 필요했던 과제 수 */
  escalated: number;
  escalationRate: number;
  byTier: Record<string, number>;
  avgAttempts: number;
  totalGas: number;
  totalMs: number;
  outcomes: TaskOutcome[];
}

export interface BenchmarkOptions {
  maxAttempts?: number;
  onTaskDone?: (outcome: TaskOutcome) => void;
}

export async function runBenchmark(
  tasks: BenchmarkTask[],
  tiers: ModelTier[],
  opts: BenchmarkOptions = {}
): Promise<BenchmarkReport> {
  if (tiers.length === 0) throw new Error('티어가 비어 있습니다.');
  const firstTierKey = tiers[0].key;
  const outcomes: TaskOutcome[] = [];

  for (const task of tasks) {
    const t0 = Date.now();
    const result = await runAutonomousLoop({ prompt: task.prompt, tiers, maxAttempts: opts.maxAttempts ?? tiers.length + 2 });
    const outcome: TaskOutcome = {
      id: task.id,
      success: result.success,
      finalTier: result.finalTier,
      attempts: result.attempts,
      gasCharged: result.gasCharged,
      ms: Date.now() - t0,
    };
    outcomes.push(outcome);
    opts.onTaskDone?.(outcome);
  }

  const passed = outcomes.filter((o) => o.success);
  const firstTierSolo = passed.filter((o) => o.finalTier === firstTierKey).length;
  const escalated = passed.length - firstTierSolo;
  const byTier: Record<string, number> = {};
  for (const o of passed) if (o.finalTier) byTier[o.finalTier] = (byTier[o.finalTier] ?? 0) + 1;

  return {
    total: outcomes.length,
    passed: passed.length,
    failed: outcomes.length - passed.length,
    firstTierSolo,
    firstTierSoloRate: outcomes.length ? firstTierSolo / outcomes.length : 0,
    escalated,
    escalationRate: outcomes.length ? escalated / outcomes.length : 0,
    byTier,
    avgAttempts: outcomes.length ? outcomes.reduce((s, o) => s + o.attempts, 0) / outcomes.length : 0,
    totalGas: outcomes.reduce((s, o) => s + o.gasCharged, 0),
    totalMs: outcomes.reduce((s, o) => s + o.ms, 0),
    outcomes,
  };
}

/** 리포트를 사람이 읽을 표로 포맷. */
export function formatReport(report: BenchmarkReport): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines = [
    '─────────── 자율 루프 벤치마크 리포트 ───────────',
    `과제 ${report.total} · 통과 ${report.passed} · 실패 ${report.failed}`,
    `Gemma(1티어) 단독 해결률: ${pct(report.firstTierSoloRate)} (${report.firstTierSolo}/${report.total})`,
    `에스컬레이션 필요: ${pct(report.escalationRate)} (${report.escalated}/${report.total})`,
    `평균 시도: ${report.avgAttempts.toFixed(2)} · 총 가스: ${report.totalGas.toLocaleString()} · 총 시간: ${report.totalMs.toLocaleString()}ms`,
    `티어별 최종 해결: ${Object.entries(report.byTier).map(([k, v]) => `${k}=${v}`).join(', ') || '(없음)'}`,
    '────────────────────────────────────────────────',
  ];
  return lines.join('\n');
}
