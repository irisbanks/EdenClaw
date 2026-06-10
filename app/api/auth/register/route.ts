import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_ALLOCATION = BigInt(2_000_000); // 가입 즉시 기본 제공 토큰
const ZERO = BigInt(0);
const MAX_SPILLOVER = 4096; // 스필오버 BFS 안전 가드

type Side = 'LEFT' | 'RIGHT';

/**
 * 지정 leg 하위에서 첫 빈자리를 BFS 로 찾는 바이너리 스필오버 배치.
 * 직속 다리가 차 있으면 그 서브트리의 가장 얕은 빈 슬롯으로 흘려보내 "누수 없이" 배치한다.
 */
async function findSlot(
  tx: Prisma.TransactionClient,
  rootId: string,
  preferred: Side
): Promise<{ parentId: string; position: Side }> {
  const childrenOf = async (id: string) => {
    const kids = await tx.user.findMany({ where: { parentId: id }, select: { id: true, position: true } });
    return {
      LEFT: kids.find((k) => k.position === 'LEFT')?.id ?? null,
      RIGHT: kids.find((k) => k.position === 'RIGHT')?.id ?? null,
    };
  };

  // 1) 루트의 지정 다리가 비어 있으면 즉시 배치
  const rootKids = await childrenOf(rootId);
  if (!rootKids[preferred]) return { parentId: rootId, position: preferred };

  // 2) 지정 다리 서브트리로 스필오버 (LEFT 우선 → RIGHT)
  const queue: string[] = [rootKids[preferred] as string];
  let guard = 0;
  while (queue.length && guard++ < MAX_SPILLOVER) {
    const cur = queue.shift() as string;
    const kids = await childrenOf(cur);
    if (!kids.LEFT) return { parentId: cur, position: 'LEFT' };
    if (!kids.RIGHT) return { parentId: cur, position: 'RIGHT' };
    queue.push(kids.LEFT, kids.RIGHT);
  }
  throw new Error('배치 가능한 슬롯을 찾지 못했습니다(스필오버 한도 초과).');
}

/**
 * POST — 신규 회원 가입.
 * body: { email, name?, sponsorId?, parentId?, position?('LEFT'|'RIGHT') }
 *
 * - sponsorId(직추천인) 기록 + parentId(없으면 sponsorId) 기준 바이너리 자동 배치.
 * - 유저 생성 + TokenQuota(2,000,000) + LegBalance(0) 를 하나의 트랜잭션으로 원자 처리.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, name, sponsorId } = body;
    const parentIdInput: string | undefined = body.parentId;
    const preferred: Side = body.position === 'RIGHT' ? 'RIGHT' : 'LEFT';

    if (!email) return NextResponse.json({ error: 'email 이 필요합니다.' }, { status: 400 });

    // 배치 기준 루트: parentId 우선, 없으면 sponsorId, 둘 다 없으면 최상위(root)
    const placementRootId = parentIdInput || sponsorId || null;

    const result = await prisma.$transaction(async (tx) => {
      // 이메일 중복
      const exists = await tx.user.findUnique({ where: { email }, select: { id: true } });
      if (exists) throw new Error('EMAIL_TAKEN');

      // 추천인/상위 존재 검증
      if (sponsorId) {
        const s = await tx.user.findUnique({ where: { id: sponsorId }, select: { id: true } });
        if (!s) throw new Error('SPONSOR_NOT_FOUND');
      }
      let placement: { parentId: string; position: Side } | null = null;
      if (placementRootId) {
        const root = await tx.user.findUnique({ where: { id: placementRootId }, select: { id: true } });
        if (!root) throw new Error('PARENT_NOT_FOUND');
        placement = await findSlot(tx, placementRootId, preferred);
      }

      // 유저 생성 (배치 정보 포함)
      const user = await tx.user.create({
        data: {
          email,
          name: name ?? null,
          sponsorId: sponsorId ?? null,
          parentId: placement?.parentId ?? null,
          position: placement?.position ?? null,
          subscriptionStatus: 'ACTIVE',
        },
      });

      // 기본 토큰 쿼터 + 빈 원장 (누락 방지: 트랜잭션 내 동시 생성)
      await tx.tokenQuota.create({ data: { userId: user.id, allocated: DEFAULT_ALLOCATION, consumed: ZERO } });
      await tx.legBalance.create({ data: { userId: user.id } });

      return { user, placement };
    });

    return NextResponse.json({
      ok: true,
      userId: result.user.id,
      email: result.user.email,
      sponsorId: result.user.sponsorId,
      placement: result.placement ?? { parentId: null, position: 'ROOT' },
      allocatedTokens: Number(DEFAULT_ALLOCATION),
      subscriptionStatus: result.user.subscriptionStatus,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const map: Record<string, [string, number]> = {
      EMAIL_TAKEN: ['이미 가입된 이메일입니다.', 409],
      SPONSOR_NOT_FOUND: ['추천인(sponsorId)을 찾을 수 없습니다.', 400],
      PARENT_NOT_FOUND: ['상위(parentId)를 찾을 수 없습니다.', 400],
    };
    if (map[msg]) return NextResponse.json({ error: map[msg][0] }, { status: map[msg][1] });
    console.error('[auth/register]', error);
    return NextResponse.json({ error: '가입 처리 실패' }, { status: 500 });
  }
}
