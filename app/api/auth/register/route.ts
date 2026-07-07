import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_ALLOCATION = BigInt(2_000_000); // 가입 즉시 기본 제공 토큰
const ZERO = BigInt(0);
const MAX_SPILLOVER = 4096; // 스필오버 BFS 안전 가드
const MAX_PLACEMENT_RETRIES = 16; // 낙관적 동시성 재시도 한도 — 트리 초기(열린 슬롯이 1~2개뿐)엔 재시도가 몰릴 수 있어 여유를 둔다

/**
 * Prisma P2002(unique 충돌)가 지정한 필드 조합에서 난 것인지 확인.
 * @prisma/adapter-pg(드라이버 어댑터) 경로에서는 error.meta.target 이 채워지지
 * 않고 (실측으로 확인) 필드명이 error.message 문자열에만 나온다 — 그래서
 * meta.target 과 message 둘 다 확인해야 두 실행 경로 모두에서 안전하다.
 */
function isUniqueViolation(error: unknown, fields: string[]): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  const targetStr = Array.isArray(target) ? target.join(',') : String(target ?? '');
  const haystack = `${targetStr} ${error.message}`;
  return fields.every((f) => haystack.includes(f));
}

type Side = 'LEFT' | 'RIGHT';

/**
 * 지정 leg 하위에서 빈자리를 BFS 로 찾는 바이너리 스필오버 배치.
 * 직속 다리가 차 있으면 그 서브트리의 가장 얕은 빈 슬롯으로 흘려보내 "누수 없이" 배치한다.
 *
 * 레벨 단위로 한 번에 조회(노드 하나씩이 아니라)해 왕복 횟수를 줄이고, 같은
 * 레벨에 열린 자리가 여럿이면 그중 하나를 무작위로 고른다 — 동시 가입 다수가
 * 낙관적 재시도로 매번 "가장 얕은 슬롯 단 하나"에만 몰려 재시도가 눈덩이처럼
 * 불어나는 걸 실측으로 확인했다(재시도 8회로도 부족). 여러 후보에 흩어지게
 * 하면 재시도끼리 충돌할 확률이 크게 낮아진다.
 */
async function findSlot(
  tx: Prisma.TransactionClient,
  rootId: string,
  preferred: Side
): Promise<{ parentId: string; position: Side }> {
  // 1) 루트의 지정 다리가 비어 있으면 즉시 배치
  const rootKids = await tx.user.findMany({ where: { parentId: rootId }, select: { id: true, position: true } });
  const rootPreferredChild = rootKids.find((k) => k.position === preferred);
  if (!rootPreferredChild) return { parentId: rootId, position: preferred };

  // 2) 지정 다리 서브트리를 레벨 단위 BFS 로 탐색
  let frontier: string[] = [rootPreferredChild.id];
  let levels = 0;
  while (frontier.length > 0 && levels++ < MAX_SPILLOVER) {
    const kids = await tx.user.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true, parentId: true, position: true },
    });
    const byParent = new Map<string, { LEFT?: string; RIGHT?: string }>();
    for (const pid of frontier) byParent.set(pid, {});
    for (const k of kids) {
      const entry = byParent.get(k.parentId as string);
      if (!entry) continue;
      if (k.position === 'LEFT') entry.LEFT = k.id;
      if (k.position === 'RIGHT') entry.RIGHT = k.id;
    }

    const openSlots: { parentId: string; position: Side }[] = [];
    const nextFrontier: string[] = [];
    for (const [pid, entry] of byParent) {
      if (!entry.LEFT) openSlots.push({ parentId: pid, position: 'LEFT' });
      else nextFrontier.push(entry.LEFT);
      if (!entry.RIGHT) openSlots.push({ parentId: pid, position: 'RIGHT' });
      else nextFrontier.push(entry.RIGHT);
    }

    if (openSlots.length > 0) {
      return openSlots[Math.floor(Math.random() * openSlots.length)];
    }
    frontier = nextFrontier;
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

    // 사전 검증 (재시도 루프 밖에서 한 번만 — 존재 여부는 재시도 중 바뀌지 않는다)
    const exists = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (exists) throw new Error('EMAIL_TAKEN');
    if (sponsorId) {
      const s = await prisma.user.findUnique({ where: { id: sponsorId }, select: { id: true } });
      if (!s) throw new Error('SPONSOR_NOT_FOUND');
    }
    if (placementRootId) {
      const root = await prisma.user.findUnique({ where: { id: placementRootId }, select: { id: true } });
      if (!root) throw new Error('PARENT_NOT_FOUND');
    }

    // 낙관적 동시성 배치: 잠금 없이 자리 탐색 → 삽입 시도 → (parentId,position) 유니크
    // 충돌 시에만 재시도. 이전에는 같은 스폰서로 들어오는 가입을 advisory lock으로
    // 완전 직렬화했는데, 실측 결과(300 동시 가입 중 232건 실패, P2028 타임아웃) 동시
    // 가입이 몰리면(추천 링크 바이럴 등) 대기열 뒤쪽 요청이 트랜잭션 타임아웃으로
    // 통째로 죽는 걸 확인했다. 타임아웃을 늘리는 건 임계점을 옮길 뿐 근본 해결이
    // 아니므로, 스키마의 @@unique([parentId, position]) 제약을 신뢰하는 낙관적
    // 재시도로 교체한다 — 충돌은 정확히 같은 슬롯을 동시에 노린 경우에만 나고,
    // 그마저도 다음 시도에서 최신 트리를 다시 읽으면 대개 즉시 해소된다.
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_PLACEMENT_RETRIES; attempt++) {
      try {
        const result = await prisma.$transaction(async (tx) => {
          let placement: { parentId: string; position: Side } | null = null;
          if (placementRootId) {
            placement = await findSlot(tx, placementRootId, preferred);
          }

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

          await tx.tokenQuota.create({ data: { userId: user.id, allocated: DEFAULT_ALLOCATION, consumed: ZERO } });
          await tx.legBalance.create({ data: { userId: user.id } });

          return { user, placement };
        }, {
          // maxWait: 커넥션 풀에서 빈 커넥션을 기다리는 시간(Prisma 기본 2s) — 잠금이
          // 없어졌어도 동시 가입이 몰리면 풀 크기(DB_POOL_MAX) 이상 요청이 큐잉되는
          // 건 정상이라, 짧은 대기조차 못 버티는 기본값을 올린다.
          // timeout: 트랜잭션 본문 실행 한도(기본 5s) — BFS 배치 탐색 여유를 둔다.
          maxWait: 10_000,
          timeout: 10_000,
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
        if (isUniqueViolation(error, ['email'])) throw new Error('EMAIL_TAKEN');
        if (isUniqueViolation(error, ['parentId', 'position']) && attempt < MAX_PLACEMENT_RETRIES - 1) {
          lastError = error;
          continue; // 다른 요청이 같은 자리를 먼저 차지함 — 다음 루프에서 최신 트리로 재탐색
        }
        throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('PLACEMENT_RETRY_EXHAUSTED');
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
