import { prisma } from '@/lib/prisma';
import { DualShieldMLMEngine } from '@/lib/services/binaryEngine';

const MAX_UPLINE_DEPTH = 1024; // 트리 순회 사이클/폭주 방지 가드

/**
 * 발생한 PV/BV 를 한 유저의 전체 상위 라인(무한 뎁스)에 전파하고,
 * 갱신된 모든 조상에 대해 바이너리 매칭 수당을 정산한다.
 *
 * - 각 조상의 적립 다리(LEFT/RIGHT)는 "경로상 직속 자식의 position" 으로 결정된다.
 * - 토큰 소비 전파는 보통 bv=0 (현금 미발생). 실결제 전파는 pv,bv 모두 > 0.
 * - 실패가 상위 트랜잭션(결제/소비)을 되돌리지 않도록 try/catch 로 격리한다.
 */
export async function propagateAndSettle(originUserId: string, pv: number, bv: number): Promise<void> {
  if (pv <= 0 && bv <= 0) return;
  try {
    const touched: string[] = [];

    let node = await prisma.user.findUnique({
      where: { id: originUserId },
      select: { id: true, position: true, parentId: true },
    });

    let depth = 0;
    while (node?.parentId && depth < MAX_UPLINE_DEPTH) {
      const parentId = node.parentId;
      const leg = node.position; // 직속 자식의 위치 = 부모의 적립 다리

      if (leg !== 'LEFT' && leg !== 'RIGHT') break; // 미배치 노드 → 전파 중단

      const isLeft = leg === 'LEFT';
      await prisma.legBalance.upsert({
        where: { userId: parentId },
        update: isLeft
          ? { leftPV: { increment: pv }, leftBV: { increment: bv } }
          : { rightPV: { increment: pv }, rightBV: { increment: bv } },
        create: {
          userId: parentId,
          leftPV: isLeft ? pv : 0,
          leftBV: isLeft ? bv : 0,
          rightPV: isLeft ? 0 : pv,
          rightBV: isLeft ? 0 : bv,
        },
      });
      touched.push(parentId);

      node = await prisma.user.findUnique({
        where: { id: parentId },
        select: { id: true, position: true, parentId: true },
      });
      depth++;
    }

    // 갱신된 조상들에 대해 매칭 정산 (각 노드 독립적, 캡/이월은 엔진이 처리)
    for (const ancestorId of touched) {
      await DualShieldMLMEngine.settleMatchingBonus(ancestorId);
    }
  } catch (error) {
    console.error('[binarySettlement] 상위 라인 전파/정산 실패(격리됨):', error);
  }
}
