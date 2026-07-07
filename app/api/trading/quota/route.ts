import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { loadGasAccountByEmail, quotaView, executeOverdraftLedgerSwap } from '@/lib/services/overdraftLedger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_ALLOCATION = BigInt(2_000_000);
const ZERO = BigInt(0);
type QuotaAction = 'overdraft' | 'reset';
type QuotaBody = {
  email?: unknown;
  action?: unknown;
};

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAction(value: unknown): QuotaAction | null {
  return value === 'overdraft' || value === 'reset' ? value : null;
}

function jsonError(error: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    {
      success: false,
      ok: false,
      error,
      ...extra,
    },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function jsonQuota(quota: ReturnType<typeof quotaView>, extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    {
      success: true,
      ok: true,
      quota,
      ...quota,
      ...extra,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * 대시보드/UserProvider가 폴링하는 읽기 전용 쿼터 조회.
 * 이전에는 GET 핸들러 자체가 없어 프론트가 항상 405 를 받았다.
 */
export async function GET(req: NextRequest) {
  try {
    const email = normalizeEmail(req.nextUrl.searchParams.get('email'));
    if (!email) return jsonError('email 이 필요합니다.', 400);

    const account = await loadGasAccountByEmail(email);
    if (!account || !account.tokenQuota) {
      return jsonError('가입되지 않은 이메일이거나 쿼터가 없습니다.', 404);
    }
    return jsonQuota(quotaView(account));
  } catch (dbError: unknown) {
    console.error('[trading/quota][GET]', dbError);
    return jsonError('처리 중 오류가 발생했습니다.', 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as QuotaBody;
    const email = normalizeEmail(body.email);
    const action = normalizeAction(body.action);
    if (!email) return jsonError('email 이 필요합니다.', 400);

    const account = await loadGasAccountByEmail(email);
    if (!account || !account.tokenQuota) {
      return jsonError('가입되지 않은 이메일이거나 쿼터가 없습니다.', 404);
    }

    // POST 조회도 허용한다. 일부 프론트/콘솔이 쿼터 조회를 POST로 호출해도
    // 405/빈 응답 없이 동일한 정형 JSON을 받게 하기 위한 호환 경로다.
    if (!action) {
      return jsonQuota(quotaView(account), { mode: 'READ' });
    }

    if (action === 'overdraft') {
      const result = await executeOverdraftLedgerSwap(account.id);
      if (!result.ok) {
        return jsonError(
          result.message,
          result.code === 'ALREADY_ADVANCED' ? 409 : 400,
          { code: result.code, quota: result.quota },
        );
      }
      return jsonQuota(result.quota, {
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
      return jsonQuota(quotaView(fresh!), { mode: 'RESET' });
    }

    return jsonError(`알 수 없는 action: ${String(body.action)}`, 400);
  } catch (dbError: unknown) {
    console.error('[trading/quota][POST]', dbError);
    return jsonError('처리 중 오류가 발생했습니다.', 500);
  }
}
