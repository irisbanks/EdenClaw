import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { createSession, resolveSession } from '@/lib/services/aiSession';
import { verifyTokenQuota, settleUsage, LOCKED_PAYLOAD } from '@/lib/services/tokenGuard';

// prisma(better-sqlite3) + ioredis 네이티브 모듈 → Edge 불가, 캐시 금지
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 외부 연동 API 키 검증 (EDEN_AI_API_KEY 설정 시 강제, 미설정 시 개발 통과) */
function authorized(req: Request): boolean {
  const required = process.env.EDEN_AI_API_KEY;
  if (!required) return process.env.NODE_ENV !== 'production'; // 프로덕션은 키 필수
  const provided = req.headers.get('x-eden-api-key') || '';
  try {
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(required, 'utf8');
    return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * POST — 외부 개발툴(Claude Code/Cursor) 세션 생성.
 * body: { userId }  header: X-Eden-Api-Key
 * 유저 인증(존재 + ACTIVE) 후 세션 토큰 + 잔여 토큰 스냅샷 반환.
 */
export async function POST(request: Request) {
  try {
    if (!authorized(request)) {
      return NextResponse.json({ error: 'API 키 인증 실패' }, { status: 401 });
    }
    const { userId } = await request.json();
    if (!userId) return NextResponse.json({ error: 'userId 가 필요합니다.' }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, subscriptionStatus: true } });
    if (!user) return NextResponse.json({ error: '존재하지 않는 계정' }, { status: 404 });
    if (user.subscriptionStatus !== 'ACTIVE') {
      return NextResponse.json(
        { ...LOCKED_PAYLOAD, reason: 'INACTIVE', message: '구독이 비활성 상태입니다. 결제 후 이용하세요.' },
        { status: 402 }
      );
    }

    const session = await createSession(user.id);
    const quota = await verifyTokenQuota(user.id);
    return NextResponse.json({
      ok: true,
      sessionToken: session.token,
      userId: user.id,
      expiresIn: session.expiresIn,
      remaining: quota.status === 'ALLOWED' || quota.status === 'LOCKED' ? quota.remaining : 0,
    });
  } catch (error) {
    console.error('[ai/session][POST]', error);
    return NextResponse.json({ error: '세션 생성 실패' }, { status: 500 });
  }
}

/**
 * PUT — 세션 기반 토큰 가드 (AI 구동 시마다 강제 통과 지점).
 * body: { sessionToken?, phase?: 'check'|'settle', estimatedTokens?, actualTokens? }
 *       (sessionToken 은 X-Eden-Session 헤더로도 가능)
 *  - phase 'check'  : 잔액 검증. 부족 시 402 + 결제 팝업 URL.
 *  - phase 'settle' : 실사용 토큰 차감(+ 상위 라인 전파 자동 적재).
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = body.sessionToken || request.headers.get('x-eden-session');
    const userId = await resolveSession(token);
    if (!userId) return NextResponse.json({ error: '유효하지 않은 세션' }, { status: 401 });

    const phase = body.phase === 'settle' ? 'settle' : 'check';

    if (phase === 'settle') {
      const remaining = await settleUsage(userId, body.actualTokens);
      return NextResponse.json({ ok: true, phase, userId, remaining });
    }

    // phase === 'check'
    const result = await verifyTokenQuota(userId, body.estimatedTokens);
    if (result.status === 'NO_QUOTA') {
      return NextResponse.json({ ...LOCKED_PAYLOAD, remaining: 0 }, { status: 402 });
    }
    if (result.status === 'LOCKED') {
      // 토큰 소진 → 즉시 결제 팝업 URL 반환
      return NextResponse.json({ ...LOCKED_PAYLOAD, remaining: result.remaining }, { status: 402 });
    }
    return NextResponse.json({ ok: true, status: 'ALLOWED', phase, userId, remaining: result.remaining });
  } catch (error) {
    console.error('[ai/session][PUT]', error);
    return NextResponse.json({ error: '세션 가드 처리 실패' }, { status: 500 });
  }
}
