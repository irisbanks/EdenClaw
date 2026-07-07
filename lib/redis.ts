import crypto from 'node:crypto';
import Redis from 'ioredis';

// Next.js dev 핫리로드 시 커넥션 누수 방지 (lib/prisma.ts 패턴과 동일)
const globalForRedis = globalThis as unknown as {
  redis?: Redis;
  redisErrorListenerAttached?: boolean;
  redisWarningShown?: boolean;
};

export const redis =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    connectTimeout: 1_000,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    retryStrategy(times) {
      return times > 2 ? null : Math.min(times * 250, 1_000);
    },
  });

if (!globalForRedis.redisErrorListenerAttached) {
  redis.on('error', (error) => {
    if (process.env.NODE_ENV === 'production') return;
    if (globalForRedis.redisWarningShown) return;
    globalForRedis.redisWarningShown = true;
    console.warn('[redis] Quota cache unavailable; falling back to Prisma source of truth.', error.message);
  });
  globalForRedis.redisErrorListenerAttached = true;
}

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;

/** 토큰 쿼터 캐시 TTL (초) — 토큰 가드 / 결제 웹훅이 공유 */
export const QUOTA_TTL_SEC = 600;

/** 유저별 잔여 토큰 캐시 키 */
export const quotaKey = (userId: string) => `quota:${userId}`;

const SEMAPHORE_LOCK_TTL_SEC = 10;
const RESPONSE_CACHE_TTL_SEC = 3600;

function promptHash(prompt: string): string {
  return crypto.createHash('sha256').update(prompt).digest('hex');
}

/**
 * 실시간 세마포어 락.
 * 같은 유저가 같은 프롬프트를 짧은 시간 안에 반복 호출해 토큰과 비용이 새는 것을 막는다.
 */
export async function acquireSemaphoreLock(userId: string, prompt: string): Promise<boolean> {
  try {
    const lockKey = `semaphore:${userId}:${promptHash(prompt)}`;
    const result = await redis.set(lockKey, '1', 'EX', SEMAPHORE_LOCK_TTL_SEC, 'NX');
    return result === 'OK';
  } catch {
    // Redis 장애가 핵심 AI 응답을 막지 않도록 열어 둔다.
    return true;
  }
}

export async function getCachedResponse<T = unknown>(model: string, prompt: string): Promise<T | null> {
  const cacheKey = `response:${model}:${promptHash(prompt)}`;
  try {
    const cached = await redis.get(cacheKey);
    if (!cached) return null;
    return JSON.parse(cached) as T;
  } catch {
    return null;
  }
}

export async function setCachedResponse(model: string, prompt: string, data: unknown): Promise<void> {
  const cacheKey = `response:${model}:${promptHash(prompt)}`;
  try {
    await redis.set(cacheKey, JSON.stringify(data), 'EX', RESPONSE_CACHE_TTL_SEC);
  } catch {
    // Redis is an optimization layer. Ignore cache write failures.
  }
}

export default redis;
