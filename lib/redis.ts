import Redis from 'ioredis';

// Next.js dev 핫리로드 시 커넥션 누수 방지 (lib/prisma.ts 패턴과 동일)
const globalForRedis = globalThis as unknown as { redis?: Redis };

export const redis =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  });

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;

/** 토큰 쿼터 캐시 TTL (초) — 토큰 가드 / 결제 웹훅이 공유 */
export const QUOTA_TTL_SEC = 600;

/** 유저별 잔여 토큰 캐시 키 */
export const quotaKey = (userId: string) => `quota:${userId}`;

export default redis;
