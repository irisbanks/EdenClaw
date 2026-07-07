import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fetchBitgetPublicCandles, type PublicCandle } from '@/lib/mobileSignal/bitgetPublicCandles';
import { RESEARCH_CANDIDATE_SNAPSHOT } from '@/lib/mobileSignal/researchCandidate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MARKET_POINTS = 120;
const MAX_ALIGNED_POINTS = 672;
// Raw ticks kept for 15m/30m resampling. The public collector writes a snapshot
// roughly every 30s, so ~2000 ticks covers more than 12h — enough to fill 48
// fifteen-minute buckets on the shared timeline.
const MAX_RAW_MARKET_POINTS = 2400;
const RAW_MARKET_TAIL_BYTES = 512 * 1024;
// 7d of 15m AI signals (672) plus duplicate rows in the source CSV; keep a wide
// window so the historical as-of join has every signal in range.
const MAX_SIGNAL_POINTS = 1500;
const SIGNAL_TAIL_BYTES = 512 * 1024;
const ONLINE_AFTER_MS = 90_000;
const STALE_AFTER_MS = 10 * 60_000;

// Wall-clock realtime freshness gates. These are intentionally independent of
// the selected chart timeframe / historical as-of join math: a stale bridge
// or a stopped market collector must be flagged as STALE/OFFLINE regardless
// of which candle bucket size the user is viewing.
const REALTIME_PRICE_STALE_AFTER_SEC = 2 * 60;

// Historical lookback ranges selectable on the mobile screen. The number is the
// count of 15m buckets shown (1h=4, 6h=24, 24h=96, 7d=672). Default = 24h.
const RANGE_POINTS = {
  '1h': 4,
  '6h': 24,
  '24h': 96,
  '7d': 672,
} as const;
type RangeKey = keyof typeof RANGE_POINTS;

const TIMEFRAME_STALE_SECONDS = {
  '5m': 900,
  '15m': 2100,
  '30m': 3900,
} as const;

// The shared price/AI timeline is resampled to these fixed bucket widths so the
// upper price chart and the lower AI probability chart consume one identical
// time_aligned_series. Default view is 15m.
const TIMEFRAME_BUCKET_SECONDS = {
  '5m': 300,
  '15m': 900,
  '30m': 1800,
} as const;

type SourceConnectionState = 'ONLINE' | 'STALE' | 'OFFLINE';
type ConnectionState = 'FRESH' | 'DELAYED' | 'STALE' | 'OFFLINE';
type CandidateStatus = 'READY' | 'WAIT' | 'BLOCKED' | 'STALE';
type Timeframe = keyof typeof TIMEFRAME_STALE_SECONDS;
type JsonRecord = Record<string, unknown>;

let telemetryTableReady: Promise<void> | null = null;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function roundPercent(value: number): number {
  return Math.round(clampPercent(value) * 100) / 100;
}

function thresholdReadiness(current: number, target: number): number {
  if (target <= 0) return 0;
  return roundPercent((current / target) * 100);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseTimeframe(req: NextRequest): Timeframe {
  const value = req.nextUrl.searchParams.get('tf');
  // Default display timeframe is fixed to 15m.
  return value === '5m' || value === '30m' ? value : '15m';
}

function parseRange(req: NextRequest): RangeKey {
  const value = req.nextUrl.searchParams.get('range');
  // Default historical range is 24h.
  return value === '1h' || value === '6h' || value === '7d' ? value : '24h';
}

function signalAgeLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '알 수 없음';
  if (seconds < 60) return `${Math.round(seconds)}초`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return remainingSeconds > 0 ? `${minutes}분 ${remainingSeconds}초` : `${minutes}분`;
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isTelemetryPublisherAuthorized(req: NextRequest): boolean {
  const expected = process.env.EDEN_MOBILE_TELEMETRY_SECRET?.trim();
  if (!expected) return false;
  const bearer = req.headers.get('authorization');
  if (bearer?.startsWith('Bearer ') && timingSafeEqual(bearer.slice(7).trim(), expected)) return true;
  const header = req.headers.get('x-eden-telemetry-secret');
  return Boolean(header && timingSafeEqual(header.trim(), expected));
}

function containsSensitiveKey(value: unknown, depth = 0): boolean {
  if (depth > 12) return true;
  if (Array.isArray(value)) return value.some((item) => containsSensitiveKey(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => {
    if (/api[_-]?key|secret|passphrase|authorization|private[_-]?key/i.test(key)) return true;
    return containsSensitiveKey(child, depth + 1);
  });
}

function sanitizeTelemetryPayload(input: JsonRecord): JsonRecord {
  const bot = asRecord(input.bot);
  const market = asRecord(input.market);
  const marketPoints = Array.isArray(market.points) ? market.points.slice(-MAX_MARKET_POINTS) : [];
  const signalHistory = Array.isArray(input.signal_history)
    ? input.signal_history.slice(-MAX_SIGNAL_POINTS)
    : [];
  const alignedSeries = Array.isArray(input.time_aligned_series)
    ? input.time_aligned_series.slice(-MAX_ALIGNED_POINTS)
    : [];
  const blockers = Array.isArray(input.blocker_breakdown) ? input.blocker_breakdown.slice(0, 24) : [];

  return {
    generated_at: asString(input.generated_at, new Date().toISOString()),
    connection: asString(input.connection, 'OFFLINE'),
    timeframe: asString(input.timeframe, '5m'),
    current_price: asNumber(input.current_price),
    decision: asString(input.decision, 'WAIT'),
    hc: asNumber(input.hc),
    latest_signal_ts: asString(input.latest_signal_ts),
    latest_price_ts: asString(input.latest_price_ts),
    signal_age_sec: asNumber(input.signal_age_sec),
    signal_age_label: asString(input.signal_age_label),
    signal_stale: input.signal_stale === true,
    overall_trade_readiness_pct: asNumber(input.overall_trade_readiness_pct),
    long_probability_pct: asNumber(input.long_probability_pct),
    short_probability_pct: asNumber(input.short_probability_pct),
    wait_probability_pct: asNumber(input.wait_probability_pct),
    hc_ready_pct: asNumber(input.hc_ready_pct),
    readiness: asRecord(input.readiness),
    bots: asRecord(input.bots),
    blocker_breakdown: blockers,
    price_levels: asRecord(input.price_levels),
    bot: {
      ...bot,
      live_trading_enabled: false,
      real_orders_placed: 0,
    },
    market: {
      ...market,
      points: marketPoints,
    },
    signal_history: signalHistory,
    time_aligned_series: alignedSeries,
    bot_order_execution: 'DISABLED',
    real_order_sent_by_bot: false,
    user_must_place_order_manually: true,
    safety: {
      bot_order_execution: 'DISABLED',
      real_order_sent_by_bot: false,
      user_must_place_order_manually: true,
    },
  };
}

async function ensureTelemetryTable(): Promise<void> {
  if (!telemetryTableReady) {
    telemetryTableReady = prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS eden_mobile_signal_telemetry (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => undefined).catch((error) => {
      telemetryTableReady = null;
      throw error;
    });
  }
  await telemetryTableReady;
}

async function saveStoredTelemetry(payload: JsonRecord): Promise<void> {
  await ensureTelemetryTable();
  await prisma.$executeRawUnsafe(
    `INSERT INTO eden_mobile_signal_telemetry (id, payload, updated_at)
     VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
    JSON.stringify(payload),
  );
}

async function loadStoredTelemetry(): Promise<{ payload: JsonRecord; updatedAt: Date } | null> {
  await ensureTelemetryTable();
  const rows = await prisma.$queryRawUnsafe<Array<{ payload: unknown; updated_at: Date }>>(
    'SELECT payload, updated_at FROM eden_mobile_signal_telemetry WHERE id = 1 LIMIT 1',
  );
  const row = rows[0];
  if (!row || !isRecord(row.payload)) return null;
  return { payload: row.payload, updatedAt: new Date(row.updated_at) };
}

// ---------------------------------------------------------------------------
// Mobile signal history (forward accumulation). One row per 15m bucket so the
// table stays bounded; the latest still-forming bucket is upserted each poll.
// Stores readiness/probability snapshots only — never any order or credential.
// ---------------------------------------------------------------------------
let signalHistoryTableReady: Promise<void> | null = null;

async function ensureSignalHistoryTable(): Promise<void> {
  if (!signalHistoryTableReady) {
    signalHistoryTableReady = prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS eden_mobile_signal_history (
        bucket_ts TIMESTAMPTZ PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => undefined).catch((error) => {
      signalHistoryTableReady = null;
      throw error;
    });
  }
  await signalHistoryTableReady;
}

async function saveSignalHistoryRow(bucketTs: string, payload: JsonRecord): Promise<void> {
  const parsed = new Date(bucketTs);
  if (Number.isNaN(parsed.getTime())) return;
  await ensureSignalHistoryTable();
  await prisma.$executeRawUnsafe(
    `INSERT INTO eden_mobile_signal_history (bucket_ts, payload, updated_at)
     VALUES ($1::timestamptz, $2::jsonb, NOW())
     ON CONFLICT (bucket_ts) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
    parsed.toISOString(),
    JSON.stringify(payload),
  );
}

async function loadSignalHistorySince(sinceMs: number): Promise<JsonRecord[]> {
  await ensureSignalHistoryTable();
  const rows = await prisma.$queryRawUnsafe<Array<{ payload: unknown }>>(
    `SELECT payload FROM eden_mobile_signal_history
     WHERE bucket_ts >= $1::timestamptz
     ORDER BY bucket_ts ASC`,
    new Date(sinceMs).toISOString(),
  );
  return rows.map((row) => row.payload).filter(isRecord);
}

function connectionState(
  updatedAt: string,
  onlineAfterMs = ONLINE_AFTER_MS,
  staleAfterMs = STALE_AFTER_MS,
): SourceConnectionState {
  const timestamp = new Date(updatedAt).getTime();
  if (!Number.isFinite(timestamp)) return 'OFFLINE';
  const age = Date.now() - timestamp;
  if (age <= onlineAfterMs) return 'ONLINE';
  if (age <= staleAfterMs) return 'STALE';
  return 'OFFLINE';
}

function oldestConnection(...states: SourceConnectionState[]): SourceConnectionState {
  if (states.includes('OFFLINE')) return 'OFFLINE';
  if (states.includes('STALE')) return 'STALE';
  return 'ONLINE';
}

// Real wall-clock age in seconds, always measured against `nowMs` — never
// against a historical chart bucket's own end time. Returns null when the
// timestamp is missing or unparseable (treated as maximally stale by callers).
function computeRealAgeSec(nowMs: number, iso: string): number | null {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.round((nowMs - ms) / 1000)) : null;
}

function normalizeIso(value: string): string {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function newestTimestamp(...values: string[]): string {
  return values
    .map(normalizeIso)
    .filter(Boolean)
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())
    .at(-1) ?? '';
}

function normalizeDecision(value: unknown): 'LONG' | 'SHORT' | 'WAIT' | 'NO_SIGNAL' {
  if (value === 'LONG' || value === 'SHORT' || value === 'WAIT') return value;
  return 'NO_SIGNAL';
}

function realtimeSignalThresholds(timeframe: Timeframe): { fresh: number; stale: number } {
  if (timeframe === '5m') return { fresh: 420, stale: 900 };
  if (timeframe === '30m') return { fresh: 2100, stale: 3900 };
  return { fresh: 1080, stale: 2100 };
}

function normalizeProbabilityPercents(
  longPct: number,
  shortPct: number,
  waitPct: number,
): { longPct: number; shortPct: number; waitPct: number } {
  const values = [clampPercent(longPct), clampPercent(shortPct), clampPercent(waitPct)];
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return { longPct: 0, shortPct: 0, waitPct: 100 };
  const normalizedLong = roundPercent((values[0] / total) * 100);
  const normalizedShort = roundPercent((values[1] / total) * 100);
  return {
    longPct: normalizedLong,
    shortPct: normalizedShort,
    waitPct: roundPercent(100 - normalizedLong - normalizedShort),
  };
}

function buildLivePreviewSignal(
  payload: JsonRecord,
  latestPriceTs: string,
  realPriceAgeSec: number | null,
): JsonRecord {
  const series = Array.isArray(payload.time_aligned_series)
    ? payload.time_aligned_series.filter(isRecord)
    : [];
  const recent = series.slice(-8);
  const latestPoint = recent.at(-1) ?? {};
  const marketLatest = asRecord(asRecord(payload.market).latest);
  const currentPrice = asNumber(
    payload.current_price,
    asNumber(marketLatest.mid, asNumber(latestPoint.price, Number.NaN)),
  );
  const currentOpen = asNumber(latestPoint.open, asNumber(latestPoint.price, Number.NaN));
  const firstPrice = asNumber(recent[0]?.close, asNumber(recent[0]?.price, Number.NaN));
  const hasPrice = Number.isFinite(currentPrice) && currentPrice > 0;
  const intrabarReturnPct = hasPrice && Number.isFinite(currentOpen) && currentOpen > 0
    ? ((currentPrice - currentOpen) / currentOpen) * 100
    : 0;
  const slopeReturnPct = hasPrice && Number.isFinite(firstPrice) && firstPrice > 0
    ? ((currentPrice - firstPrice) / firstPrice) * 100
    : 0;
  // A deliberately small heuristic tilt around the confirmed model baseline.
  // This is market-momentum context, not a new model inference.
  const momentumAdjustment = Math.max(
    -12,
    Math.min(12, intrabarReturnPct * 10 + slopeReturnPct * 4),
  );
  const baseline = normalizeProbabilityPercents(
    asNumber(payload.long_probability_pct),
    asNumber(payload.short_probability_pct),
    asNumber(payload.wait_probability_pct),
  );
  const preview = normalizeProbabilityPercents(
    baseline.longPct + Math.max(0, momentumAdjustment),
    baseline.shortPct + Math.max(0, -momentumAdjustment),
    Math.max(0, baseline.waitPct - Math.abs(momentumAdjustment) * 0.35),
  );
  const decision = !hasPrice || !latestPriceTs
    ? 'NO_SIGNAL'
    : preview.longPct >= 40 && preview.longPct > preview.shortPct && preview.longPct > preview.waitPct
      ? 'LONG'
      : preview.shortPct >= 40 && preview.shortPct > preview.longPct && preview.shortPct > preview.waitPct
        ? 'SHORT'
        : 'WAIT';

  return {
    ts: latestPriceTs,
    age_sec: realPriceAgeSec,
    decision,
    confidence_pct: decision === 'LONG'
      ? preview.longPct
      : decision === 'SHORT'
        ? preview.shortPct
        : preview.waitPct,
    long_pct: preview.longPct,
    short_pct: preview.shortPct,
    wait_pct: preview.waitPct,
    source: 'LIVE_PRICE_PREVIEW',
    status: realPriceAgeSec === null
      ? 'OFFLINE'
      : realPriceAgeSec > REALTIME_PRICE_STALE_AFTER_SEC
        ? 'STALE'
        : 'FRESH',
    is_trade_eligible: false,
    intrabar_return_pct: Math.round(intrabarReturnPct * 10_000) / 10_000,
    recent_slope_pct: Math.round(slopeReturnPct * 10_000) / 10_000,
    note: '진행 중인 봉 기준 예비 신호이며 주문에 사용하지 않음',
  };
}

type LiveState = 'ACTIVE' | 'NO_SIGNAL' | 'BLOCKED_STALE';

// Overlays real-time freshness on top of an already-built response payload.
// Callers must pass the *raw* signal/price timestamps from the live source
// (the model's own signal row, the collector's own tick) — never the
// chart's bucket-aligned `latest_signal_ts` / `latest_price_ts`, which are
// only meaningful for the historical as-of join and carry an inherent
// bucket-width lag (e.g. up to 15 minutes on the 15m view) that would
// otherwise look like staleness even when the live feed is healthy.
function applyRealtimeFreshness(
  payload: JsonRecord,
  nowMs: number,
  baseConnection: SourceConnectionState,
  rawSignalTsIso: string,
  rawPriceTsIso: string,
  timeframe: Timeframe,
): JsonRecord {
  const latestSignalTs = normalizeIso(rawSignalTsIso);
  const latestPriceTs = normalizeIso(rawPriceTsIso);
  const realSignalAgeSec = computeRealAgeSec(nowMs, latestSignalTs);
  const realPriceAgeSec = computeRealAgeSec(nowMs, latestPriceTs);
  const signalThresholds = realtimeSignalThresholds(timeframe);
  const signalStale = realSignalAgeSec === null || realSignalAgeSec > signalThresholds.stale;
  const priceStale = realPriceAgeSec === null || realPriceAgeSec > REALTIME_PRICE_STALE_AFTER_SEC;
  const connection: ConnectionState =
    baseConnection === 'OFFLINE' || realSignalAgeSec === null || realPriceAgeSec === null
      ? 'OFFLINE'
      : signalStale || priceStale
        ? 'STALE'
        : realSignalAgeSec > signalThresholds.fresh || baseConnection === 'STALE'
          ? 'DELAYED'
          : 'FRESH';
  const decision = normalizeDecision(payload.decision);
  const unsafe = connection !== 'FRESH' || signalStale || priceStale;
  const sourceBot = asRecord(payload.bot);
  const overallReadinessPct = asNumber(
    payload.overall_trade_readiness_pct,
    asNumber(asRecord(payload.readiness).overall_trade_readiness_pct),
  );
  const confirmedConditionsMet =
    (decision === 'LONG' || decision === 'SHORT') && overallReadinessPct > 0;
  // NO_SIGNAL (live data alive, no trade candidate) vs STALE (data itself old)
  // are deliberately distinct states — a quiet market must never be reported
  // the same way as a dead bridge/collector.
  const liveState: LiveState =
    unsafe
      ? 'BLOCKED_STALE'
      : confirmedConditionsMet
        ? 'ACTIVE'
        : 'NO_SIGNAL';
  const mobileOrderCandidate = unsafe
    ? 'BLOCKED_STALE'
    : confirmedConditionsMet
      ? decision
      : 'NO_SIGNAL';
  const confirmedSignalState = realSignalAgeSec === null
    ? 'OFFLINE'
    : realSignalAgeSec > signalThresholds.stale
      ? 'STALE'
      : realSignalAgeSec > signalThresholds.fresh
        ? 'DELAYED'
        : timeframe === '15m'
          ? 'FRESH_PENDING_CANDLE'
          : 'FRESH';
  const confirmedSignal = {
    ts: latestSignalTs,
    age_sec: realSignalAgeSec,
    decision,
    hc: asNumber(payload.hc, asNumber(sourceBot.current_hc)),
    long_pct: asNumber(payload.long_probability_pct),
    short_pct: asNumber(payload.short_probability_pct),
    wait_pct: asNumber(payload.wait_probability_pct),
    source: 'CONFIRMED_15M_AI',
    status: confirmedSignalState,
    candidate_conditions_met: confirmedConditionsMet,
    is_trade_eligible: false,
  };
  const livePreviewSignal = buildLivePreviewSignal(payload, latestPriceTs, realPriceAgeSec);

  return {
    ...payload,
    server_now_ts: new Date(nowMs).toISOString(),
    latest_signal_ts: latestSignalTs,
    latest_price_ts: latestPriceTs,
    real_signal_age_sec: realSignalAgeSec,
    real_price_age_sec: realPriceAgeSec,
    signal_age_sec: realSignalAgeSec,
    signal_age_label: realSignalAgeSec === null ? '알 수 없음' : signalAgeLabel(realSignalAgeSec),
    signal_stale: signalStale,
    price_stale: priceStale,
    live_state: liveState,
    connection,
    signal_cycle_state:
      connection === 'FRESH' && timeframe === '15m'
        ? 'FRESH_PENDING_CANDLE'
        : connection,
    signal_fresh_after_sec: signalThresholds.fresh,
    signal_stale_after_sec: signalThresholds.stale,
    confirmed_signal: confirmedSignal,
    live_preview_signal: livePreviewSignal,
    decision,
    mobile_order_candidate: mobileOrderCandidate,
    manual_order_disabled: true,
    dry_run: true,
    live_trading_enabled: false,
    real_orders_placed: 0,
    bot: Object.keys(sourceBot).length
      ? {
          ...sourceBot,
          mode: 'DRY_RUN',
          live_trading_enabled: false,
          real_orders_placed: 0,
        }
      : null,
    readiness: {
      ...asRecord(payload.readiness),
      signal_timestamp: latestSignalTs,
      signal_age_seconds: realSignalAgeSec,
      signal_stale: signalStale,
    },
  };
}

async function readJson(filePath: string): Promise<JsonRecord> {
  const raw = await fs.readFile(filePath, 'utf8');
  return asRecord(JSON.parse(raw));
}

async function readOptionalJson(filePath: string): Promise<JsonRecord> {
  try {
    return await readJson(filePath);
  } catch {
    return {};
  }
}

function buildHcCandidate(
  id: string,
  name: string,
  hc: number,
  threshold: number,
  signal: string,
  featureStatus: string,
) {
  const hcCondition = thresholdReadiness(hc, threshold);
  const directionCondition = signal === 'LONG' ? 100 : 0;
  const freshnessCondition = featureStatus === 'LIVE' ? 100 : 0;
  const readiness = roundPercent(
    hcCondition * 0.6 + directionCondition * 0.25 + freshnessCondition * 0.15,
  );
  const blockedReasons = uniqueStrings([
    hc < threshold ? `HC_BELOW_${threshold.toFixed(2)}` : '',
    signal !== 'LONG' ? 'SIGNAL_NOT_LONG' : '',
    featureStatus !== 'LIVE' ? 'FEATURE_STALE' : '',
  ]);
  let status: CandidateStatus = 'WAIT';
  if (featureStatus !== 'LIVE') status = 'STALE';
  else if (blockedReasons.length === 0) status = 'READY';

  return {
    id,
    name,
    status,
    readiness_pct: readiness,
    hc,
    threshold,
    hc_condition_pct: hcCondition,
    direction_condition_pct: directionCondition,
    feature_freshness_pct: freshnessCondition,
    conditions: [
      { key: 'hc', label: `HC ${threshold.toFixed(2)} 기준`, pct: hcCondition },
      { key: 'direction', label: 'LONG 방향', pct: directionCondition },
      { key: 'freshness', label: 'Feature freshness', pct: freshnessCondition },
    ],
    blocked_reasons: blockedReasons,
  };
}

function buildMidpointCandidate(runtime: JsonRecord, latest: JsonRecord, fallbackPrice: number) {
  const currentPrice = asNumber(latest.current_price, fallbackPrice);
  const entryLevel = asNumber(latest.entry_level_45pct);
  const distanceRatio = currentPrice > 0 && entryLevel > 0
    ? Math.abs(currentPrice - entryLevel) / currentPrice
    : 1;
  const priceCondition = currentPrice > 0 && entryLevel > 0
    ? currentPrice <= entryLevel
      ? 100
      : roundPercent(100 - distanceRatio * 1000)
    : 0;
  const slopePercent = asNumber(latest.four_hour_ma_slope_pct);
  const trendPassed = latest.trend_filter_pass === true;
  const trendCondition = trendPassed ? 100 : roundPercent(50 + slopePercent * 1000);
  const openPositionCount = asNumber(latest.open_position_count, asNumber(runtime.open_position_count));
  const positionCondition = openPositionCount === 0 ? 100 : 0;
  const cooldownActive = latest.cooldown_active === true || runtime.cooldown_active === true;
  let cooldownCondition = cooldownActive ? 0 : 100;
  if (cooldownActive) {
    const cooldownUntil = new Date(asString(latest.cooldown_until_utc)).getTime();
    if (Number.isFinite(cooldownUntil)) {
      const remaining = Math.max(0, cooldownUntil - Date.now());
      cooldownCondition = roundPercent(100 - (remaining / (2 * 60 * 60_000)) * 100);
    }
  }
  const dataStale = latest.source && isRecord(latest.source)
    ? latest.source.data_stale === true
    : runtime.data_stale === true;
  const freshnessCondition = dataStale ? 0 : 100;
  const readiness = roundPercent(
    priceCondition * 0.4 +
      trendCondition * 0.3 +
      positionCondition * 0.15 +
      cooldownCondition * 0.1 +
      freshnessCondition * 0.05,
  );
  const runtimeStatus = asString(latest.current_signal, asString(runtime.current_signal, 'WAIT'));
  const blockedReasons = uniqueStrings([
    asString(latest.block_reason),
    currentPrice > entryLevel && entryLevel > 0 ? 'PRICE_ABOVE_ENTRY_LEVEL' : '',
    !trendPassed ? 'TREND_FILTER_FAILED' : '',
    openPositionCount > 0 ? 'OPEN_PAPER_POSITION_EXISTS' : '',
    cooldownActive ? 'COOLDOWN_ACTIVE' : '',
    dataStale ? 'FEATURE_STALE' : '',
  ]);
  const status: CandidateStatus = dataStale
    ? 'STALE'
    : runtimeStatus === 'READY'
      ? 'READY'
      : runtimeStatus === 'BLOCKED'
        ? 'BLOCKED'
        : 'WAIT';

  return {
    id: 'midpoint_0049',
    name: 'Midpoint 0049',
    status,
    readiness_pct: readiness,
    current_price: currentPrice,
    entry_level: entryLevel,
    take_profit_price: asNumber(latest.hypothetical_take_profit_price, Number.NaN),
    stop_loss_price: asNumber(latest.hypothetical_defensive_stop_price, Number.NaN),
    high_24h: asNumber(latest.high_24h, Number.NaN),
    low_24h: asNumber(latest.low_24h, Number.NaN),
    price_condition_pct: priceCondition,
    trend_condition_pct: trendCondition,
    position_condition_pct: positionCondition,
    cooldown_condition_pct: cooldownCondition,
    data_freshness_pct: freshnessCondition,
    four_hour_ma_slope_pct: slopePercent,
    open_position_count: openPositionCount,
    data_age_minutes: asNumber(runtime.data_age_minutes),
    conditions: [
      { key: 'price', label: '45% Entry 가격', pct: priceCondition },
      { key: 'trend', label: '4h MA slope', pct: trendCondition },
      { key: 'position', label: '기존 포지션', pct: positionCondition },
      { key: 'cooldown', label: 'Cooldown', pct: cooldownCondition },
      { key: 'freshness', label: 'Data freshness', pct: freshnessCondition },
    ],
    blocked_reasons: blockedReasons,
  };
}

async function readTail(filePath: string, maxBytes: number): Promise<string[]> {
  const stats = await fs.stat(filePath);
  const start = Math.max(0, stats.size - maxBytes);
  const length = stats.size - start;
  if (length <= 0) return [];

  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const lines = buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
    if (start > 0) lines.shift(); // the first row may be a partial CSV record
    return lines;
  } finally {
    await handle.close();
  }
}

function parseMarketRows(lines: string[], limit = MAX_RAW_MARKET_POINTS) {
  return lines
    .filter((line) => !line.startsWith('collected_at,'))
    .map((line) => {
      const columns = line.split(',');
      return {
        timestamp: columns[0],
        source: columns[1],
        symbol: columns[2],
        bid: asNumber(columns[4], Number.NaN),
        ask: asNumber(columns[6], Number.NaN),
        mid: asNumber(columns[8], Number.NaN),
        spread_bps: asNumber(columns[9], Number.NaN),
        last: asNumber(columns[10], Number.NaN),
      };
    })
    .filter(
      (row) =>
        Boolean(row.timestamp) &&
        Number.isFinite(row.bid) &&
        Number.isFinite(row.ask) &&
        Number.isFinite(row.mid),
    )
    .slice(-limit);
}

function parseSignalRows(lines: string[]) {
  const unique = new Map<string, {
    timestamp: string;
    close: number;
    decision: string;
    prob_long: number;
    prob_short: number;
    prob_wait: number;
    hc: number;
    reason: string;
  }>();

  for (const line of lines) {
    if (line.startsWith('timestamp,')) continue;
    const columns = line.split(',');
    const timestamp = columns[0];
    const close = asNumber(columns[1], Number.NaN);
    if (!timestamp || !Number.isFinite(close)) continue;
    unique.set(timestamp, {
      timestamp,
      close,
      decision: columns[2] || 'WAIT',
      prob_long: asNumber(columns[3]),
      prob_short: asNumber(columns[4]),
      prob_wait: asNumber(columns[5]),
      hc: asNumber(columns[6]),
      reason: columns.slice(7).join(','),
    });
  }

  return Array.from(unique.values()).slice(-MAX_SIGNAL_POINTS);
}

type PriceBucket = {
  endMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  bid: number;
  ask: number;
  mid: number;
};

// Resample raw ~30s ticks into fixed time buckets keyed by the bucket END time.
// open = first tick, high/low = extremes, close = last tick of the bucket.
function resamplePriceBuckets(
  market: ReturnType<typeof parseMarketRows>,
  bucketSeconds: number,
): PriceBucket[] {
  const bucketMs = bucketSeconds * 1000;
  const buckets = new Map<number, PriceBucket>();

  for (const point of market) {
    const timestampMs = new Date(point.timestamp).getTime();
    if (!Number.isFinite(timestampMs)) continue;
    const price = Number.isFinite(point.mid) ? point.mid : point.last;
    if (!Number.isFinite(price)) continue;
    const endMs = Math.floor(timestampMs / bucketMs) * bucketMs + bucketMs;
    const existing = buckets.get(endMs);
    if (!existing) {
      buckets.set(endMs, {
        endMs,
        open: price,
        high: price,
        low: price,
        close: price,
        bid: point.bid,
        ask: point.ask,
        mid: point.mid,
      });
    } else {
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.close = price;
      existing.bid = point.bid;
      existing.ask = point.ask;
      existing.mid = point.mid;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.endMs - b.endMs);
}

function buildTimeAlignedSeries(
  market: ReturnType<typeof parseMarketRows>,
  signals: ReturnType<typeof parseSignalRows>,
  midpointReadiness: number,
  bucketSeconds: number,
  signalStaleAfterSeconds: number,
) {
  const nowMs = Date.now();
  const orderedSignals = [...signals]
    .map((signal) => ({ ...signal, timestampMs: new Date(signal.timestamp).getTime() }))
    .filter((signal) => Number.isFinite(signal.timestampMs))
    .sort((a, b) => a.timestampMs - b.timestampMs);
  const buckets = resamplePriceBuckets(market, bucketSeconds);

  let signalIndex = 0;
  let latestSignal: (typeof orderedSignals)[number] | null = null;
  let previousSignalTimestamp = '';

  return buckets.flatMap((bucket) => {
    // As-of join: attach the most recent AI signal at or before the bucket end.
    // Future signals are never pulled back into an earlier bucket.
    while (
      signalIndex < orderedSignals.length &&
      orderedSignals[signalIndex].timestampMs <= bucket.endMs
    ) {
      latestSignal = orderedSignals[signalIndex];
      signalIndex += 1;
    }
    if (!latestSignal) return [];

    // Age is measured against the bucket close, but never beyond "now" so the
    // still-forming current bucket reports a real-time age instead of a future one.
    const referenceMs = Math.min(bucket.endMs, nowMs);
    const signalAgeMs = Math.max(0, referenceMs - latestSignal.timestampMs);
    const signalAgeSeconds = Math.round(signalAgeMs / 1000);
    const stale = signalAgeSeconds > signalStaleAfterSeconds;
    const longPercent = roundPercent(latestSignal.prob_long * 100);
    const shortPercent = roundPercent(latestSignal.prob_short * 100);
    const waitPercent = roundPercent(latestSignal.prob_wait * 100);
    const hc085Percent = thresholdReadiness(latestSignal.hc, 0.85);
    const hc090Percent = thresholdReadiness(latestSignal.hc, 0.9);
    const directionPercent = latestSignal.decision === 'LONG' ? 100 : 0;
    const freshnessPercent = stale ? 0 : 100;
    const hc085Candidate = roundPercent(
      hc085Percent * 0.6 + directionPercent * 0.25 + freshnessPercent * 0.15,
    );
    const hc090Candidate = roundPercent(
      hc090Percent * 0.6 + directionPercent * 0.25 + freshnessPercent * 0.15,
    );
    const proximityReadiness = roundPercent(
      (midpointReadiness + hc085Candidate + hc090Candidate) / 3,
    );
    const modelReady = !stale && latestSignal.decision === 'LONG' && latestSignal.hc >= 0.7;
    const overallReadiness = modelReady ? proximityReadiness : 0;
    const signalTimestamp = new Date(latestSignal.timestampMs).toISOString();
    const signalChanged = signalTimestamp !== previousSignalTimestamp;
    previousSignalTimestamp = signalTimestamp;
    const status = stale
      ? 'BLOCKED'
      : latestSignal.decision === 'WAIT'
        ? 'WAIT'
        : modelReady
          ? 'READY'
          : 'BLOCKED';

    return [{
      ts: new Date(bucket.endMs).toISOString(),
      price: bucket.close,
      open: bucket.open,
      high: bucket.high,
      low: bucket.low,
      close: bucket.close,
      bid: bucket.bid,
      ask: bucket.ask,
      mid: bucket.mid,
      long_pct: longPercent,
      short_pct: shortPercent,
      wait_pct: waitPercent,
      hc: latestSignal.hc,
      hc_pct: roundPercent(latestSignal.hc * 100),
      hc70_ready_pct: thresholdReadiness(latestSignal.hc, 0.7),
      hc070_ready_pct: thresholdReadiness(latestSignal.hc, 0.7),
      hc085_ready_pct: hc085Percent,
      hc090_ready_pct: hc090Percent,
      overall_readiness_pct: overallReadiness,
      proximity_readiness_pct: proximityReadiness,
      decision: latestSignal.decision,
      status,
      signal_ts: signalTimestamp,
      signal_age_sec: signalAgeSeconds,
      signal_age_seconds: signalAgeSeconds,
      signal_changed: signalChanged,
      signal_stale: stale,
      stale,
    }];
  });
}

type UnifiedSignal = {
  timestamp: string;
  close: number;
  decision: string;
  prob_long: number;
  prob_short: number;
  prob_wait: number;
  hc: number;
};

// Union the local AI signal CSV with any forward-accumulated mobile history
// rows. Both are 15m-stamped; dedupe by timestamp (CSV is authoritative, the DB
// snapshot fills timestamps the CSV may have rotated out).
function mergeSignalSources(
  rawSignals: ReadonlyArray<Record<string, unknown>>,
  historyRows: JsonRecord[],
): UnifiedSignal[] {
  const byTimestamp = new Map<string, UnifiedSignal>();

  // Forward-accumulated mobile snapshots: probabilities stored as 0–100.
  for (const row of historyRows) {
    const timestamp = asString(row.ts);
    const parsed = new Date(timestamp).getTime();
    if (!timestamp || Number.isNaN(parsed)) continue;
    byTimestamp.set(new Date(parsed).toISOString(), {
      timestamp,
      close: asNumber(row.price),
      decision: asString(row.decision, 'WAIT'),
      prob_long: asNumber(row.long_pct) / 100,
      prob_short: asNumber(row.short_pct) / 100,
      prob_wait: asNumber(row.wait_pct) / 100,
      hc: asNumber(row.hc),
    });
  }

  // Authoritative AI signal rows (CSV objects or relayed signal_history):
  // probabilities stored as 0–1.
  for (const signal of rawSignals) {
    const timestamp = asString(signal.timestamp);
    const parsed = new Date(timestamp).getTime();
    if (!timestamp || Number.isNaN(parsed)) continue;
    byTimestamp.set(new Date(parsed).toISOString(), {
      timestamp,
      close: asNumber(signal.close),
      decision: asString(signal.decision, 'WAIT'),
      prob_long: asNumber(signal.prob_long),
      prob_short: asNumber(signal.prob_short),
      prob_wait: asNumber(signal.prob_wait),
      hc: asNumber(signal.hc),
    });
  }

  return Array.from(byTimestamp.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

// Align AI signals onto Bitget public 15m candles. The candle timestamp (open
// time) is the canonical T. For each candle we attach the most recent signal at
// or before T — never a future signal. Candles older than the earliest known
// signal are emitted price-only with signal_history_available=false.
function buildCandleAlignedSeries(
  candles: PublicCandle[],
  signals: UnifiedSignal[],
  midpointReadiness: number,
  signalStaleAfterSeconds: number,
) {
  const nowMs = Date.now();
  const orderedSignals = signals
    .map((signal) => ({ ...signal, timestampMs: new Date(signal.timestamp).getTime() }))
    .filter((signal) => Number.isFinite(signal.timestampMs))
    .sort((a, b) => a.timestampMs - b.timestampMs);
  const earliestSignalMs = orderedSignals[0]?.timestampMs ?? Number.POSITIVE_INFINITY;

  let signalIndex = 0;
  let latestSignal: (typeof orderedSignals)[number] | null = null;
  let previousSignalTimestamp = '';

  return candles.map((candle, index) => {
    const isLatest = index === candles.length - 1;
    while (
      signalIndex < orderedSignals.length &&
      orderedSignals[signalIndex].timestampMs <= candle.timestampMs
    ) {
      latestSignal = orderedSignals[signalIndex];
      signalIndex += 1;
    }
    const historyAvailable = latestSignal !== null && candle.timestampMs >= earliestSignalMs;

    const priceFields = {
      ts: candle.ts,
      price: candle.close,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      bid: candle.bid,
      ask: candle.ask,
      mid: candle.mid,
    };

    if (!latestSignal || !historyAvailable) {
      // Price-only candle: no historical AI signal exists for this bucket.
      return {
        ...priceFields,
        long_pct: 0,
        short_pct: 0,
        wait_pct: 0,
        hc: 0,
        hc_pct: 0,
        hc70_ready_pct: 0,
        hc070_ready_pct: 0,
        hc085_ready_pct: 0,
        hc090_ready_pct: 0,
        overall_readiness_pct: 0,
        proximity_readiness_pct: 0,
        decision: 'NO_SIGNAL_HISTORY',
        status: 'WAIT' as const,
        signal_ts: '',
        signal_age_sec: 0,
        signal_age_seconds: 0,
        signal_changed: false,
        signal_stale: false,
        stale: false,
        signal_history_available: false,
      };
    }

    // Historical candles age against their own bucket; the still-forming latest
    // candle ages against the wall clock so the realtime stale gate is accurate.
    const referenceMs = isLatest ? nowMs : candle.timestampMs;
    const signalAgeSeconds = Math.round(Math.max(0, referenceMs - latestSignal.timestampMs) / 1000);
    const stale = signalAgeSeconds > signalStaleAfterSeconds;
    const longPercent = roundPercent(latestSignal.prob_long * 100);
    const shortPercent = roundPercent(latestSignal.prob_short * 100);
    const waitPercent = roundPercent(latestSignal.prob_wait * 100);
    const hc085Percent = thresholdReadiness(latestSignal.hc, 0.85);
    const hc090Percent = thresholdReadiness(latestSignal.hc, 0.9);
    const directionPercent = latestSignal.decision === 'LONG' ? 100 : 0;
    const freshnessPercent = stale ? 0 : 100;
    const hc085Candidate = roundPercent(
      hc085Percent * 0.6 + directionPercent * 0.25 + freshnessPercent * 0.15,
    );
    const hc090Candidate = roundPercent(
      hc090Percent * 0.6 + directionPercent * 0.25 + freshnessPercent * 0.15,
    );
    const proximityReadiness = roundPercent(
      (midpointReadiness + hc085Candidate + hc090Candidate) / 3,
    );
    const modelReady = !stale && latestSignal.decision === 'LONG' && latestSignal.hc >= 0.7;
    const overallReadiness = modelReady ? proximityReadiness : 0;
    const signalTimestamp = new Date(latestSignal.timestampMs).toISOString();
    const signalChanged = signalTimestamp !== previousSignalTimestamp;
    previousSignalTimestamp = signalTimestamp;
    const status = stale
      ? ('BLOCKED' as const)
      : latestSignal.decision === 'WAIT'
        ? ('WAIT' as const)
        : modelReady
          ? ('READY' as const)
          : ('BLOCKED' as const);

    return {
      ...priceFields,
      long_pct: longPercent,
      short_pct: shortPercent,
      wait_pct: waitPercent,
      hc: latestSignal.hc,
      hc_pct: roundPercent(latestSignal.hc * 100),
      hc70_ready_pct: thresholdReadiness(latestSignal.hc, 0.7),
      hc070_ready_pct: thresholdReadiness(latestSignal.hc, 0.7),
      hc085_ready_pct: hc085Percent,
      hc090_ready_pct: hc090Percent,
      overall_readiness_pct: overallReadiness,
      proximity_readiness_pct: proximityReadiness,
      decision: latestSignal.decision,
      status,
      signal_ts: signalTimestamp,
      signal_age_sec: signalAgeSeconds,
      signal_age_seconds: signalAgeSeconds,
      signal_changed: signalChanged,
      signal_stale: stale,
      stale,
      signal_history_available: true,
    };
  });
}

function applyTimeframeToPayload(payload: JsonRecord, timeframe: Timeframe): JsonRecord {
  const staleAfterSeconds = TIMEFRAME_STALE_SECONDS[timeframe];
  const sourceSeries = Array.isArray(payload.time_aligned_series)
    ? payload.time_aligned_series.filter(isRecord)
    : [];
  const alignedSeries: JsonRecord[] = sourceSeries.map((point): JsonRecord => {
    const signalAgeSeconds = asNumber(point.signal_age_sec, asNumber(point.signal_age_seconds));
    const signalStale = signalAgeSeconds > staleAfterSeconds;
    const modelReady = !signalStale && asString(point.decision) === 'LONG' && asNumber(point.hc) >= 0.7;
    return {
      ...point,
      mid: asNumber(point.mid, asNumber(point.price)),
      hc70_ready_pct: asNumber(point.hc70_ready_pct, asNumber(point.hc070_ready_pct)),
      signal_age_sec: signalAgeSeconds,
      signal_age_seconds: signalAgeSeconds,
      signal_stale: signalStale,
      stale: signalStale,
      overall_readiness_pct: modelReady ? asNumber(point.proximity_readiness_pct) : 0,
      status: signalStale ? 'BLOCKED' : asString(point.status, modelReady ? 'READY' : 'WAIT'),
    };
  });
  const latest = alignedSeries.at(-1);
  const signalAgeSeconds = latest ? asNumber(latest.signal_age_sec) : 0;
  const signalStale = latest ? latest.signal_stale === true : true;
  const signalFreshnessPercent = signalStale ? 0 : 100;
  const sourceReadiness = asRecord(payload.readiness);
  const sourceBlockers = Array.isArray(payload.blocker_breakdown)
    ? payload.blocker_breakdown.filter(isRecord)
    : [];
  const signalFreshnessBlocker = {
    key: 'signal_freshness',
    label: `Signal freshness (${timeframe})`,
    current: signalFreshnessPercent,
    target: 100,
    pct: signalFreshnessPercent,
    missing_pct: 100 - signalFreshnessPercent,
    detail: `${signalAgeLabel(signalAgeSeconds)} / stale 기준 ${signalAgeLabel(staleAfterSeconds)}`,
  };
  const blockers = [
    ...sourceBlockers.filter((blocker) => asString(blocker.key) !== 'signal_freshness'),
    signalFreshnessBlocker,
  ];

  return {
    ...payload,
    timeframe,
    latest_signal_ts: latest ? asString(latest.signal_ts) : asString(sourceReadiness.signal_timestamp),
    latest_price_ts: latest ? asString(latest.ts) : '',
    signal_age_sec: signalAgeSeconds,
    signal_age_label: signalAgeLabel(signalAgeSeconds),
    signal_stale: signalStale,
    readiness: {
      ...sourceReadiness,
      signal_timestamp: latest ? asString(latest.signal_ts) : asString(sourceReadiness.signal_timestamp),
      signal_age_seconds: signalAgeSeconds,
      signal_stale: signalStale,
    },
    blocker_breakdown: blockers,
    time_aligned_series: alignedSeries,
  };
}

// Appends the read-only research-candidate snapshot to every GET response
// path (success, degraded, error) without touching any of the existing
// live-signal branches below — a pure post-processing wrapper so the new
// display-only field can never affect connection/decision/order-candidate logic.
export async function GET(req: NextRequest) {
  const response = await getLiveSignal(req);
  try {
    const body = await response.json();
    return NextResponse.json(
      { ...body, research_candidate: RESEARCH_CANDIDATE_SNAPSHOT },
      { status: response.status },
    );
  } catch {
    return response;
  }
}

async function getLiveSignal(req: NextRequest): Promise<NextResponse> {
  const nowMs = Date.now();
  const range = parseRange(req);
  const requestedTimeframe = parseTimeframe(req);
  // Seven days is a fixed 672-point 15m history. Ignoring tf=5m/30m here keeps
  // range metadata, candle count and UI navigation mathematically consistent.
  const timeframe: Timeframe = range === '7d' ? '15m' : requestedTimeframe;
  const rangePoints = RANGE_POINTS[range];
  const bucketSeconds = TIMEFRAME_BUCKET_SECONDS[timeframe];
  const rangeWindowMs = rangePoints * bucketSeconds * 1000;
  const staleSeconds = TIMEFRAME_STALE_SECONDS[timeframe];
  const configuredRoot = process.env.EDEN_TRADEBOT_ROOT?.trim();
  const tradeBotRoot = configuredRoot || path.resolve(process.cwd(), '..', '..', 'MyTradeBotGPU');
  const reportsRoot = path.join(tradeBotRoot, 'training', 'reports');

  // Fetch the public candle timeline + forward-accumulated signal history up
  // front so the historical view works even where the local bot files are
  // absent (e.g. on Vercel, where the route serves from the relay instead).
  const [publicCandles, storedSignalHistory] = await Promise.all([
    fetchBitgetPublicCandles({ symbol: 'BTCUSDT', timeframe, limit: rangePoints }).catch(() => []),
    loadSignalHistorySince(Date.now() - rangeWindowMs - bucketSeconds * 1000).catch(
      () => [] as JsonRecord[],
    ),
  ]);

  // Align AI signals onto the candle timeline; fall back to a recent local
  // resample only when the public candle fetch is unavailable.
  const alignSeries = (
    rawSignals: ReadonlyArray<Record<string, unknown>>,
    midpointReadiness: number,
    fallbackSeries: JsonRecord[],
  ): { series: JsonRecord[]; priceSource: string; rawSignalTimestamps: Set<string> } => {
    const unified = mergeSignalSources(rawSignals, storedSignalHistory);
    // Timestamps backed by an authoritative raw signal row on THIS request (CSV
    // tail / relay), as opposed to a forward-filled DB history row. Only these
    // buckets carry a value that could have just been confirmed/corrected, so
    // only these are worth re-persisting below.
    const rawSignalTimestamps = new Set<string>();
    for (const signal of rawSignals) {
      const ts = asString(signal.timestamp);
      const parsed = new Date(ts).getTime();
      if (ts && !Number.isNaN(parsed)) rawSignalTimestamps.add(new Date(parsed).toISOString());
    }
    if (publicCandles.length > 0) {
      return {
        series: buildCandleAlignedSeries(
          publicCandles.slice(-rangePoints),
          unified,
          midpointReadiness,
          staleSeconds,
        ) as unknown as JsonRecord[],
        priceSource: 'BITGET_PUBLIC_CANDLES',
        rawSignalTimestamps,
      };
    }
    return {
      series: fallbackSeries.slice(-rangePoints),
      priceSource: 'LOCAL_TICK_RESAMPLE_FALLBACK',
      rawSignalTimestamps,
    };
  };

  // Attach range metadata + the signal-history availability note, then normalize.
  const withRangeMeta = (payload: JsonRecord, series: JsonRecord[], priceSource: string): JsonRecord => {
    const missing = series.filter(
      (point) => isRecord(point) && point.signal_history_available === false,
    ).length;
    const available = series.length === 0 ? false : missing < series.length;
    return applyTimeframeToPayload(
      {
        ...payload,
        time_aligned_series: series,
        range,
        points: series.length,
        requested_points: rangePoints,
        price_source: priceSource,
        signal_history_available: available,
        signal_history_missing_buckets: missing,
        signal_history_note: available
          ? missing > 0
            ? '일부 과거 구간은 AI 시그널 기록이 없어 가격만 표시됩니다. 앞으로는 15분 단위 AI 시그널 히스토리를 저장합니다.'
            : ''
          : 'NO_SIGNAL_HISTORY · 이 구간은 과거 AI 시그널 기록이 없어 가격만 표시됩니다. 앞으로는 15분 단위 AI 시그널 히스토리를 저장합니다.',
      },
      timeframe,
    );
  };

  // Persist 15m bucket snapshots (best-effort, never fatal).
  //
  // Bug fixed here: this used to persist ONLY series.at(-1) (the single most
  // recent bucket). But a bucket's AI signal can still be revised/confirmed by
  // the model AFTER it stops being "the latest" bucket (e.g. it was first
  // written as a preliminary/forward-filled value, then the CSV confirms the
  // real value a poll or two later). Since this function was never invoked
  // again for that bucket_ts once a newer bucket existed, the DB row was
  // frozen at its first (often preliminary/wrong) value forever — the root
  // cause of the eden_mobile_signal_history corruption. Fix: also re-persist
  // every bucket in `series` whose timestamp is backed by an authoritative raw
  // signal row on THIS request (`rawSignalTimestamps`), so any correction the
  // source makes to a recent bucket gets written back on the very next poll.
  const persistBucket = (bucket: JsonRecord): void => {
    if (!isRecord(bucket) || !asString(bucket.ts)) return;
    void saveSignalHistoryRow(asString(bucket.ts), {
      ts: asString(bucket.ts),
      price: asNumber(bucket.price),
      hc: asNumber(bucket.hc),
      long_pct: asNumber(bucket.long_pct),
      short_pct: asNumber(bucket.short_pct),
      wait_pct: asNumber(bucket.wait_pct),
      hc70_ready_pct: asNumber(bucket.hc70_ready_pct),
      hc085_ready_pct: asNumber(bucket.hc085_ready_pct),
      hc090_ready_pct: asNumber(bucket.hc090_ready_pct),
      overall_readiness_pct: asNumber(bucket.overall_readiness_pct),
      decision: asString(bucket.decision, 'WAIT'),
      ticket_status: asString(bucket.status, 'WAIT'),
      signal_stale: bucket.signal_stale === true,
    }).catch(() => undefined);
  };

  const persistLatestBucket = (series: JsonRecord[], rawSignalTimestamps?: Set<string>): void => {
    const latest = series.at(-1);
    if (isRecord(latest) && asString(latest.ts)) persistBucket(latest);
    if (!rawSignalTimestamps || rawSignalTimestamps.size === 0) return;
    for (const point of series) {
      if (point === latest) continue; // already persisted above
      if (isRecord(point) && rawSignalTimestamps.has(asString(point.ts))) persistBucket(point);
    }
  };

  try {
    const [
      bridge,
      collector,
      primarySource,
      midpointRuntime,
      midpointLatest,
      v3Status,
      marketLines,
      signalLines,
    ] = await Promise.all([
      readJson(path.join(reportsRoot, 'live_order_bridge_dryrun_status.json')),
      readJson(path.join(reportsRoot, 'eden1_v3_1_public_collector_status.json')),
      readJson(path.join(reportsRoot, 'paper_monitor_eden1_hc70_crash_block_08_status.json')),
      readOptionalJson(
        path.join(tradeBotRoot, 'midpoint_rescue_v2_shadow_deploy', 'data', 'runtime_status.json'),
      ),
      readOptionalJson(
        path.join(tradeBotRoot, 'midpoint_rescue_v2_shadow_deploy', 'data', 'latest_signal.json'),
      ),
      readOptionalJson(path.join(reportsRoot, 'paper_monitor_eden1_v3_fee_aware_status.json')),
      readTail(path.join(reportsRoot, 'eden1_v3_1_public_orderbook_snapshots.csv'), RAW_MARKET_TAIL_BYTES),
      readTail(
        path.join(tradeBotRoot, 'training', 'eden1_0_v2', 'reports', 'paper_signals_eden1_v2_btc.csv'),
        SIGNAL_TAIL_BYTES,
      ),
    ]);

    const bridgeUpdatedAt = asString(bridge.updated_at);
    const collectorUpdatedAt = asString(collector.updated_at);
    const sourceUpdatedAt = asString(primarySource.updated_at);
    const sourceSignal = asRecord(primarySource.latest_signal);
    const sourceHealth = asRecord(primarySource.source_health);
    const sourceResults = Array.isArray(bridge.source_results)
      ? bridge.source_results.filter(isRecord).map((result) => ({
          source: asString(result.source),
          decision: asString(result.decision, 'NO_ACTION'),
          reason: asString(result.reason),
          signal: asString(result.signal, 'WAIT'),
          hc: asNumber(result.hc),
        }))
      : [];

    const market = parseMarketRows(marketLines);
    const signalHistory = parseSignalRows(signalLines);
    const latestMarket = market.at(-1);
    const latestMarketTimestamp = new Date(latestMarket?.timestamp || '').getTime();
    const latestProbability = [...signalHistory]
      .filter((signal) => {
        const signalTimestamp = new Date(signal.timestamp).getTime();
        return Number.isFinite(signalTimestamp) &&
          (!Number.isFinite(latestMarketTimestamp) || signalTimestamp <= latestMarketTimestamp);
      })
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .at(-1);
    const collectorState = connectionState(collectorUpdatedAt);
    const bridgeState = connectionState(bridgeUpdatedAt);
    // The primary model intentionally evaluates every five minutes, so its
    // healthy freshness window is wider than the 30-second bridge/market feeds.
    const sourceState = connectionState(sourceUpdatedAt, 7 * 60_000, 20 * 60_000);
    const currentHc = asNumber(latestProbability?.hc, asNumber(sourceSignal.hc));
    const currentSignal = asString(latestProbability?.decision, asString(sourceSignal.signal, 'WAIT'));
    const hcThreshold = asNumber(sourceSignal.hc_threshold, 0.7);
    const v3Health = asRecord(v3Status.source_health);
    const v3FeatureStatus = asString(v3Health.feature_status, asString(sourceHealth.feature_status));
    const midpoint = buildMidpointCandidate(midpointRuntime, midpointLatest, latestMarket?.mid ?? 0);
    const v3Hc090 = buildHcCandidate(
      'v3_hc090',
      'V3 HC090',
      currentHc,
      0.9,
      currentSignal,
      v3FeatureStatus,
    );
    const v3Hc085 = buildHcCandidate(
      'v3_hc085',
      'V3 HC085',
      currentHc,
      0.85,
      currentSignal,
      v3FeatureStatus,
    );
    const hcReadyPercent = thresholdReadiness(currentHc, hcThreshold || 0.7);
    const longProbabilityPercent = roundPercent(asNumber(latestProbability?.prob_long) * 100);
    const shortProbabilityPercent = roundPercent(asNumber(latestProbability?.prob_short) * 100);
    const waitProbabilityPercent = roundPercent(asNumber(latestProbability?.prob_wait) * 100);
    const proximityReadiness = roundPercent(
      (midpoint.readiness_pct + v3Hc090.readiness_pct + v3Hc085.readiness_pct) / 3,
    );
    const futureBarCondition = sourceSignal.entry_eligible_now === true ? 100 : 0;
    const overallReadiness = currentSignal === 'LONG' && futureBarCondition === 100
      ? proximityReadiness
      : 0;
    // Primary: align AI signals (local CSV + accumulated history) onto public
    // Bitget candles. Fallback: local tick resample if the public fetch fails.
    const localFallbackSeries = buildTimeAlignedSeries(
      market,
      signalHistory,
      midpoint.readiness_pct,
      bucketSeconds,
      staleSeconds,
    ) as unknown as JsonRecord[];
    const {
      series: timeAlignedSeries,
      priceSource,
      rawSignalTimestamps: timeAlignedRawTimestamps,
    } = alignSeries(signalHistory, midpoint.readiness_pct, localFallbackSeries);
    const latestAligned = timeAlignedSeries.at(-1);
    const blockerBreakdown = [
      {
        key: 'overall_trade_readiness',
        label: 'Overall trade readiness',
        current: overallReadiness,
        target: 100,
        pct: overallReadiness,
        missing_pct: roundPercent(100 - overallReadiness),
        detail: `proximity ${proximityReadiness.toFixed(2)}%`,
      },
      {
        key: 'future_bar',
        label: '다음 확정봉 진입 조건',
        current: futureBarCondition,
        target: 100,
        pct: futureBarCondition,
        missing_pct: roundPercent(100 - futureBarCondition),
        detail: asString(sourceSignal.reason, asString(bridge.last_reason)),
      },
      {
        key: 'paper_position',
        label: '기존 paper/manual position',
        current: midpoint.position_condition_pct,
        target: 100,
        pct: midpoint.position_condition_pct,
        missing_pct: roundPercent(100 - midpoint.position_condition_pct),
        detail: midpoint.open_position_count > 0 ? `${midpoint.open_position_count} open` : 'clear',
      },
      {
        key: 'midpoint_trend',
        label: 'Midpoint 4h 추세 조건',
        current: midpoint.four_hour_ma_slope_pct,
        target: 0,
        pct: midpoint.trend_condition_pct,
        missing_pct: roundPercent(100 - midpoint.trend_condition_pct),
        detail: `slope ${midpoint.four_hour_ma_slope_pct.toFixed(5)}%`,
      },
      {
        key: 'hc090',
        label: 'V3 HC090 기준',
        current: currentHc,
        target: 0.9,
        pct: v3Hc090.hc_condition_pct,
        missing_pct: roundPercent(100 - v3Hc090.hc_condition_pct),
        detail: `${currentHc.toFixed(4)} / 0.90`,
      },
      {
        key: 'hc085',
        label: 'V3 HC085 기준',
        current: currentHc,
        target: 0.85,
        pct: v3Hc085.hc_condition_pct,
        missing_pct: roundPercent(100 - v3Hc085.hc_condition_pct),
        detail: `${currentHc.toFixed(4)} / 0.85`,
      },
      {
        key: 'midpoint_price',
        label: 'Midpoint 가격 조건',
        current: midpoint.current_price,
        target: midpoint.entry_level,
        pct: midpoint.price_condition_pct,
        missing_pct: roundPercent(100 - midpoint.price_condition_pct),
        detail: `${midpoint.current_price.toFixed(2)} / ${midpoint.entry_level.toFixed(2)}`,
      },
      {
        key: 'hc070',
        label: 'HC70 기준',
        current: currentHc,
        target: hcThreshold || 0.7,
        pct: hcReadyPercent,
        missing_pct: roundPercent(100 - hcReadyPercent),
        detail: `${currentHc.toFixed(4)} / ${(hcThreshold || 0.7).toFixed(2)}`,
      },
      {
        key: 'freshness',
        label: 'Feature freshness',
        current: v3Hc085.feature_freshness_pct,
        target: 100,
        pct: v3Hc085.feature_freshness_pct,
        missing_pct: roundPercent(100 - v3Hc085.feature_freshness_pct),
        detail: v3FeatureStatus || 'UNKNOWN',
      },
    ];

    const readiness = {
      overall_trade_readiness_pct: overallReadiness,
      long_probability_pct: longProbabilityPercent,
      short_probability_pct: shortProbabilityPercent,
      wait_probability_pct: waitProbabilityPercent,
      hc_ready_pct: hcReadyPercent,
      hc_current: currentHc,
      hc_threshold: hcThreshold || 0.7,
      hc070_ready_pct: thresholdReadiness(currentHc, 0.7),
      hc085_ready_pct: thresholdReadiness(currentHc, 0.85),
      hc090_ready_pct: thresholdReadiness(currentHc, 0.9),
      proximity_readiness_pct: proximityReadiness,
      signal_timestamp: latestAligned?.signal_ts ?? asString(latestProbability?.timestamp),
      signal_age_seconds: latestAligned?.signal_age_seconds ?? 0,
      signal_stale: latestAligned?.stale ?? true,
      note: '조건 충족률 기반 표시 점수이며 수익 또는 체결 확률 예측이 아닙니다.',
    };

    const localPayload: JsonRecord = {
        generated_at: new Date().toISOString(),
        connection: oldestConnection(bridgeState, collectorState, sourceState),
        current_price: latestMarket?.mid ?? midpoint.current_price,
        decision: currentSignal,
        hc: currentHc,
        overall_trade_readiness_pct: overallReadiness,
        long_probability_pct: longProbabilityPercent,
        short_probability_pct: shortProbabilityPercent,
        wait_probability_pct: waitProbabilityPercent,
        hc_ready_pct: hcReadyPercent,
        readiness,
        bots: {
          midpoint_0049: midpoint,
          v3_hc090: v3Hc090,
          v3_hc085: v3Hc085,
        },
        blocker_breakdown: blockerBreakdown,
        price_levels: {
          current: latestMarket?.mid ?? midpoint.current_price,
          high_24h: midpoint.high_24h,
          low_24h: midpoint.low_24h,
          entry: midpoint.entry_level,
          take_profit: midpoint.take_profit_price,
          stop_loss: midpoint.stop_loss_price,
          threshold: asNumber(latestProbability?.close, asNumber(sourceSignal.close, Number.NaN)),
          source: 'MIDPOINT_0049_DISPLAY_ONLY',
        },
        bot: {
          bridge_connection: bridgeState,
          market_connection: collectorState,
          model_connection: sourceState,
          updated_at: bridgeUpdatedAt,
          bridge_name: asString(bridge.bridge_name, 'EDEN1_ORDER_BRIDGE'),
          mode: bridge.dry_run === true ? 'DRY_RUN' : 'UNKNOWN',
          live_trading_enabled: bridge.live_trading_enabled === true,
          real_orders_placed: asNumber(bridge.real_orders_placed),
          symbol: asString(bridge.symbol, latestMarket?.symbol || 'BTCUSDT'),
          direction_policy: asString(bridge.direction_policy, 'LONG_ONLY'),
          last_decision: asString(bridge.last_decision, 'NO_ACTION'),
          last_reason: asString(bridge.last_reason),
          accepted_intent_count: asNumber(bridge.accepted_intent_count),
          blocked_order_count: asNumber(bridge.blocked_order_count),
          safety_state: asString(primarySource.safety_state),
          feature_status: asString(sourceHealth.feature_status),
          open_position_count: asNumber(primarySource.open_position_count),
          current_signal: currentSignal,
          current_hc: currentHc,
          hc_threshold: hcThreshold,
          reference_price: asNumber(latestProbability?.close, asNumber(sourceSignal.close, Number.NaN)),
          signal_at: asString(latestProbability?.timestamp, asString(sourceSignal.signal_ts)),
          source_results: sourceResults,
        },
        market: {
          updated_at: collectorUpdatedAt,
          collector_state: asString(collector.collector_state),
          source: latestMarket?.source || asString(collector.public_data_source),
          latest: latestMarket ?? null,
          points: market.slice(-MAX_MARKET_POINTS),
        },
        signal_history: signalHistory,
        time_aligned_series: timeAlignedSeries,
        bot_order_execution: 'DISABLED',
        real_order_sent_by_bot: false,
        user_must_place_order_manually: true,
        safety: {
          bot_order_execution: 'DISABLED',
          real_order_sent_by_bot: false,
          user_must_place_order_manually: true,
        },
      };

    persistLatestBucket(timeAlignedSeries, timeAlignedRawTimestamps);

    const finalPayload = withRangeMeta(localPayload, timeAlignedSeries, priceSource);
    const baseConnection = oldestConnection(bridgeState, collectorState, sourceState);
    // Raw live-source timestamps: the model's own last signal row and the
    // collector's own last market tick — not the bucket-aligned chart series.
    const rawSignalTsIso = newestTimestamp(
      asString(latestProbability?.timestamp),
      asString(sourceSignal.signal_ts),
    );
    const rawPriceTsIso = asString(latestMarket?.timestamp);
    return NextResponse.json(
      applyRealtimeFreshness(finalPayload, nowMs, baseConnection, rawSignalTsIso, rawPriceTsIso, timeframe),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    try {
      const stored = await loadStoredTelemetry();
      if (stored) {
        const ageMs = Math.max(0, Date.now() - stored.updatedAt.getTime());
        const relayConnection: SourceConnectionState = ageMs <= ONLINE_AFTER_MS
          ? 'ONLINE'
          : ageMs <= STALE_AFTER_MS
            ? 'STALE'
            : 'OFFLINE';
        const relayPayload: JsonRecord = {
            ...stored.payload,
            connection: relayConnection,
            relay: {
              backend: 'postgresql',
              stored_at: stored.updatedAt.toISOString(),
              age_seconds: Math.round(ageMs / 1000),
            },
          };
        // Recompute the historical timeline from public candles + the telemetry's
        // own signal_history (plus accumulated DB history). This is the path that
        // actually serves the deployed (Vercel) screen, where local files are absent.
        const relaySignals = Array.isArray(stored.payload.signal_history)
          ? stored.payload.signal_history.filter(isRecord)
          : [];
        const relayMidpointReadiness = asNumber(
          asRecord(asRecord(stored.payload.bots).midpoint_0049).readiness_pct,
        );
        const relayFallback = Array.isArray(stored.payload.time_aligned_series)
          ? stored.payload.time_aligned_series.filter(isRecord)
          : [];
        const relayAligned = alignSeries(relaySignals, relayMidpointReadiness, relayFallback);
        persistLatestBucket(relayAligned.series, relayAligned.rawSignalTimestamps);
        const finalRelayPayload = withRangeMeta(relayPayload, relayAligned.series, relayAligned.priceSource);
        // The relayed payload is the local machine's full /live response at
        // publish time, so it still carries the raw (non-bucket-aligned)
        // signal/price timestamps under bot.signal_at and market.latest.timestamp.
        const relayRawSignalTsIso =
          asString(asRecord(stored.payload.bot).signal_at) || asString(stored.payload.latest_signal_ts);
        const relayRawPriceTsIso = asString(asRecord(asRecord(stored.payload.market).latest).timestamp);
        return NextResponse.json(
          applyRealtimeFreshness(
            finalRelayPayload,
            nowMs,
            relayConnection,
            relayRawSignalTsIso,
            relayRawPriceTsIso,
            timeframe,
          ),
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }
    } catch {
      // Fall through to the candle-only / hard-pinned offline response below.
    }

    // No telemetry at all — still serve a price-only historical view when the
    // public candle feed is reachable, marking AI signals as NO_SIGNAL_HISTORY.
    if (publicCandles.length > 0) {
      const offlineAligned = alignSeries([], 0, []);
      persistLatestBucket(offlineAligned.series);
      const offlinePayload = withRangeMeta(
        {
          generated_at: new Date().toISOString(),
          connection: 'OFFLINE',
          message: 'AI 텔레메트리는 비어 있어 공개 가격만 표시합니다.',
          bot: null,
          market: { latest: null, points: [] },
          signal_history: [],
          safety: {
            bot_order_execution: 'DISABLED',
            real_order_sent_by_bot: false,
            user_must_place_order_manually: true,
          },
        },
        offlineAligned.series,
        offlineAligned.priceSource,
      );
      // No live telemetry at all: there is no raw signal timestamp, and the
      // only price data available is the public candle feed (bucket-aligned,
      // but connection is already forced OFFLINE below regardless).
      return NextResponse.json(
        applyRealtimeFreshness(
          offlinePayload,
          nowMs,
          'OFFLINE',
          '',
          asString(publicCandles.at(-1)?.ts),
          timeframe,
        ),
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      {
        generated_at: new Date().toISOString(),
        server_now_ts: new Date(nowMs).toISOString(),
        connection: 'OFFLINE',
        timeframe,
        range,
        points: 0,
        message: 'Local trading bot telemetry is unavailable.',
        bot: null,
        market: { latest: null, points: [] },
        signal_history: [],
        time_aligned_series: [],
        latest_signal_ts: '',
        latest_price_ts: '',
        real_signal_age_sec: null,
        real_price_age_sec: null,
        signal_stale: true,
        price_stale: true,
        live_state: 'BLOCKED_STALE',
        decision: 'NO_SIGNAL',
        mobile_order_candidate: 'BLOCKED_STALE',
        manual_order_disabled: true,
        dry_run: true,
        live_trading_enabled: false,
        real_orders_placed: 0,
        confirmed_signal: {
          ts: '',
          age_sec: null,
          decision: 'NO_SIGNAL',
          hc: 0,
          long_pct: 0,
          short_pct: 0,
          wait_pct: 0,
          source: 'CONFIRMED_15M_AI',
          status: 'OFFLINE',
          candidate_conditions_met: false,
          is_trade_eligible: false,
        },
        live_preview_signal: {
          ts: '',
          age_sec: null,
          decision: 'NO_SIGNAL',
          confidence_pct: 0,
          long_pct: 0,
          short_pct: 0,
          wait_pct: 0,
          source: 'LIVE_PRICE_PREVIEW',
          status: 'OFFLINE',
          is_trade_eligible: false,
          note: '진행 중인 봉 기준 예비 신호이며 주문에 사용하지 않음',
        },
        safety: {
          bot_order_execution: 'DISABLED',
          real_order_sent_by_bot: false,
          user_must_place_order_manually: true,
        },
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isTelemetryPublisherAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const contentLength = Number(req.headers.get('content-length') || 0);
  if (contentLength > 1_000_000) {
    return NextResponse.json({ ok: false, error: 'payload_too_large' }, { status: 413 });
  }

  let input: unknown;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  if (!isRecord(input) || !isRecord(input.bot) || !isRecord(input.market)) {
    return NextResponse.json({ ok: false, error: 'invalid_telemetry_payload' }, { status: 400 });
  }
  if (containsSensitiveKey(input)) {
    return NextResponse.json({ ok: false, error: 'sensitive_field_rejected' }, { status: 400 });
  }
  if (input.bot.live_trading_enabled === true || asNumber(input.bot.real_orders_placed) !== 0) {
    return NextResponse.json({ ok: false, error: 'live_order_state_rejected' }, { status: 400 });
  }

  try {
    const payload = sanitizeTelemetryPayload(input);
    await saveStoredTelemetry(payload);
    return NextResponse.json(
      {
        ok: true,
        stored: true,
        backend: 'postgresql',
        generated_at: payload.generated_at,
        bot_order_execution: 'DISABLED',
        real_order_sent_by_bot: false,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: 'telemetry_storage_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
