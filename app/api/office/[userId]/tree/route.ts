import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_DEPTH = 6; // 시각화 깊이 제한 (롤업은 전체 서브트리 기준)

interface TreeNode {
  id: string;
  position: 'LEFT' | 'RIGHT' | 'ROOT';
  epBalance: number;
  subscriptionStatus: string;
  ownPV: number; // 본인 결제로 발생한 PV
  rollupPV: number; // 본인 + 전체 하위 라인 누적 PV
  leftPV: number; // 원장상 좌측 미매칭 PV
  rightPV: number; // 원장상 우측 미매칭 PV
  childCount: number; // 직속 하위 수
  left: TreeNode | null;
  right: TreeNode | null;
  truncated?: boolean; // 깊이 제한으로 잘림
}

/** 한 유저의 본인 결제 PV(구독/충전) 합계 */
async function ownPurchasePV(userId: string): Promise<number> {
  const agg = await prisma.transaction.aggregate({
    where: { userId, txType: { in: ['SUBSCRIPTION', 'TOKEN_PACK'] } },
    _sum: { pvGenerated: true },
  });
  return Number(agg._sum.pvGenerated ?? 0);
}

async function buildNode(
  userId: string,
  position: TreeNode['position'],
  depth: number
): Promise<TreeNode | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { legBalance: true },
  });
  if (!user) return null;

  const children = await prisma.user.findMany({
    where: { parentId: userId },
    select: { id: true, position: true },
  });
  const leftChildId = children.find((c) => c.position === 'LEFT')?.id ?? null;
  const rightChildId = children.find((c) => c.position === 'RIGHT')?.id ?? null;

  const ownPV = await ownPurchasePV(userId);

  const node: TreeNode = {
    id: user.id,
    position,
    epBalance: user.epBalance,
    subscriptionStatus: user.subscriptionStatus,
    ownPV,
    rollupPV: ownPV,
    leftPV: user.legBalance?.leftPV ?? 0,
    rightPV: user.legBalance?.rightPV ?? 0,
    childCount: children.length,
    left: null,
    right: null,
  };

  if (depth >= MAX_DEPTH) {
    node.truncated = children.length > 0;
    // 깊이 제한 시 직속 하위 PV만 롤업에 가산(근사)
    return node;
  }

  if (leftChildId) node.left = await buildNode(leftChildId, 'LEFT', depth + 1);
  if (rightChildId) node.right = await buildNode(rightChildId, 'RIGHT', depth + 1);

  node.rollupPV = ownPV + (node.left?.rollupPV ?? 0) + (node.right?.rollupPV ?? 0);
  return node;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const root = await buildNode(userId, 'ROOT', 0);
  if (!root) return NextResponse.json({ error: '유저를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ root });
}
