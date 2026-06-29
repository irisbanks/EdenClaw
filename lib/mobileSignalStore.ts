// Durable storage for the latest mobile manual-order signal.
// There is deliberately no serverless in-memory fallback: it would be inconsistent
// across Vercel instances. No exchange data, credentials, or order capability live here.

import { redis } from '@/lib/redis';
import {
  NO_SIGNAL_RESPONSE,
  type MobileOrderSignal,
  type NoSignalResponse,
} from '@/lib/mobileSignalSchema';

const KEY = 'eden:mobile_signal:latest';
const TTL_SEC = 60 * 60; // 1h; the bridge refreshes well within this

export type SaveResult = { ok: true; backend: 'redis' } | { ok: false; error: 'STORAGE_NOT_CONFIGURED' };

export function isSignalStorageConfigured(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

export async function saveSignal(signal: MobileOrderSignal): Promise<SaveResult> {
  if (!isSignalStorageConfigured()) {
    return { ok: false, error: 'STORAGE_NOT_CONFIGURED' };
  }

  try {
    await redis.set(KEY, JSON.stringify(signal), 'EX', TTL_SEC);
    return { ok: true, backend: 'redis' };
  } catch {
    return { ok: false, error: 'STORAGE_NOT_CONFIGURED' };
  }
}

export async function getLatestSignal(): Promise<MobileOrderSignal | NoSignalResponse> {
  if (!isSignalStorageConfigured()) return { ...NO_SIGNAL_RESPONSE };

  try {
    const raw = await redis.get(KEY);
    if (!raw) return { ...NO_SIGNAL_RESPONSE };
    return JSON.parse(raw) as MobileOrderSignal;
  } catch {
    return { ...NO_SIGNAL_RESPONSE };
  }
}
