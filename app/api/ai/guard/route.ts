import { NextResponse } from 'next/server';
import { checkQuota, settleUsage, LOCKED_PAYLOAD } from '@/lib/services/tokenGuard';

// better-sqlite3 어댑터 + ioredis는 네이티브 모듈이라 Edge 런타임 불가.
export const runtime = 'nodejs';
// 토큰 잔액 검증/정산은 절대 캐시되면 안 됨.
export const dynamic = 'force-dynamic';

// 1. AI 호출 전 잔여 토큰 검증 단계
export async function POST(request: Request) {
  try {
    const { userId, estimatedTokens } = await request.json();
    if (!userId) {
      return NextResponse.json({ error: '유저 식별 정보가 누락되었습니다.' }, { status: 400 });
    }

    const result = await checkQuota(userId, estimatedTokens);

    if (result.status === 'NO_QUOTA') {
      return NextResponse.json({ error: '쿼터 정보 없음' }, { status: 404 });
    }

    // [마이너스 방지벽] 토큰 고갈 시 402 코드와 함께 디지털 마켓 결제 유도
    if (result.status === 'LOCKED') {
      return NextResponse.json(
        { ...LOCKED_PAYLOAD, remaining: result.remaining },
        { status: 402 } // Payment Required 표준 프로토콜 반환
      );
    }

    return NextResponse.json({ status: 'ALLOWED', remaining: result.remaining });
  } catch (error) {
    console.error('[token-guard][POST]', error);
    return NextResponse.json({ error: '인프라 레이어 장애' }, { status: 500 });
  }
}

// 2. AI 호출 완료 후 실제 사용된 토큰 정산 단계
export async function PUT(request: Request) {
  try {
    const { userId, actualTokens } = await request.json();
    if (!userId) {
      return NextResponse.json({ success: false, error: '유저 식별 정보 누락' }, { status: 400 });
    }

    const remaining = await settleUsage(userId, actualTokens);
    return NextResponse.json({ success: true, remaining });
  } catch (error) {
    console.error('[token-guard][PUT]', error);
    return NextResponse.json({ success: false, error: '정산 반영 실패' }, { status: 500 });
  }
}
