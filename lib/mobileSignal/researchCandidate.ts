// Read-only research snapshot, additive to the live signal response.
//
// Sourced from MyTradeBotGPU/existing_bot_readiness (final_candidate_ranking.md,
// 2026-06-21, FINAL VERDICT: NO_LIVE_CANDIDATE_FOUND) plus the most recent
// live-paper comparison in training/reports/eden1_v4_b200_top1_lite_report.md
// (2026-07-06T18:45:41Z). No existing signal/order logic reads or depends on
// this — it exists purely for display so operators can see what the research
// pipeline currently considers "best so far", with its real caveats attached.
//
// Update by hand when the research pipeline produces a materially different
// leader; do not silently drop the caveats when refreshing numbers.

export interface ResearchCandidateRunnerUp {
  candidate_id: string;
  trades: number;
  win_rate_pct: number;
  profit_factor: number;
  net_pnl_usdt: number;
}

export interface ResearchCandidateSnapshot {
  candidate_id: string;
  label: string;
  source: 'RESEARCH_SNAPSHOT';
  snapshot_generated_at: string;
  sample_period_note: string;
  trades: number;
  win_rate_pct: number;
  profit_factor: number;
  net_pnl_usdt: number;
  max_drawdown_pct: number;
  grade: 'A' | 'B' | 'C' | 'D';
  verdict: string;
  is_live_ready: false;
  is_trade_eligible: false;
  caveat: string;
  runner_up: ResearchCandidateRunnerUp;
}

export const RESEARCH_CANDIDATE_SNAPSHOT: ResearchCandidateSnapshot = {
  candidate_id: 'EDEN1_V3_LONG_HC085_FEE3X',
  label: 'EDEN1 V3 LONG · HC0.85 (3x 수수료 가정, 보수적 비용 반영)',
  source: 'RESEARCH_SNAPSHOT',
  snapshot_generated_at: '2026-07-06T18:45:41Z',
  sample_period_note:
    '실시간 페이퍼 트레이딩 48건 기준 (약 2026-06-10 ~ 2026-07-06 누적, 실계좌 아님)',
  trades: 48,
  win_rate_pct: 50.0,
  profit_factor: 1.083,
  net_pnl_usdt: 17.45,
  max_drawdown_pct: 0.88,
  grade: 'C',
  verdict: 'SAMPLE_TOO_SMALL_MONITORING',
  is_live_ready: false,
  is_trade_eligible: false,
  caveat:
    '기존 리서치 파이프라인(existing_bot_readiness) 자체 감사 결과 2026-06-21 최종 판정은 ' +
    'NO_LIVE_CANDIDATE_FOUND였습니다. 이 후보는 현재 후보군 중 승률/PF가 가장 양호하지만 ' +
    '48건은 통계적으로 유의미한 표본이 아니며 walk-forward/blind 재검증을 통과하지 않았습니다. ' +
    '주문 후보로 사용 금지 — 참고용 연구 지표입니다.',
  runner_up: {
    candidate_id: 'EDEN1_V3_LONG_HC090_FEE3X',
    trades: 21,
    win_rate_pct: 42.9,
    profit_factor: 1.187,
    net_pnl_usdt: 23.21,
  },
};
