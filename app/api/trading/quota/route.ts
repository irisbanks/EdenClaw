import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { loadGasAccountByEmail, quotaView, executeOverdraftLedgerSwap } from '@/lib/services/overdraftLedger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_ALLOCATION = BigInt(2_000_000);
const ZERO = BigInt(0);

/**
 * 대시보드/UserProvider가 폴링하는 읽기 전용 쿼터 조회.
 * 이전에는 GET 핸들러 자체가 없어 프론트가 항상 405 를 받았다.
 */
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')?.trim();
  if (!email) return NextResponse.json({ error: 'email 이 필요합니다.' }, { status: 400 });

  const account = await loadGasAccountByEmail(email);
  if (!account || !account.tokenQuota) {
    return NextResponse.json({ error: '가입되지 않은 이메일이거나 쿼터가 없습니다.' }, { status: 404 });
  }
  return NextResponse.json(quotaView(account));
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const action = body.action;
    if (!email) return NextResponse.json({ error: 'email 이 필요합니다.' }, { status: 400 });

    const account = await loadGasAccountByEmail(email);
    if (!account || !account.tokenQuota) {
      return NextResponse.json({ error: '가입되지 않은 이메일이거나 쿼터가 없습니다.' }, { status: 404 });
    }

    if (action === 'overdraft') {
      const result = await executeOverdraftLedgerSwap(account.id);
      if (!result.ok) {
        return NextResponse.json(
          { error: result.message, code: result.code, quota: result.quota },
          { status: result.code === 'ALREADY_ADVANCED' ? 409 : 400 },
        );
      }
      return NextResponse.json({
        ...result.quota,
        swapped: result.swappedGas,
        mode: result.mode,
      });
    }

    if (action === 'reset') {
      // 데모/샌드박스 세션 리셋 — action='reset' 을 명시적으로 요청했을 때만
      // 기본 쿼터로 되돌린다.
      //
      // 이전 구현은 action 값을 아예 읽지 않고, 이 라우트가 호출되기만 하면
      // (조회든 오버드래프트든 무관하게) 매번 upsert 로 allocated=2,000,000 /
      // consumed=0 을 강제 기록했다 — 대시보드가 GET 조회만 해도 실사용자
      // 쿼터가 매번 무료로 리셋되는 과금 우회 버그였다.
      await prisma.tokenQuota.update({
        where: { userId: account.id },
        data: { allocated: DEFAULT_ALLOCATION, consumed: ZERO },
      });
      const fresh = await loadGasAccountByEmail(email);
      return NextResponse.json(quotaView(fresh!));
    }

    return NextResponse.json({ error: `알 수 없는 action: ${String(action)}` }, { status: 400 });
  } catch (error) {
    console.error('[trading/quota]', error);
    return NextResponse.json({ error: '처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
