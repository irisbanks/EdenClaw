'use client';

import { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import styles from './mobile-signal.module.css';

const POLL_INTERVAL_MS = 5_000;
const CHART_INITIAL_DIMENSION = { width: 800, height: 300 };

type DisplayStatus = 'READY' | 'WAIT' | 'BLOCKED' | 'BLOCKED_STALE' | 'NO_SIGNAL';
type ConnectionState = 'FRESH' | 'DELAYED' | 'STALE' | 'OFFLINE';
type SourceConnectionState = 'ONLINE' | 'STALE' | 'OFFLINE';
type SignalTimeframe = '5m' | '15m' | '30m';
type SignalRange = '1h' | '6h' | '24h' | '7d';

const RANGE_OPTIONS: ReadonlyArray<{ value: SignalRange; label: string; caption: string }> = [
  { value: '1h', label: '1H', caption: '최근 1시간' },
  { value: '6h', label: '6H', caption: '최근 6시간' },
  { value: '24h', label: '24H', caption: '최근 24시간' },
  { value: '7d', label: '7D', caption: '최근 7일' },
];
const TIMEFRAME_OPTIONS: ReadonlyArray<SignalTimeframe> = ['5m', '15m', '30m'];

const RANGE_STORAGE_KEY = 'eden-mobile-signal-range';
const MAX_VISIBLE_POINTS = 96;
const CHART_SYNC_ID = 'eden-mobile-signal-timeline';

interface LatestSignal {
  ticket_status: DisplayStatus;
  message?: string;
  symbol?: string;
  side?: string;
  recommended_margin_usdt?: number;
  leverage?: number;
  suggested_limit_price?: number | null;
  take_profit_price?: number | null;
  stop_loss_price?: number | null;
  reason?: string;
  blocked_reasons?: string[];
  expires_at?: string;
  received_at?: string;
  bot_order_execution: 'DISABLED';
  real_order_sent_by_bot: false;
  user_must_place_order_manually: true;
}

interface MarketPoint {
  timestamp: string;
  source: string;
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread_bps: number;
  last: number;
}

interface SignalHistoryPoint {
  timestamp: string;
  close: number;
  decision: string;
  prob_long: number;
  prob_short: number;
  prob_wait: number;
  hc: number;
  reason: string;
}

interface ReadinessSummary {
  overall_trade_readiness_pct: number;
  long_probability_pct: number;
  short_probability_pct: number;
  wait_probability_pct: number;
  hc_ready_pct: number;
  hc_current: number;
  hc_threshold: number;
  hc070_ready_pct?: number;
  hc085_ready_pct?: number;
  hc090_ready_pct?: number;
  proximity_readiness_pct?: number;
  signal_timestamp?: string;
  signal_age_seconds?: number;
  signal_stale?: boolean;
  note: string;
}

interface TimeAlignedPoint {
  ts: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  bid: number | null;
  ask: number | null;
  mid: number;
  signal_history_available?: boolean;
  long_pct: number;
  short_pct: number;
  wait_pct: number;
  hc: number;
  hc_pct: number;
  hc70_ready_pct: number;
  hc070_ready_pct: number;
  hc085_ready_pct: number;
  hc090_ready_pct: number;
  overall_readiness_pct: number;
  proximity_readiness_pct: number;
  decision: string;
  status: 'READY' | 'WAIT' | 'BLOCKED';
  signal_ts: string;
  signal_age_sec: number;
  signal_age_seconds: number;
  signal_changed: boolean;
  signal_stale: boolean;
  stale: boolean;
}

interface ConfirmedSignal {
  ts: string;
  age_sec: number | null;
  decision: 'LONG' | 'SHORT' | 'WAIT' | 'NO_SIGNAL';
  hc: number;
  long_pct: number;
  short_pct: number;
  wait_pct: number;
  source: 'CONFIRMED_15M_AI';
  status: ConnectionState | 'FRESH_PENDING_CANDLE';
  candidate_conditions_met?: boolean;
  is_trade_eligible: false;
}

interface LivePreviewSignal {
  ts: string;
  age_sec: number | null;
  decision: 'LONG' | 'SHORT' | 'WAIT' | 'NO_SIGNAL';
  confidence_pct: number;
  long_pct: number;
  short_pct: number;
  wait_pct: number;
  source: 'LIVE_PRICE_PREVIEW';
  status: 'FRESH' | 'STALE' | 'OFFLINE';
  is_trade_eligible: false;
  intrabar_return_pct?: number;
  recent_slope_pct?: number;
  note: string;
}

interface CandidateCondition {
  key: string;
  label: string;
  pct: number;
}

interface CandidateReadiness {
  id: string;
  name: string;
  status: 'READY' | 'WAIT' | 'BLOCKED' | 'STALE';
  readiness_pct: number;
  hc?: number;
  threshold?: number;
  current_price?: number;
  entry_level?: number;
  four_hour_ma_slope_pct?: number;
  open_position_count?: number;
  data_age_minutes?: number;
  conditions: CandidateCondition[];
  blocked_reasons: string[];
}

interface BlockerBreakdown {
  key: string;
  label: string;
  current: number;
  target: number;
  pct: number;
  missing_pct: number;
  detail: string;
}

interface PriceLevels {
  current: number | null;
  high_24h: number | null;
  low_24h: number | null;
  entry: number | null;
  take_profit: number | null;
  stop_loss: number | null;
  threshold: number | null;
  source: string;
}

interface BotTelemetry {
  bridge_connection: SourceConnectionState;
  market_connection: SourceConnectionState;
  model_connection: SourceConnectionState;
  updated_at: string;
  bridge_name: string;
  mode: string;
  live_trading_enabled: boolean;
  real_orders_placed: number;
  symbol: string;
  direction_policy: string;
  last_decision: string;
  last_reason: string;
  accepted_intent_count: number;
  blocked_order_count: number;
  safety_state: string;
  feature_status: string;
  open_position_count: number;
  current_signal: string;
  current_hc: number;
  hc_threshold: number;
  reference_price: number | null;
  signal_at: string;
}

interface LiveFeed {
  generated_at: string;
  server_now_ts?: string;
  current_price?: number;
  connection: ConnectionState;
  decision?: 'LONG' | 'SHORT' | 'WAIT' | 'NO_SIGNAL';
  timeframe?: SignalTimeframe;
  range?: SignalRange;
  points?: number;
  requested_points?: number;
  price_source?: string;
  signal_history_available?: boolean;
  signal_history_missing_buckets?: number;
  signal_history_note?: string;
  latest_signal_ts?: string;
  latest_price_ts?: string;
  signal_age_sec?: number;
  signal_age_label?: string;
  signal_stale?: boolean;
  signal_cycle_state?: ConnectionState | 'FRESH_PENDING_CANDLE';
  signal_fresh_after_sec?: number;
  signal_stale_after_sec?: number;
  real_signal_age_sec?: number | null;
  real_price_age_sec?: number | null;
  price_stale?: boolean;
  live_state?: 'ACTIVE' | 'NO_SIGNAL' | 'BLOCKED_STALE';
  mobile_order_candidate?: 'LONG' | 'SHORT' | 'NO_SIGNAL' | 'BLOCKED_STALE';
  manual_order_disabled?: boolean;
  dry_run?: boolean;
  live_trading_enabled?: boolean;
  real_orders_placed?: number;
  confirmed_signal?: ConfirmedSignal;
  live_preview_signal?: LivePreviewSignal;
  readiness?: ReadinessSummary;
  bots?: {
    midpoint_0049: CandidateReadiness;
    v3_hc090: CandidateReadiness;
    v3_hc085: CandidateReadiness;
  };
  blocker_breakdown?: BlockerBreakdown[];
  price_levels?: PriceLevels;
  bot: BotTelemetry | null;
  market: {
    updated_at: string;
    collector_state: string;
    source: string;
    latest: MarketPoint | null;
    points: MarketPoint[];
  };
  signal_history: SignalHistoryPoint[];
  time_aligned_series?: TimeAlignedPoint[];
}

const NO_SIGNAL: LatestSignal = {
  ticket_status: 'NO_SIGNAL',
  message: 'No mobile signal received yet',
  bot_order_execution: 'DISABLED',
  real_order_sent_by_bot: false,
  user_must_place_order_manually: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStatus(value: unknown): DisplayStatus {
  if (value === 'READY' || value === 'WAIT' || value === 'BLOCKED') return value;
  if (value === 'EXPIRED') return 'BLOCKED';
  return 'NO_SIGNAL';
}

function normalizeSignal(payload: unknown): LatestSignal {
  if (!isRecord(payload)) return NO_SIGNAL;

  const source = isRecord(payload.signal) ? payload.signal : payload;
  const status = normalizeStatus(source.ticket_status);

  return {
    ...NO_SIGNAL,
    ...source,
    ticket_status: status,
    message:
      typeof source.message === 'string'
        ? source.message
        : status === 'NO_SIGNAL'
          ? NO_SIGNAL.message
          : undefined,
    bot_order_execution: 'DISABLED',
    real_order_sent_by_bot: false,
    user_must_place_order_manually: true,
  } as LatestSignal;
}

function isLiveFeed(payload: unknown): payload is LiveFeed {
  return (
    isRecord(payload) &&
    (payload.connection === 'FRESH' ||
      payload.connection === 'DELAYED' ||
      payload.connection === 'STALE' ||
      payload.connection === 'OFFLINE') &&
    isRecord(payload.market) &&
    Array.isArray(payload.market.points) &&
    Array.isArray(payload.signal_history)
  );
}

function displayNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(value);
}

function displayTime(value?: string): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('ko-KR');
}

function displayAge(seconds?: number): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}초`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 ${Math.round(seconds % 60)}초`;
  return `${Math.floor(seconds / 3600)}시간 ${Math.floor((seconds % 3600) / 60)}분`;
}

function chartTime(value: string, includeDate = false): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('ko-KR', {
    ...(includeDate ? { month: 'numeric', day: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    second: includeDate ? undefined : '2-digit',
  });
}

function displayConnection(value: ConnectionState): string {
  if (value === 'FRESH') return '실시간 연결 정상';
  if (value === 'DELAYED') return '갱신 지연 — 주문 금지';
  if (value === 'STALE') return '실시간 아님 — 주문 금지';
  return '연결 끊김 — 주문 금지';
}

function displayReason(value?: string): string {
  if (value === 'MODEL_WAIT') return '모델이 진입 조건을 충족하지 않아 대기 중입니다.';
  if (value === 'HC_OR_LONG_PROB_FILTER_REJECT') return '확신도 또는 LONG 확률 기준을 통과하지 못했습니다.';
  if (value === 'WAITING_FOR_FUTURE_BARS') return '진입 판단에 필요한 다음 확정봉을 기다리고 있습니다.';
  if (value === 'DRY_RUN_ONLY_NO_PRIVATE_CALL') return '모의 주문 후보만 생성했고 실제 주문 API는 호출하지 않았습니다.';
  return value || '새 판단을 기다리는 중입니다.';
}

function safePercent(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function readinessBand(value: number): string {
  const pct = safePercent(value);
  if (pct >= 100) return 'READY';
  if (pct >= 90) return '거의 준비';
  if (pct >= 70) return '근접';
  if (pct >= 40) return '관찰';
  return '낮음';
}

function readinessTone(value: number): string {
  const pct = safePercent(value);
  if (pct >= 100) return 'toneReady';
  if (pct >= 90) return 'toneAlmost';
  if (pct >= 70) return 'toneNear';
  if (pct >= 40) return 'toneWatch';
  return 'toneLow';
}

function displayBlocker(value: string): string {
  const labels: Record<string, string> = {
    OPEN_PAPER_POSITION_EXISTS: '기존 paper 포지션이 열려 있음',
    PRICE_ABOVE_ENTRY_LEVEL: '현재가가 Midpoint entry 위에 있음',
    TREND_FILTER_FAILED: '4시간 MA slope 추세 조건 미달',
    SIGNAL_NOT_LONG: '현재 방향이 LONG이 아님',
    FEATURE_STALE: 'Feature 데이터 갱신 지연',
    COOLDOWN_ACTIVE: 'Cooldown 진행 중',
    HC_BELOW_0_85: 'HC 0.85 기준 미달',
    HC_BELOW_0_90: 'HC 0.90 기준 미달',
    REALTIME_DATA_UNSAFE: '실시간 데이터 지연 또는 연결 끊김',
  };
  return labels[value.replaceAll('.', '_')] ?? value;
}

function firstFinite(...values: Array<number | null | undefined>): number | null {
  return values.find((value): value is number => typeof value === 'number' && Number.isFinite(value)) ?? null;
}

interface ChartPoint extends TimeAlignedPoint {
  x: number;
  time: string;
  preview_decision?: LivePreviewSignal['decision'];
  preview_confidence_pct?: number;
  preview_long_pct?: number;
  preview_short_pct?: number;
  preview_wait_pct?: number;
}

// Rich tooltip for the AI probability chart: time, price, HC, LONG/SHORT/WAIT,
// decision, signal age and stale flag for the hovered 15m candle.
function AiSignalTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  const noHistory = point.signal_history_available === false || point.decision === 'NO_SIGNAL_HISTORY';
  return (
    <div className={styles.chartTooltip}>
      <strong>{chartTime(point.ts, true)}</strong>
      <span>가격 {displayNumber(point.close ?? point.price)}</span>
      {noHistory ? (
        <span className={styles.tooltipStale}>과거 AI 시그널 기록 없음</span>
      ) : (
        <>
          <span>HC {Number(point.hc ?? 0).toFixed(4)}</span>
          <span>LONG {safePercent(point.long_pct).toFixed(1)}%</span>
          <span>SHORT {safePercent(point.short_pct).toFixed(1)}%</span>
          <span>WAIT {safePercent(point.wait_pct).toFixed(1)}%</span>
          <span>decision {point.decision}</span>
          <span>signal age {displayAge(point.signal_age_sec)}</span>
          <span className={point.signal_stale ? styles.tooltipStale : styles.tooltipFresh}>
            {point.signal_stale ? 'STALE · 주문 금지' : 'FRESH'}
          </span>
          {point.preview_decision ? (
            <div className={styles.tooltipPreview}>
              <strong>LIVE PREVIEW · 참고용</strong>
              <span>{point.preview_decision} · confidence {safePercent(point.preview_confidence_pct).toFixed(1)}%</span>
              <span>LONG {safePercent(point.preview_long_pct).toFixed(1)}% · SHORT {safePercent(point.preview_short_pct).toFixed(1)}%</span>
              <span>WAIT {safePercent(point.preview_wait_pct).toFixed(1)}% · 주문 불가</span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function PercentBar({ label, pct, detail }: { label: string; pct: number; detail?: string }) {
  const value = safePercent(pct);
  return (
    <div className={styles.progressItem}>
      <div className={styles.progressLabel}>
        <span>{label}</span>
        <strong>{value.toFixed(1)}%</strong>
      </div>
      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
      >
        <span className={`${styles.progressFill} ${styles[readinessTone(value)]}`} style={{ width: `${value}%` }} />
      </div>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

export default function MobileSignalDashboard() {
  const [signal, setSignal] = useState<LatestSignal>(NO_SIGNAL);
  const [liveFeed, setLiveFeed] = useState<LiveFeed | null>(null);
  const [telemetryError, setTelemetryError] = useState('');
  const [loading, setLoading] = useState(true);
  const [chartReady, setChartReady] = useState(false);
  const [timeframe, setTimeframe] = useState<SignalTimeframe>('15m');
  const [range, setRange] = useState<SignalRange>('24h');
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [chartWindowStart, setChartWindowStart] = useState(0);
  const [chartWindowSize, setChartWindowSize] = useState(MAX_VISIBLE_POINTS);
  const requestTimeframe: SignalTimeframe = range === '7d' ? '15m' : timeframe;

  // Restore the last range the user picked (default 24h on first visit).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(RANGE_STORAGE_KEY);
      if (saved === '1h' || saved === '6h' || saved === '24h' || saved === '7d') {
        setRange(saved);
        if (saved === '7d') setTimeframe('15m');
      }
    } catch {
      // localStorage may be unavailable; keep the 24h default.
    }
  }, []);

  const selectRange = (next: SignalRange) => {
    if (next === '7d') setTimeframe('15m');
    setRange(next);
    try {
      window.localStorage.setItem(RANGE_STORAGE_KEY, next);
    } catch {
      // Non-fatal: selection still applies for this session.
    }
  };

  const selectTimeframe = (next: SignalTimeframe) => {
    if (range === '7d' && next !== '15m') return;
    setTimeframe(next);
  };

  useEffect(() => {
    let active = true;
    let refreshing = false;
    const chartFrameId = window.requestAnimationFrame(() => {
      if (active) setChartReady(true);
    });

    async function fetchJson(url: string): Promise<unknown> {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`${url} returned ${response.status}`);
      return response.json() as Promise<unknown>;
    }

    async function refreshDashboard() {
      if (refreshing) return;
      refreshing = true;

      try {
        const [signalResult, liveResult] = await Promise.allSettled([
          fetchJson('/api/mobile-order-signal/latest'),
          fetchJson(`/api/mobile-order-signal/live?tf=${requestTimeframe}&range=${range}`),
        ]);

        if (!active) return;

        if (signalResult.status === 'fulfilled') {
          setSignal(normalizeSignal(signalResult.value));
        } else {
          setSignal({
            ...NO_SIGNAL,
            message: 'Mobile signal is unavailable. Waiting for the next poll.',
          });
        }

        if (liveResult.status === 'fulfilled' && isLiveFeed(liveResult.value)) {
          setLiveFeed(liveResult.value);
          setTelemetryError('');
        } else {
          setTelemetryError('봇 텔레메트리를 읽지 못했습니다. 다음 갱신에서 다시 확인합니다.');
        }
      } finally {
        refreshing = false;
        if (active) {
          setLoading(false);
          setLastCheckedAt(new Date());
        }
      }
    }

    void refreshDashboard();
    const intervalId = window.setInterval(() => void refreshDashboard(), POLL_INTERVAL_MS);

    return () => {
      active = false;
      window.cancelAnimationFrame(chartFrameId);
      window.clearInterval(intervalId);
    };
  }, [requestTimeframe, range]);

  const sourceStatus: DisplayStatus = loading ? 'NO_SIGNAL' : signal.ticket_status;
  const bot = liveFeed?.bot;
  const latestMarket = liveFeed?.market.latest;
  const activeTimeframe = liveFeed?.timeframe ?? requestTimeframe;
  const activeRange = liveFeed?.range ?? range;
  const rangeCaption = RANGE_OPTIONS.find((option) => option.value === activeRange)?.caption ?? '최근 24시간';
  const bucketMinutes = activeTimeframe === '5m' ? 5 : activeTimeframe === '30m' ? 30 : 15;
  const signalHistoryAvailable = liveFeed?.signal_history_available !== false;
  const signalHistoryNote = liveFeed?.signal_history_note ?? '';
  const confirmedSignal = liveFeed?.confirmed_signal;
  const previewSignal = liveFeed?.live_preview_signal;
  const alignedSource = liveFeed?.time_aligned_series ?? [];
  const alignedChart = alignedSource.map((point, index) => ({
    ...point,
    x: new Date(point.ts).getTime(),
    time: chartTime(point.ts, true),
    long_live: point.stale ? null : point.long_pct,
    short_live: point.stale ? null : point.short_pct,
    wait_live: point.stale ? null : point.wait_pct,
    hc_live: point.stale ? null : point.hc_pct,
    long_stale: point.stale ? point.long_pct : null,
    short_stale: point.stale ? point.short_pct : null,
    wait_stale: point.stale ? point.wait_pct : null,
    hc_stale: point.stale ? point.hc_pct : null,
    ready_marker_price: point.signal_changed && point.status === 'READY' ? point.price : null,
    wait_marker_price: point.signal_changed && point.status === 'WAIT' ? point.price : null,
    blocked_marker_price: point.signal_changed && point.status === 'BLOCKED' ? point.price : null,
    preview_marker_price: index === alignedSource.length - 1
      ? liveFeed?.current_price ?? point.price
      : null,
    preview_decision: index === alignedSource.length - 1 ? previewSignal?.decision : undefined,
    preview_confidence_pct: index === alignedSource.length - 1 ? previewSignal?.confidence_pct : undefined,
    preview_long_pct: index === alignedSource.length - 1 ? previewSignal?.long_pct : undefined,
    preview_short_pct: index === alignedSource.length - 1 ? previewSignal?.short_pct : undefined,
    preview_wait_pct: index === alignedSource.length - 1 ? previewSignal?.wait_pct : undefined,
  }));
  const effectiveWindowSize = Math.max(1, Math.min(chartWindowSize, alignedChart.length || 1));
  const maxWindowStart = Math.max(0, alignedChart.length - effectiveWindowSize);
  const selectedStartIndex = Math.min(Math.max(0, chartWindowStart), maxWindowStart);
  const selectedEndIndex = Math.min(
    alignedChart.length - 1,
    selectedStartIndex + effectiveWindowSize - 1,
  );
  const visibleSeries = selectedEndIndex >= selectedStartIndex
    ? alignedChart.slice(selectedStartIndex, selectedEndIndex + 1)
    : [];
  const xMin = visibleSeries[0]?.x;
  const xMax = visibleSeries.at(-1)?.x;
  const sharedXDomain: [number, number] = [xMin ?? 0, xMax ?? 0];
  const latestSignalX = new Date(liveFeed?.latest_signal_ts ?? '').getTime();
  const readiness = liveFeed?.readiness;
  const rawCandidates = liveFeed?.bots
    ? [liveFeed.bots.midpoint_0049, liveFeed.bots.v3_hc090, liveFeed.bots.v3_hc085]
    : [];
  const blockers = liveFeed?.blocker_breakdown ?? [];
  const priceLevels = liveFeed?.price_levels;
  const isRealtimeUnsafe = Boolean(
    telemetryError ||
      !liveFeed ||
      liveFeed.connection !== 'FRESH' ||
      liveFeed.signal_stale === true ||
      liveFeed.price_stale === true,
  );
  const status: DisplayStatus = isRealtimeUnsafe
    ? liveFeed ? 'BLOCKED_STALE' : 'NO_SIGNAL'
    : liveFeed?.mobile_order_candidate === 'LONG' || liveFeed?.mobile_order_candidate === 'SHORT'
      ? sourceStatus
      : sourceStatus === 'READY'
        ? 'NO_SIGNAL'
        : sourceStatus;
  const candidates = rawCandidates.map((candidate) => isRealtimeUnsafe
    ? {
        ...candidate,
        status: 'STALE' as const,
        blocked_reasons: Array.from(new Set([...candidate.blocked_reasons, 'REALTIME_DATA_UNSAFE'])),
      }
    : candidate);
  const displayedStart = visibleSeries[0]?.ts;
  const displayedEnd = visibleSeries.at(-1)?.ts;
  const canMovePrevious = selectedStartIndex > 0;
  const canMoveNext = selectedEndIndex < alignedChart.length - 1;

  useEffect(() => {
    const total = alignedChart.length;
    const windowSize = activeRange === '7d'
      ? Math.min(total, MAX_VISIBLE_POINTS)
      : total;
    setChartWindowSize(Math.max(1, windowSize));
    setChartWindowStart(Math.max(0, total - windowSize));
  }, [activeRange, alignedChart.length]);

  const moveViewWindow = (direction: -1 | 1) => {
    if (alignedChart.length === 0) return;
    const step = activeRange === '7d' ? MAX_VISIBLE_POINTS : effectiveWindowSize;
    const nextStart = Math.max(
      0,
      Math.min(selectedStartIndex + direction * step, maxWindowStart),
    );
    setChartWindowStart(nextStart);
  };

  const moveViewWindowToLatest = () => setChartWindowStart(maxWindowStart);
  const currentPrice = firstFinite(latestMarket?.mid, priceLevels?.current);
  const entryPrice = firstFinite(signal.suggested_limit_price, priceLevels?.entry);
  const takeProfitPrice = firstFinite(signal.take_profit_price, priceLevels?.take_profit);
  const stopLossPrice = firstFinite(signal.stop_loss_price, priceLevels?.stop_loss);
  const thresholdPrice = firstFinite(priceLevels?.threshold, bot?.reference_price);

  return (
    <main className={styles.page}>
      <section className={styles.shell} aria-labelledby="mobile-signal-title">
        <p className={styles.eyebrow}>EDENCLAW · MANUAL EXECUTION ONLY</p>
        <h1 id="mobile-signal-title">EDENCLAW Mobile Order Signal</h1>

        <div className={styles.safetyBanner} role="note">
          표시 전용 — 봇은 주문하지 않음
        </div>

        {isRealtimeUnsafe ? (
          <div className={styles.staleBanner} role="alert" aria-live="assertive">
            {displayConnection(liveFeed?.connection ?? 'OFFLINE')}
            <span className={styles.staleBannerDetail}>
              signal age {displayAge(liveFeed?.real_signal_age_sec ?? undefined)} · price age{' '}
              {displayAge(liveFeed?.real_price_age_sec ?? undefined)} · server now{' '}
              {displayTime(liveFeed?.server_now_ts)}
            </span>
          </div>
        ) : null}

        <div className={styles.viewStatusBar} role="status">
          <span><strong>{bucketMinutes}분 단위</strong> / {rangeCaption}</span>
          <span>표시 구간: <strong>{displayTime(displayedStart)} ~ {displayTime(displayedEnd)}</strong></span>
          <span>총 데이터: <strong>{alignedChart.length}개</strong> / 현재 표시: <strong>{visibleSeries.length}개</strong></span>
          <span className={isRealtimeUnsafe ? styles.viewStatusStale : styles.viewStatusFresh}>
            {displayConnection(liveFeed?.connection ?? 'OFFLINE')}
          </span>
        </div>

        <p className={styles.manualNotice}>
          이 화면은 주문 후보만 표시합니다. 실제 주문은 사용자가 Bitget 앱 또는 웹에서 직접 확인하고
          입력해야 합니다.
        </p>

        <section className={styles.liveCard} aria-labelledby="live-bot-title" aria-busy={loading}>
          <div className={styles.liveHeader}>
            <div>
              <span className={styles.label}>실시간 봇 텔레메트리</span>
              <h2 id="live-bot-title">BTCUSDT 현재 상태</h2>
            </div>
            <span className={`${styles.connectionBadge} ${styles[(liveFeed?.connection ?? 'OFFLINE').toLowerCase()]}`}>
              <span className={styles.liveDot} aria-hidden="true" />
              {displayConnection(liveFeed?.connection ?? 'OFFLINE')}
            </span>
          </div>

          {telemetryError ? <p className={styles.telemetryError}>{telemetryError}</p> : null}

          <section className={styles.timeSyncPanel} aria-labelledby="time-sync-title">
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.label}>CANONICAL PRICE TIMELINE</span>
                <h3 id="time-sync-title">가격 · AI 시그널 시간 동기화</h3>
                <p className={styles.timelineCaption}>
                  {bucketMinutes}분 단위 / {rangeCaption} — 가격과 AI 시그널 같은 timestamp 기준
                </p>
              </div>
              <div className={styles.timelineControls}>
                <div className={styles.timeframeButtons} aria-label="시간 단위 선택">
                  {TIMEFRAME_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option}
                      className={activeTimeframe === option ? styles.activeTimeframe : undefined}
                      aria-pressed={activeTimeframe === option}
                      disabled={range === '7d' && option !== '15m'}
                      onClick={() => selectTimeframe(option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <div className={styles.rangeButtons} aria-label="과거 조회 기간 선택">
                  {RANGE_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      className={activeRange === option.value ? styles.activeRange : undefined}
                      aria-pressed={activeRange === option.value}
                      onClick={() => selectRange(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {activeRange === '7d' ? (
              <p className={styles.fixedTimeframeNotice}>7D 과거 보기는 15분 단위로 표시됩니다.</p>
            ) : null}

            <dl className={styles.syncMetricGrid}>
              <div><dt>선택 시간봉</dt><dd>{activeTimeframe}</dd></div>
              <div><dt>조회 기간</dt><dd>{rangeCaption}</dd></div>
              <div><dt>현재 AI 결정</dt><dd>{liveFeed?.decision ?? bot?.current_signal ?? '—'}</dd></div>
              <div><dt>모바일 주문 후보</dt><dd>{liveFeed?.mobile_order_candidate ?? status}</dd></div>
              <div><dt>최신 실시간 가격</dt><dd>{displayTime(liveFeed?.latest_price_ts)}</dd></div>
              <div><dt>AI signal 시간</dt><dd>{displayTime(liveFeed?.latest_signal_ts)}</dd></div>
              <div><dt>시그널 지연</dt><dd>{liveFeed?.signal_age_label ?? displayAge(liveFeed?.signal_age_sec)}</dd></div>
              <div><dt>signal stale (실시간 기준)</dt><dd>{liveFeed?.signal_stale ? 'true' : 'false'}</dd></div>
              <div><dt>price stale (실시간 기준)</dt><dd>{liveFeed?.price_stale ? 'true' : 'false'}</dd></div>
              <div><dt>real signal age</dt><dd>{displayAge(liveFeed?.real_signal_age_sec ?? undefined)}</dd></div>
              <div><dt>real price age</dt><dd>{displayAge(liveFeed?.real_price_age_sec ?? undefined)}</dd></div>
              <div><dt>signal fresh / stale 기준</dt><dd>{displayAge(liveFeed?.signal_fresh_after_sec)} / {displayAge(liveFeed?.signal_stale_after_sec)}</dd></div>
              <div><dt>server now</dt><dd>{displayTime(liveFeed?.server_now_ts)}</dd></div>
              <div><dt>총 / 현재 표시</dt><dd>{alignedChart.length} / {visibleSeries.length}개</dd></div>
            </dl>

            <div className={`${styles.syncVerdict} ${isRealtimeUnsafe ? styles.syncStale : styles.syncFresh}`} role="status">
              {isRealtimeUnsafe
                ? `${displayConnection(liveFeed?.connection ?? 'OFFLINE')} · 실시간 signal age ${displayAge(liveFeed?.real_signal_age_sec ?? undefined)}`
                : liveFeed?.signal_cycle_state === 'FRESH_PENDING_CANDLE'
                  ? `실시간 연결 정상 · 다음 ${bucketMinutes}분봉 확정 대기`
                  : `실시간 연결 정상 · 같은 ${bucketMinutes}분 timestamp 기준 as-of join 완료`}
            </div>

            <div className={styles.signalComparison} aria-label="확정 AI 신호와 실시간 예비 신호 비교">
              <article className={styles.confirmedSignalCard}>
                <header>
                  <div>
                    <span className={styles.label}>CONFIRMED 15M AI</span>
                    <h4>확정 AI 신호</h4>
                  </div>
                  <strong>{confirmedSignal?.decision ?? 'NO_SIGNAL'}</strong>
                </header>
                <p>{displayTime(confirmedSignal?.ts)} · age {displayAge(confirmedSignal?.age_sec ?? undefined)}</p>
                <div className={styles.signalProbabilityRow}>
                  <span>LONG {safePercent(confirmedSignal?.long_pct).toFixed(1)}%</span>
                  <span>SHORT {safePercent(confirmedSignal?.short_pct).toFixed(1)}%</span>
                  <span>WAIT {safePercent(confirmedSignal?.wait_pct).toFixed(1)}%</span>
                  <span>HC {Number(confirmedSignal?.hc ?? 0).toFixed(4)}</span>
                </div>
                <small>{confirmedSignal?.status ?? 'OFFLINE'} · 확정 신호만 후보 조건 판정에 사용</small>
              </article>

              <article className={styles.previewSignalCard}>
                <header>
                  <div>
                    <span className={styles.label}>LIVE PRICE PREVIEW</span>
                    <h4>실시간 예비 신호</h4>
                  </div>
                  <strong>{previewSignal?.decision ?? 'NO_SIGNAL'}</strong>
                </header>
                <p>{displayTime(previewSignal?.ts)} · age {displayAge(previewSignal?.age_sec ?? undefined)} · 참고용</p>
                <div className={styles.signalProbabilityRow}>
                  <span>LONG {safePercent(previewSignal?.long_pct).toFixed(1)}%</span>
                  <span>SHORT {safePercent(previewSignal?.short_pct).toFixed(1)}%</span>
                  <span>WAIT {safePercent(previewSignal?.wait_pct).toFixed(1)}%</span>
                  <span>CONF {safePercent(previewSignal?.confidence_pct).toFixed(1)}%</span>
                </div>
                <small>{previewSignal?.note ?? '진행 중인 봉 기준 예비 신호이며 주문에 사용하지 않음'}</small>
              </article>
            </div>

            <div className={styles.previewSafetyNotice} role="note">
              주문 후보: {liveFeed?.mobile_order_candidate === 'LONG' || liveFeed?.mobile_order_candidate === 'SHORT'
                ? `${liveFeed.mobile_order_candidate} — 확정 신호 기준`
                : '없음'} · 예비 신호는 주문 불가
            </div>

            <div className={styles.historyNavigator} aria-label="가격 및 AI 차트 공통 표시 구간 이동">
              <div className={styles.navigatorActions}>
                <button type="button" disabled={!canMovePrevious} onClick={() => moveViewWindow(-1)}>
                  ◀ 이전 24H
                </button>
                <button type="button" disabled={!canMoveNext} onClick={moveViewWindowToLatest}>
                  최신
                </button>
                <button type="button" disabled={!canMoveNext} onClick={() => moveViewWindow(1)}>
                  다음 24H ▶
                </button>
              </div>
              <span>
                표시 구간 {displayTime(displayedStart)} ~ {displayTime(displayedEnd)}
                <small>가격·AI 차트에 동일한 96개 구간 적용</small>
              </span>
            </div>

            {!signalHistoryAvailable || signalHistoryNote ? (
              <div className={styles.historyNotice} role="note">
                {signalHistoryNote ||
                  '이 구간은 과거 AI 시그널 기록이 없어 가격만 표시됩니다. 앞으로는 15분 단위 AI 시그널 히스토리를 저장합니다.'}
              </div>
            ) : null}
          </section>

          <section className={styles.readinessBoard} aria-labelledby="readiness-title">
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.label}>DISPLAY ANALYSIS ONLY</span>
                <h3 id="readiness-title">실시간 매매 신호 준비도</h3>
              </div>
              <span>실주문 DISABLED</span>
            </div>

            <div className={styles.overallReadiness}>
              <div className={`${styles.overallScore} ${styles[readinessTone(readiness?.overall_trade_readiness_pct ?? 0)]}`}>
                <strong>{safePercent(readiness?.overall_trade_readiness_pct).toFixed(1)}%</strong>
                <span>{readinessBand(readiness?.overall_trade_readiness_pct ?? 0)}</span>
              </div>
              <div className={styles.overallCopy}>
                <span>전체 주문 가능성</span>
                <p>{readiness?.note ?? '봇 조건 충족률을 계산하는 중입니다.'}</p>
                <small>마지막 업데이트 {displayTime(liveFeed?.generated_at)}</small>
              </div>
            </div>

            <div className={styles.readinessGrid}>
              <PercentBar label="LONG 준비도" pct={readiness?.long_probability_pct ?? 0} />
              <PercentBar label="SHORT 준비도" pct={readiness?.short_probability_pct ?? 0} detail="LONG_ONLY 정책에서는 표시만 합니다." />
              <PercentBar label="WAIT 확률" pct={readiness?.wait_probability_pct ?? 0} />
              <PercentBar
                label="HC70 readiness"
                pct={readiness?.hc070_ready_pct ?? readiness?.hc_ready_pct ?? 0}
                detail={readiness ? `${readiness.hc_current.toFixed(4)} / 0.70` : '—'}
              />
              <PercentBar label="HC085 readiness" pct={readiness?.hc085_ready_pct ?? 0} detail={readiness ? `${readiness.hc_current.toFixed(4)} / 0.85` : '—'} />
              <PercentBar label="HC090 readiness" pct={readiness?.hc090_ready_pct ?? 0} detail={readiness ? `${readiness.hc_current.toFixed(4)} / 0.90` : '—'} />
            </div>
            <div className={`${styles.alignmentMeta} ${isRealtimeUnsafe ? styles.staleSignal : styles.freshSignal}`}>
              <span>마지막 AI signal <strong>{displayTime(liveFeed?.latest_signal_ts)}</strong></span>
              <span>실시간 Signal age <strong>{displayAge(liveFeed?.real_signal_age_sec ?? undefined)}</strong></span>
              <span>{displayConnection(liveFeed?.connection ?? 'OFFLINE')}</span>
            </div>
          </section>

          <dl className={styles.metricGrid}>
            <div><dt>운영 모드</dt><dd>{bot?.mode ?? '확인 중'}</dd></div>
            <div>
              <dt>현재 시그널</dt>
              <dd className={
                bot?.current_signal === 'LONG'
                  ? styles.signalLong
                  : bot?.current_signal === 'SHORT'
                    ? styles.signalBlocked
                    : styles.signalWait
              }>
                {bot?.current_signal ?? '—'}
              </dd>
            </div>
            <div><dt>모델 HC / 기준</dt><dd>{bot ? `${bot.current_hc.toFixed(4)} / ${bot.hc_threshold.toFixed(2)}` : '—'}</dd></div>
            <div><dt>Bitget 중간가</dt><dd>{displayNumber(latestMarket?.mid)}</dd></div>
            <div><dt>포지션</dt><dd>{bot ? `${bot.open_position_count}개` : '—'}</dd></div>
            <div><dt>실제 주문</dt><dd>{bot ? `${bot.real_orders_placed}건` : '—'}</dd></div>
          </dl>

          <p className={styles.liveReason}>
            <strong>{bot?.last_decision ?? '상태 확인 중'}</strong>
            <span>{displayReason(bot?.last_reason)}</span>
          </p>

          <section className={styles.candidateSection} aria-labelledby="candidate-readiness-title">
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.label}>BOT CANDIDATES</span>
                <h3 id="candidate-readiness-title">후보별 준비도</h3>
              </div>
              <span>{candidates.length}개 후보</span>
            </div>

            <div className={styles.candidateGrid}>
              {candidates.map((candidate) => (
                <article className={`${styles.candidateCard} ${styles[candidate.status.toLowerCase()]}`} key={candidate.id}>
                  <header>
                    <div>
                      <h4>{candidate.name}</h4>
                      <span className={styles.candidateStatus}>{candidate.status}</span>
                    </div>
                    <strong>{safePercent(candidate.readiness_pct).toFixed(1)}%</strong>
                  </header>

                  {typeof candidate.hc === 'number' && typeof candidate.threshold === 'number' ? (
                    <p className={styles.candidateMeta}>HC {candidate.hc.toFixed(4)} / {candidate.threshold.toFixed(2)}</p>
                  ) : null}
                  {typeof candidate.current_price === 'number' && typeof candidate.entry_level === 'number' ? (
                    <p className={styles.candidateMeta}>
                      현재 {displayNumber(candidate.current_price)} · Entry {displayNumber(candidate.entry_level)}
                    </p>
                  ) : null}

                  <div className={styles.conditionList}>
                    {candidate.conditions.map((condition) => (
                      <PercentBar key={condition.key} label={condition.label} pct={condition.pct} />
                    ))}
                  </div>

                  <div className={styles.blockerTags}>
                    {candidate.blocked_reasons.length ? candidate.blocked_reasons.map((reason) => (
                      <span key={reason}>{displayBlocker(reason)}</span>
                    )) : <span className={styles.clearTag}>현재 후보 조건 충족</span>}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.blockerSection} aria-labelledby="blocker-title">
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.label}>WHY NO SIGNAL?</span>
                <h3 id="blocker-title">진입 차단 이유 분석</h3>
              </div>
              <span>100%에 가까울수록 조건 충족</span>
            </div>
            <div className={styles.blockerList}>
              {blockers.map((blocker) => (
                <PercentBar
                  key={blocker.key}
                  label={blocker.label}
                  pct={blocker.pct}
                  detail={`${blocker.detail} · 부족 ${safePercent(blocker.missing_pct).toFixed(1)}%`}
                />
              ))}
            </div>
          </section>

          <div className={styles.chartSection}>
            <div className={styles.chartHeader}>
              <div>
                <h3>Bitget 가격 ({bucketMinutes}m · {rangeCaption})</h3>
                <p>Bitget public 캔들 {bucketMinutes}분 OHLC · 아래 AI 확률 차트와 동일 timestamp 배열</p>
              </div>
              <span>{displayTime(liveFeed?.latest_price_ts ?? latestMarket?.timestamp)}</span>
            </div>
            <div className={styles.priceLevelGrid} aria-label="현재 가격 및 진입·익절·손절 기준">
              <span className={styles.levelCurrent}>현재가 <strong>{displayNumber(currentPrice)}</strong></span>
              <span className={styles.levelEntry}>Entry <strong>{displayNumber(entryPrice)}</strong></span>
              <span className={styles.levelTp}>TP <strong>{displayNumber(takeProfitPrice)}</strong></span>
              <span className={styles.levelSl}>SL <strong>{displayNumber(stopLossPrice)}</strong></span>
              <span className={styles.levelThreshold}>Threshold <strong>{displayNumber(thresholdPrice)}</strong></span>
              <span>24h H/L <strong>{displayNumber(priceLevels?.high_24h)} / {displayNumber(priceLevels?.low_24h)}</strong></span>
            </div>
            <div className={styles.chartCanvas} role="img" aria-label="BTCUSDT 실시간 가격 그래프">
              {chartReady && visibleSeries.length ? (
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  minWidth={0}
                  minHeight={0}
                  initialDimension={CHART_INITIAL_DIMENSION}
                >
                  <LineChart
                    data={visibleSeries}
                    margin={{ top: 12, right: 12, bottom: 2, left: 4 }}
                    syncId={CHART_SYNC_ID}
                  >
                    <CartesianGrid stroke="rgba(148, 163, 184, 0.13)" strokeDasharray="4 4" vertical={false} />
                    <XAxis
                      dataKey="x"
                      type="number"
                      scale="time"
                      domain={sharedXDomain}
                      allowDataOverflow
                      stroke="#64748b"
                      tick={{ fontSize: 10 }}
                      minTickGap={48}
                      tickFormatter={(value) => chartTime(new Date(Number(value)).toISOString())}
                    />
                    <YAxis
                      domain={['auto', 'auto']}
                      stroke="#64748b"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(value) => Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      width={62}
                    />
                    <Tooltip
                      contentStyle={{ background: '#0b1915', border: '1px solid #24473b', borderRadius: 10 }}
                      labelFormatter={(value) => chartTime(new Date(Number(value)).toISOString())}
                      formatter={(value, name) => [displayNumber(Number(value)), String(name).toUpperCase()]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {Number.isFinite(latestSignalX) && latestSignalX >= sharedXDomain[0] && latestSignalX <= sharedXDomain[1] ? (
                      <ReferenceLine
                        x={latestSignalX}
                        stroke="#c4b5fd"
                        strokeDasharray="3 4"
                        label={{ value: 'LAST AI SIGNAL', fill: '#c4b5fd', fontSize: 9, position: 'insideTopRight' }}
                      />
                    ) : null}
                    {currentPrice !== null ? (
                      <ReferenceLine
                        y={currentPrice}
                        stroke="#4ade80"
                        strokeDasharray="2 3"
                        ifOverflow="discard"
                        label={{ value: '현재가', fill: '#86efac', fontSize: 9, position: 'insideTopRight' }}
                      />
                    ) : null}
                    {entryPrice !== null ? (
                      <ReferenceLine
                        y={entryPrice}
                        stroke="#facc15"
                        strokeDasharray="5 5"
                        ifOverflow="discard"
                        label={{ value: 'ENTRY', fill: '#fde047', fontSize: 9, position: 'insideBottomLeft' }}
                      />
                    ) : null}
                    {takeProfitPrice !== null ? (
                      <ReferenceLine
                        y={takeProfitPrice}
                        stroke="#22c55e"
                        strokeDasharray="4 4"
                        ifOverflow="discard"
                        label={{ value: 'TP', fill: '#4ade80', fontSize: 9, position: 'insideTopLeft' }}
                      />
                    ) : null}
                    {stopLossPrice !== null ? (
                      <ReferenceLine
                        y={stopLossPrice}
                        stroke="#fb7185"
                        strokeDasharray="4 4"
                        ifOverflow="discard"
                        label={{ value: 'SL', fill: '#fda4af', fontSize: 9, position: 'insideBottomLeft' }}
                      />
                    ) : null}
                    {thresholdPrice !== null ? (
                      <ReferenceLine
                        y={thresholdPrice}
                        stroke="#a78bfa"
                        strokeDasharray="6 4"
                        ifOverflow="discard"
                        label={{ value: 'THRESHOLD', fill: '#c4b5fd', fontSize: 9, position: 'insideTopLeft' }}
                      />
                    ) : null}
                    <Line type="monotone" dataKey="bid" name="Bid" stroke="#38bdf8" dot={false} strokeWidth={1} isAnimationActive={false} />
                    <Line type="monotone" dataKey="price" name="Mid" stroke="#4ade80" dot={false} strokeWidth={2.2} isAnimationActive={false} />
                    <Line type="monotone" dataKey="ask" name="Ask" stroke="#fb7185" dot={false} strokeWidth={1} isAnimationActive={false} />
                    <Line dataKey="ready_marker_price" name="READY" stroke="transparent" dot={{ r: 4, fill: '#22c55e', stroke: '#dcfce7', strokeWidth: 1 }} isAnimationActive={false} />
                    <Line dataKey="wait_marker_price" name="WAIT marker" stroke="transparent" dot={{ r: 4, fill: '#facc15', stroke: '#fef9c3', strokeWidth: 1 }} isAnimationActive={false} />
                    <Line dataKey="blocked_marker_price" name="BLOCKED" stroke="transparent" dot={{ r: 4, fill: '#fb7185', stroke: '#ffe4e6', strokeWidth: 1 }} isAnimationActive={false} />
                    <Line
                      dataKey="preview_marker_price"
                      name="LIVE PREVIEW"
                      stroke="transparent"
                      dot={{ r: 6, fill: '#22d3ee', stroke: '#cffafe', strokeWidth: 2 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className={styles.chartEmpty}>실시간 가격 데이터를 기다리는 중입니다.</div>
              )}
            </div>
          </div>

          <div className={styles.chartSection}>
            <div className={styles.chartHeader}>
              <div>
                <h3>AI 시그널 확률 ({bucketMinutes}m · {rangeCaption})</h3>
                <p>위 가격과 같은 {bucketMinutes}분 timestamp · T 이하 최근 신호 as-of join</p>
              </div>
              <span>동일 구간 {visibleSeries.length}개 {bucketMinutes}m bucket</span>
            </div>
            <div className={styles.chartCanvas} role="img" aria-label="AI 매매 시그널 확률 그래프">
              {chartReady && visibleSeries.length ? (
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  minWidth={0}
                  minHeight={0}
                  initialDimension={CHART_INITIAL_DIMENSION}
                >
                  <LineChart
                    data={visibleSeries}
                    margin={{ top: 12, right: 12, bottom: 2, left: 4 }}
                    syncId={CHART_SYNC_ID}
                  >
                    <CartesianGrid stroke="rgba(148, 163, 184, 0.13)" strokeDasharray="4 4" vertical={false} />
                    <XAxis
                      dataKey="x"
                      type="number"
                      scale="time"
                      domain={sharedXDomain}
                      allowDataOverflow
                      stroke="#64748b"
                      tick={{ fontSize: 10 }}
                      minTickGap={48}
                      tickFormatter={(value) => chartTime(new Date(Number(value)).toISOString())}
                    />
                    <YAxis
                      domain={[0, 100]}
                      stroke="#64748b"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(value) => `${Math.round(Number(value))}%`}
                      width={42}
                    />
                    <Tooltip content={<AiSignalTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine y={70} stroke="#facc15" strokeDasharray="5 5" label={{ value: 'HC70', fill: '#fde047', fontSize: 9, position: 'insideLeft' }} />
                    <ReferenceLine y={85} stroke="#fb923c" strokeDasharray="4 4" label={{ value: 'HC85', fill: '#fdba74', fontSize: 9, position: 'insideLeft' }} />
                    <ReferenceLine y={90} stroke="#fb7185" strokeDasharray="3 4" label={{ value: 'HC90', fill: '#fda4af', fontSize: 9, position: 'insideLeft' }} />
                    <Line type="stepAfter" dataKey="long_live" name="LONG" stroke="#4ade80" dot={false} strokeWidth={2} isAnimationActive={false} />
                    <Line type="stepAfter" dataKey="short_live" name="SHORT" stroke="#fb7185" dot={false} strokeWidth={2} isAnimationActive={false} />
                    <Line type="stepAfter" dataKey="wait_live" name="WAIT" stroke="#facc15" dot={false} strokeWidth={2} isAnimationActive={false} />
                    <Line type="stepAfter" dataKey="hc_live" name="HC" stroke="#a78bfa" dot={false} strokeWidth={1.5} strokeDasharray="3 3" isAnimationActive={false} />
                    <Line type="stepAfter" dataKey="long_stale" name="LONG stale" stroke="#94a3b8" dot={false} strokeWidth={1.5} strokeDasharray="5 5" legendType="none" isAnimationActive={false} />
                    <Line type="stepAfter" dataKey="short_stale" name="SHORT stale" stroke="#64748b" dot={false} strokeWidth={1.5} strokeDasharray="5 5" legendType="none" isAnimationActive={false} />
                    <Line type="stepAfter" dataKey="wait_stale" name="WAIT stale" stroke="#cbd5e1" dot={false} strokeWidth={1.5} strokeDasharray="5 5" legendType="none" isAnimationActive={false} />
                    <Line type="stepAfter" dataKey="hc_stale" name="HC stale" stroke="#475569" dot={false} strokeWidth={1.5} strokeDasharray="3 5" legendType="none" isAnimationActive={false} />
                    <Line dataKey="preview_long_pct" name="Preview LONG" stroke="transparent" dot={{ r: 5, fill: '#22d3ee', stroke: '#cffafe', strokeWidth: 1 }} legendType="none" isAnimationActive={false} />
                    <Line dataKey="preview_short_pct" name="Preview SHORT" stroke="transparent" dot={{ r: 5, fill: '#f472b6', stroke: '#fce7f3', strokeWidth: 1 }} legendType="none" isAnimationActive={false} />
                    <Line dataKey="preview_wait_pct" name="Preview WAIT" stroke="transparent" dot={{ r: 5, fill: '#facc15', stroke: '#fef9c3', strokeWidth: 1 }} legendType="none" isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className={styles.chartEmpty}>모델 시그널 이력을 기다리는 중입니다.</div>
              )}
            </div>
          </div>

          <p className={styles.feedNote}>
            화면은 5초마다 확인합니다. 마지막 AI signal: {displayTime(liveFeed?.latest_signal_ts)} · 실시간 age {displayAge(liveFeed?.real_signal_age_sec ?? undefined)} · 주문 후보 {liveFeed?.mobile_order_candidate ?? status}
          </p>
        </section>

        <section className={styles.statusCard} aria-live="polite" aria-busy={loading}>
          <div className={styles.statusHeader}>
            <div>
              <span className={styles.label}>모바일 주문 후보</span>
              <strong className={`${styles.status} ${styles[status.toLowerCase()]}`}>{status}</strong>
            </div>
            <div className={styles.polling}>
              <span className={styles.liveDot} aria-hidden="true" />
              5초마다 화면 갱신
            </div>
          </div>

          {signal.message ? <p className={styles.message}>{signal.message}</p> : null}

          {status === 'READY' ? (
            <div className={styles.readyCallout} role="status">
              <strong>BUY READY</strong>
              <span>표시 신호입니다. 주문 버튼이 아니며 실제 주문은 사용자가 직접 실행합니다.</span>
            </div>
          ) : null}

          {status === 'WAIT' || status === 'BLOCKED' || status === 'BLOCKED_STALE' || status === 'NO_SIGNAL' ? (
            <div className={styles.orderProhibited} role="alert">
              주문 금지
            </div>
          ) : null}

          {status !== 'NO_SIGNAL' ? (
            <dl className={styles.signalGrid}>
              <div><dt>Symbol</dt><dd>{signal.symbol ?? '—'}</dd></div>
              <div><dt>Side</dt><dd>{signal.side ?? '—'}</dd></div>
              <div><dt>Margin (USDT)</dt><dd>{displayNumber(signal.recommended_margin_usdt)}</dd></div>
              <div><dt>Leverage</dt><dd>{signal.leverage ? `${displayNumber(signal.leverage)}x` : '—'}</dd></div>
              <div><dt>Limit</dt><dd>{displayNumber(signal.suggested_limit_price)}</dd></div>
              <div><dt>Take profit</dt><dd>{displayNumber(signal.take_profit_price)}</dd></div>
              <div><dt>Stop loss</dt><dd>{displayNumber(signal.stop_loss_price)}</dd></div>
              <div><dt>Expires</dt><dd>{displayTime(signal.expires_at)}</dd></div>
            </dl>
          ) : null}

          {signal.reason ? (
            <div className={styles.reason}>
              <span className={styles.label}>판단 근거</span>
              <p>{signal.reason}</p>
            </div>
          ) : null}

          {signal.blocked_reasons?.length ? (
            <div className={styles.reason}>
              <span className={styles.label}>차단 사유</span>
              <ul>{signal.blocked_reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            </div>
          ) : null}

          <p className={styles.checkedAt}>
            마지막 확인: {lastCheckedAt ? lastCheckedAt.toLocaleTimeString('ko-KR') : '확인 중…'}
          </p>
        </section>

        <section className={styles.checklist} aria-labelledby="manual-order-checklist">
          <h2 id="manual-order-checklist">Bitget 수동 주문 체크리스트</h2>
          <ol>
            <li>현재 상태가 READY인지 다시 확인합니다.</li>
            <li>Bitget에서 심볼·방향·마진·레버리지를 직접 대조합니다.</li>
            <li>진입가·익절가·손절가와 신호 만료 시간을 확인합니다.</li>
            <li>최종 주문 내용과 위험을 사용자가 판단한 뒤 직접 입력합니다.</li>
          </ol>
          <p>EDENCLAW는 주문을 전송하거나 주문 화면을 대신 조작하지 않습니다.</p>
        </section>

        <footer className={styles.footer}>
          <span>BOT ORDER EXECUTION: DISABLED</span>
          <span>REAL ORDER SENT BY BOT: FALSE</span>
        </footer>
      </section>
    </main>
  );
}
