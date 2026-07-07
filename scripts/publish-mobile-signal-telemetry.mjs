#!/usr/bin/env node

/**
 * Publishes display-only EDENCLAW telemetry to the Vercel dashboard relay.
 *
 * Safety invariants:
 * - reads only the local public dashboard endpoint;
 * - posts only chart/status JSON to the app's telemetry endpoint;
 * - never reads exchange credentials and never calls an exchange API;
 * - contains no order placement capability.
 */

const localUrl = process.env.EDEN_LOCAL_TELEMETRY_URL || 'http://localhost:3000/api/mobile-order-signal/live';
const remoteUrl = process.env.EDEN_REMOTE_TELEMETRY_URL || 'https://edenclaw-ai.vercel.app/api/mobile-order-signal/live';
const secret = process.env.EDEN_MOBILE_TELEMETRY_SECRET?.trim();
const loop = process.argv.includes('--loop');
const intervalArg = process.argv.indexOf('--interval-seconds');
const intervalSeconds = intervalArg >= 0 ? Number(process.argv[intervalArg + 1]) : 20;

if (!secret) {
  throw new Error('EDEN_MOBILE_TELEMETRY_SECRET is required');
}
if (!Number.isFinite(intervalSeconds) || intervalSeconds < 5) {
  throw new Error('interval must be at least 5 seconds');
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function publishOnce() {
  const localResponse = await fetch(localUrl, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!localResponse.ok) throw new Error(`local telemetry returned ${localResponse.status}`);

  const payload = await localResponse.json();
  if (
    payload?.safety?.bot_order_execution !== 'DISABLED' ||
    payload?.safety?.real_order_sent_by_bot !== false ||
    payload?.bot?.live_trading_enabled === true ||
    Number(payload?.bot?.real_orders_placed || 0) !== 0
  ) {
    throw new Error('telemetry safety invariant failed');
  }

  const remoteResponse = await fetch(remoteUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!remoteResponse.ok) {
    const message = (await remoteResponse.text()).slice(0, 240);
    throw new Error(`remote telemetry returned ${remoteResponse.status}: ${message}`);
  }

  const result = await remoteResponse.json();
  process.stdout.write(
    `[${new Date().toISOString()}] telemetry stored=${result.stored === true} backend=${result.backend || 'unknown'}\n`,
  );
}

do {
  try {
    await publishOnce();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[${new Date().toISOString()}] telemetry publish failed: ${message}\n`);
    if (!loop) process.exitCode = 1;
  }
  if (loop) await delay(intervalSeconds * 1000);
} while (loop);
