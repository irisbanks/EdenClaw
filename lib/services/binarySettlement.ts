import { prisma } from '@/lib/prisma';
import { DualShieldMLMEngine } from '@/lib/services/binaryEngine';

const MAX_UPLINE_DEPTH = 1024; // 트리 순회 사이클/폭주 방지 가드

/**
 * 발생한 PV/BV 를 한 유저의 전체 상위 라인(무한 뎁스)에 전파하고,
 * 갱신된 모든 조상에 대해 바이너리 매칭 수당을 정산한다.
 *
 * - 각 조상의 적립 다리(LEFT/RIGHT)는 "경로상 직속 자식의 position" 으로 결정된다.
 * - 토큰 소비 전파는 보통 bv=0 (현금 미발생). 실결제 전파는 pv,bv 모두 > 0.
 * - 전파는 하나의 트랜잭션으로 처리해 중간 실패 시 일부 조상만 갱신되는 상태를 막는다.
 */
export async function propagateAndSettle(originUserId: string, pv: number, bv: number): Promise<void> {
  if (pv <= 0 && bv <= 0) return;
  if (![pv, bv].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error('PV/BV는 0 이상의 유한한 숫자여야 합니다.');
  }

  const touched = await prisma.$transaction(async (tx) => {
    const touched: string[] = [];
    const visited = new Set<string>([originUserId]);

    let node = await tx.user.findUnique({
      where: { id: originUserId },
      select: { id: true, position: true, parentId: true },
    });
    if (!node) throw new Error(`실적 발생 유저를 찾을 수 없습니다: ${originUserId}`);

    let depth = 0;
    while (node?.parentId && depth < MAX_UPLINE_DEPTH) {
      const parentId: string = node.parentId;
      const leg = node.position; // 직속 자식의 위치 = 부모의 적립 다리

      if (visited.has(parentId)) throw new Error(`바이너리 계보 순환이 감지되었습니다: ${parentId}`);
      if (leg !== 'LEFT' && leg !== 'RIGHT') {
        throw new Error(`배치 방향이 유효하지 않습니다: ${node.id}`);
      }
      visited.add(parentId);

      const isLeft = leg === 'LEFT';
      await tx.legBalance.upsert({
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

      node = await tx.user.findUnique({
        where: { id: parentId },
        select: { id: true, position: true, parentId: true },
      });
      if (!node) throw new Error(`상위 유저를 찾을 수 없습니다: ${parentId}`);
      depth++;
    }

    if (node?.parentId && depth >= MAX_UPLINE_DEPTH) {
      throw new Error(`바이너리 계보 깊이가 안전 한도(${MAX_UPLINE_DEPTH})를 초과했습니다.`);
    }

    return touched;
  }, { maxWait: 10_000, timeout: 30_000 });

  // 갱신된 조상들에 대해 매칭 정산 (각 노드 독립적, 캡/이월은 엔진이 처리)
  for (const ancestorId of touched) {
    await DualShieldMLMEngine.settleMatchingBonus(ancestorId);
  }
}
