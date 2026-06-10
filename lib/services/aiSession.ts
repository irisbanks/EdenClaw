import crypto from 'crypto';
import { redis } from '@/lib/redis';

const PREFIX = 'aisession:';
const TTL_SEC = Number(process.env.AI_SESSION_TTL_SEC) || 86400; // 24h

/** 외부 개발툴(Claude Code/Cursor 등) 세션 발급 → 토큰 ↔ userId 매핑을 Redis 에 보관 */
export async function createSession(userId: string): Promise<{ token: string; expiresIn: number }> {
  const token = crypto.randomBytes(24).toString('hex');
  await redis.set(PREFIX + token, userId, 'EX', TTL_SEC);
  return { token, expiresIn: TTL_SEC };
}

/** 세션 토큰 → userId (만료/무효 시 null) */
export async function resolveSession(token: string | null | undefined): Promise<string | null> {
  if (!token) return null;
  return redis.get(PREFIX + token);
}

export async function revokeSession(token: string): Promise<void> {
  await redis.del(PREFIX + token);
}
