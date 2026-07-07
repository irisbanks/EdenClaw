/**
 * eden_mobile_signal_history 백필 — 확정 신호 CSV(읽기 전용, EDEN1 V2 검증
 * 산출물)를 정답으로 삼아 오염된 DB 행을 교정한다.
 *
 * 근본 원인(수정 완료: app/api/mobile-order-signal/live/route.ts
 * persistLatestBucket): 이 함수는 series의 마지막(최신) bucket만 계속
 * 재기록해왔고, 한 bucket이 "최신"에서 밀려난 뒤 그 확정값이 나중에
 * 바뀌어도 다시는 그 bucket_ts로 재호출되지 않았다. 그 결과 DB에는 확정 전
 * 스냅샷이 영구 고정되어 있었다.
 *
 * 이 스크립트는 CSV가 실제로 값을 아는 필드(price/long_pct/short_pct/
 * wait_pct/hc/decision)만 교정하고, CSV에 없는 필드(ticket_status,
 * hc70/85/90_ready_pct, overall_readiness_pct, signal_stale 등)는 근거
 * 없이 지어내지 않기 위해 기존 값을 그대로 보존한다(jsonb `||` 병합).
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma';
import fs from 'fs';
import path from 'path';

const CONFIRMED_SIGNAL_CSV = path.join(
  '/NHNHOME/WORKSPACE/0426030063_A/MyTradeBotGPU/training/eden1_0_v2/reports/paper_signals_eden1_v2_btc.csv',
);

type CsvRow = {
  timestamp: string;
  close: number;
  final_decision: string;
  prob_long: number;
  prob_short: number;
  prob_wait: number;
  hc_score: number;
};

function loadConfirmedSignalCsv(): Map<string, CsvRow> {
  const raw = fs.readFileSync(CONFIRMED_SIGNAL_CSV, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const header = lines[0].split(',');
  const idx = (name: string) => header.indexOf(name);
  const tsIdx = idx('timestamp');
  const closeIdx = idx('close');
  const decisionIdx = idx('final_decision');
  const longIdx = idx('prob_long');
  const shortIdx = idx('prob_short');
  const waitIdx = idx('prob_wait');
  const hcIdx = idx('hc_score');

  const map = new Map<string, CsvRow>();
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(',');
    const rawTs = cols[tsIdx];
    if (!rawTs) continue;
    const iso = new Date(rawTs).toISOString();
    // 같은 timestamp가 여러 번 기록된 경우 마지막(가장 나중에 확정된) 행을 정답으로 취급.
    map.set(iso, {
      timestamp: iso,
      close: Number(cols[closeIdx]),
      final_decision: cols[decisionIdx],
      prob_long: Number(cols[longIdx]),
      prob_short: Number(cols[shortIdx]),
      prob_wait: Number(cols[waitIdx]),
      hc_score: Number(cols[hcIdx]),
    });
  }
  return map;
}

async function main() {
  console.log('[backfill] loading confirmed signal CSV (read-only) ...');
  const csvByTs = loadConfirmedSignalCsv();
  console.log(`[backfill] confirmed signal rows: ${csvByTs.size} unique 15m buckets`);

  console.log('[backfill] loading current DB rows from eden_mobile_signal_history ...');
  const dbRows = await prisma.$queryRawUnsafe<{ bucket_ts: Date; payload: Record<string, unknown> }[]>(
    `SELECT bucket_ts, payload FROM eden_mobile_signal_history ORDER BY bucket_ts ASC`,
  );
  console.log(`[backfill] DB rows: ${dbRows.length}`);

  let corrected = 0;
  let alreadyCorrect = 0;
  let noCsvMatch = 0;

  for (const row of dbRows) {
    const iso = new Date(row.bucket_ts).toISOString();
    const csv = csvByTs.get(iso);
    if (!csv) {
      noCsvMatch += 1;
      continue;
    }
    const correctLongPct = Math.round(csv.prob_long * 100 * 100) / 100;
    const correctShortPct = Math.round(csv.prob_short * 100 * 100) / 100;
    const correctWaitPct = Math.round(csv.prob_wait * 100 * 100) / 100;

    const currentLongPct = Number((row.payload as Record<string, unknown>).long_pct);
    const currentShortPct = Number((row.payload as Record<string, unknown>).short_pct);
    const currentDecision = String((row.payload as Record<string, unknown>).decision ?? '');

    const isMismatch =
      Math.abs((currentLongPct || 0) - correctLongPct) > 0.5 ||
      Math.abs((currentShortPct || 0) - correctShortPct) > 0.5 ||
      currentDecision !== csv.final_decision;

    if (!isMismatch) {
      alreadyCorrect += 1;
      continue;
    }

    const patch = {
      price: csv.close,
      long_pct: correctLongPct,
      short_pct: correctShortPct,
      wait_pct: correctWaitPct,
      hc: csv.hc_score,
      decision: csv.final_decision,
    };

    await prisma.$executeRawUnsafe(
      `UPDATE eden_mobile_signal_history SET payload = payload || $2::jsonb, updated_at = NOW() WHERE bucket_ts = $1::timestamptz`,
      iso,
      JSON.stringify(patch),
    );
    corrected += 1;
  }

  console.log('\n=== BACKFILL SUMMARY ===');
  console.log(`corrected:        ${corrected}`);
  console.log(`already correct:  ${alreadyCorrect}`);
  console.log(`no CSV match:     ${noCsvMatch}`);
  console.log(`total DB rows:    ${dbRows.length}`);

  // ── 검증: 백필 후 CSV vs DB 전수 대조 (겹치는 bucket 전체) ──
  console.log('\n[verify] re-reading DB after backfill ...');
  const verifyRows = await prisma.$queryRawUnsafe<{ bucket_ts: Date; payload: Record<string, unknown> }[]>(
    `SELECT bucket_ts, payload FROM eden_mobile_signal_history ORDER BY bucket_ts ASC`,
  );
  let mismatches = 0;
  let compared = 0;
  for (const row of verifyRows) {
    const iso = new Date(row.bucket_ts).toISOString();
    const csv = csvByTs.get(iso);
    if (!csv) continue;
    compared += 1;
    const correctLongPct = Math.round(csv.prob_long * 100 * 100) / 100;
    const correctShortPct = Math.round(csv.prob_short * 100 * 100) / 100;
    const dbLongPct = Number((row.payload as Record<string, unknown>).long_pct);
    const dbShortPct = Number((row.payload as Record<string, unknown>).short_pct);
    if (Math.abs(dbLongPct - correctLongPct) > 0.5 || Math.abs(dbShortPct - correctShortPct) > 0.5) {
      mismatches += 1;
      if (mismatches <= 5) {
        console.log(
          `  MISMATCH ${iso}: db long=${dbLongPct} short=${dbShortPct} vs csv long=${correctLongPct} short=${correctShortPct}`,
        );
      }
    }
  }
  console.log(`\n[verify] compared=${compared}, mismatches=${mismatches}`);
  if (mismatches === 0) {
    console.log('[verify] PASS — zero mismatches after backfill.');
  } else {
    console.log('[verify] FAIL — mismatches remain.');
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
