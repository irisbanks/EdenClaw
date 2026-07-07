import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prisma } from '@/lib/prisma';
import { DualShieldMLMEngine } from '@/lib/services/binaryEngine';
import { propagateAndSettle } from '@/lib/services/binarySettlement';

type Severity = 'PASS' | 'WARN' | 'FAIL';
type Check = { name: string; severity: Severity; detail: string };
type TreeUser = { id: string; parentId: string | null; position: string | null; epBalance: number };

const EPSILON = 1e-7;
const TEST_EMAIL_PREFIX = '__binary-verification__';

function near(actual: number, expected: number, message: string): void {
  assert.ok(Math.abs(actual - expected) <= EPSILON, `${message}: expected=${expected}, actual=${actual}`);
}

function findCycleCount(users: TreeUser[]): number {
  const parentById = new Map(users.map((user) => [user.id, user.parentId]));
  let cycles = 0;

  for (const user of users) {
    const path = new Set<string>();
    let cursor: string | null = user.id;
    while (cursor) {
      if (path.has(cursor)) {
        cycles++;
        break;
      }
      path.add(cursor);
      cursor = parentById.get(cursor) ?? null;
    }
  }
  return cycles;
}

async function auditBinaryLedger(): Promise<Check[]> {
  const [users, quotas, legs, bonuses, indexes, migrationLock] = await Promise.all([
    prisma.user.findMany({ select: { id: true, parentId: true, position: true, epBalance: true } }),
    prisma.tokenQuota.findMany({ select: { userId: true, allocated: true, consumed: true } }),
    prisma.legBalance.findMany({ select: { userId: true, leftPV: true, rightPV: true, leftBV: true, rightBV: true } }),
    prisma.transaction.findMany({
      where: { txType: 'BONUS_MATCHING' },
      select: { userId: true, amount: true, pvGenerated: true, bvGenerated: true, createdAt: true },
    }),
    prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'User'
    `,
    readFile('prisma/migrations-postgresql/migration_lock.toml', 'utf8'),
  ]);

  const checks: Check[] = [];
  const userIds = new Set(users.map((user) => user.id));
  const quotaUsers = new Set(quotas.map((quota) => quota.userId));
  const legUsers = new Set(legs.map((leg) => leg.userId));
  const missingQuota = users.filter((user) => !quotaUsers.has(user.id)).length;
  const missingLeg = users.filter((user) => !legUsers.has(user.id)).length;
  const invalidPlacement = users.filter(
    (user) =>
      (user.parentId === null && user.position !== null) ||
      (user.parentId !== null && !['LEFT', 'RIGHT'].includes(user.position ?? '')) ||
      (user.parentId !== null && !userIds.has(user.parentId))
  ).length;

  const slots = new Map<string, number>();
  for (const user of users) {
    if (!user.parentId || !user.position) continue;
    const key = `${user.parentId}:${user.position}`;
    slots.set(key, (slots.get(key) ?? 0) + 1);
  }
  const duplicateSlots = [...slots.values()].filter((count) => count > 1).length;
  const cycleCount = findCycleCount(users);
  const invalidLegs = legs.filter((leg) =>
    [leg.leftPV, leg.rightPV, leg.leftBV, leg.rightBV].some((value) => !Number.isFinite(value) || value < 0)
  ).length;
  const invalidEpBalances = users.filter(
    (user) => !Number.isFinite(user.epBalance) || user.epBalance < 0 || user.epBalance > 1_000_000_000_000_000
  ).length;
  const overdrawnQuotas = quotas.filter((quota) => quota.consumed > quota.allocated || quota.consumed < 0n).length;
  const invalidBonuses = bonuses.filter(
    (bonus) =>
      !Number.isFinite(bonus.amount) ||
      bonus.amount <= 0 ||
      bonus.amount > 1_000 + EPSILON ||
      bonus.amount > bonus.pvGenerated * 0.1 + EPSILON ||
      bonus.amount > bonus.bvGenerated + EPSILON
  ).length;

  const dailyTotals = new Map<string, number>();
  for (const bonus of bonuses) {
    const day = bonus.createdAt.toISOString().slice(0, 10);
    const key = `${bonus.userId}:${day}`;
    dailyTotals.set(key, (dailyTotals.get(key) ?? 0) + bonus.amount);
  }
  const dailyCapBreaches = [...dailyTotals.values()].filter((amount) => amount > 1_000 + EPSILON).length;
  const hasPlacementUniqueIndex = indexes.some((index) => {
    const sql = index.indexdef.toLowerCase();
    return sql.includes('unique') && sql.includes('"parentid"') && sql.includes('"position"');
  });
  const migrationProvider = migrationLock.match(/provider\s*=\s*"([^"]+)"/)?.[1] ?? 'unknown';

  checks.push({
    name: 'PostgreSQL 연결',
    severity: 'PASS',
    detail: `${users.length.toLocaleString()} users / ${bonuses.length.toLocaleString()} bonus records`,
  });
  checks.push({
    name: '회원별 TokenQuota 완전성',
    severity: missingQuota === 0 ? 'PASS' : 'FAIL',
    detail: `missing=${missingQuota}`,
  });
  checks.push({
    name: '회원별 LegBalance 완전성',
    severity: missingLeg === 0 ? 'PASS' : 'FAIL',
    detail: `missing=${missingLeg}`,
  });
  checks.push({
    name: '바이너리 배치 방향/상위 참조',
    severity: invalidPlacement === 0 ? 'PASS' : 'FAIL',
    detail: `invalid=${invalidPlacement}`,
  });
  checks.push({
    name: '부모 슬롯 중복',
    severity: duplicateSlots === 0 ? 'PASS' : 'FAIL',
    detail: `duplicateSlots=${duplicateSlots}`,
  });
  checks.push({
    name: '계보 순환',
    severity: cycleCount === 0 ? 'PASS' : 'FAIL',
    detail: `cycles=${cycleCount}`,
  });
  checks.push({
    name: 'PV/BV 비음수 원장',
    severity: invalidLegs === 0 ? 'PASS' : 'FAIL',
    detail: `invalidLedgers=${invalidLegs}`,
  });
  checks.push({
    name: 'EP 지갑 범위',
    severity: invalidEpBalances === 0 ? 'PASS' : 'FAIL',
    detail: `invalidWallets=${invalidEpBalances}`,
  });
  checks.push({
    name: '가스 잔액 비초과',
    severity: overdrawnQuotas === 0 ? 'PASS' : 'FAIL',
    detail: `overdrawn=${overdrawnQuotas}`,
  });
  checks.push({
    name: '수당률/BV/단건 상한',
    severity: invalidBonuses === 0 ? 'PASS' : 'FAIL',
    detail: `invalidBonuses=${invalidBonuses}`,
  });
  checks.push({
    name: 'UTC 일일 1,000 EP 상한',
    severity: dailyCapBreaches === 0 ? 'PASS' : 'FAIL',
    detail: `breaches=${dailyCapBreaches}`,
  });
  checks.push({
    name: 'DB 바이너리 슬롯 UNIQUE',
    severity: hasPlacementUniqueIndex ? 'PASS' : 'WARN',
    detail: hasPlacementUniqueIndex
      ? 'database constraint present'
      : 'API advisory lock은 적용됨; DB UNIQUE 제약은 배포 마이그레이션 필요',
  });
  checks.push({
    name: 'Prisma 마이그레이션 provider',
    severity: migrationProvider === 'postgresql' ? 'PASS' : 'FAIL',
    detail: `migration_lock=${migrationProvider}, runtime=postgresql`,
  });
  checks.push({
    name: '정산 큐 내구성',
    severity: 'WARN',
    detail: '현재 인메모리 큐: 다중 리전/프로세스 장애 대비 DB outbox 또는 Redis Streams 필요',
  });
  checks.push({
    name: '금액 자료형',
    severity: 'WARN',
    detail: '현재 Float: 실제 현금 지급 전 Decimal/최소 화폐단위 정수 전환 필요',
  });

  return checks;
}

async function removeVerificationUsers(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  if (ids.length === 0) return;
  await prisma.$transaction([
    prisma.transaction.deleteMany({ where: { userId: { in: ids } } }),
    prisma.tokenQuota.deleteMany({ where: { userId: { in: ids } } }),
    prisma.legBalance.deleteMany({ where: { userId: { in: ids } } }),
    prisma.user.deleteMany({ where: { id: { in: ids } } }),
  ]);
}

async function createVerificationUser(args: {
  suffix: string;
  parentId?: string;
  position?: 'LEFT' | 'RIGHT';
  leftPV?: number;
  rightPV?: number;
  leftBV?: number;
  rightBV?: number;
}) {
  return prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${args.suffix}@invalid.local`,
      name: 'Binary verification fixture',
      parentId: args.parentId ?? null,
      position: args.position ?? null,
      subscriptionStatus: 'ACTIVE',
      tokenQuota: { create: { allocated: 2_000_000n, consumed: 0n } },
      legBalance: {
        create: {
          leftPV: args.leftPV ?? 0,
          rightPV: args.rightPV ?? 0,
          leftBV: args.leftBV ?? 0,
          rightBV: args.rightBV ?? 0,
        },
      },
    },
  });
}

async function runIntegrationVerification(): Promise<void> {
  const runId = `${Date.now()}-${process.pid}`;
  await removeVerificationUsers();

  try {
    // 실제 계보 전파: 한쪽만 들어오면 무지급, 반대쪽이 들어오면 소실적 10% 지급.
    const root = await createVerificationUser({ suffix: `${runId}-root` });
    const left = await createVerificationUser({ suffix: `${runId}-left`, parentId: root.id, position: 'LEFT' });
    const right = await createVerificationUser({ suffix: `${runId}-right`, parentId: root.id, position: 'RIGHT' });

    await propagateAndSettle(left.id, 400, 40);
    let rootState = await prisma.user.findUniqueOrThrow({ where: { id: root.id }, include: { legBalance: true } });
    near(rootState.epBalance, 0, '한쪽 실적만으로 수당이 지급되면 안 됨');
    near(rootState.legBalance?.leftPV ?? -1, 400, '좌측 PV 전파');

    await propagateAndSettle(right.id, 400, 40);
    rootState = await prisma.user.findUniqueOrThrow({ where: { id: root.id }, include: { legBalance: true } });
    near(rootState.epBalance, 40, '소실적 10% 지급');
    near(rootState.legBalance?.leftPV ?? -1, 0, '좌측 매칭 PV 소진');
    near(rootState.legBalance?.rightPV ?? -1, 0, '우측 매칭 PV 소진');
    assert.equal(await prisma.transaction.count({ where: { userId: root.id, txType: 'BONUS_MATCHING' } }), 1);

    // BV cap 반복 호출 방어: 30 BV로 제한된 지급은 한 번만 30 EP이고 재호출해도 늘지 않아야 한다.
    const bvRoot = await createVerificationUser({
      suffix: `${runId}-bv-cap`,
      leftPV: 1_000,
      rightPV: 1_000,
      leftBV: 30,
      rightBV: 30,
    });
    await DualShieldMLMEngine.settleMatchingBonus(bvRoot.id);
    await DualShieldMLMEngine.settleMatchingBonus(bvRoot.id);
    const bvState = await prisma.user.findUniqueOrThrow({ where: { id: bvRoot.id }, include: { legBalance: true } });
    near(bvState.epBalance, 30, 'BV cap 반복 정산 방어');
    near(bvState.legBalance?.leftBV ?? -1, 0, '지급 담보 좌 BV 소진');
    near(bvState.legBalance?.rightBV ?? -1, 0, '지급 담보 우 BV 소진');
    assert.equal(await prisma.transaction.count({ where: { userId: bvRoot.id, txType: 'BONUS_MATCHING' } }), 1);

    // 다중 인스턴스에 준하는 동시 호출: 8개 호출이 겹쳐도 단 한 번만 지급.
    const concurrentRoot = await createVerificationUser({
      suffix: `${runId}-concurrency`,
      leftPV: 10_000,
      rightPV: 10_000,
      leftBV: 1_000,
      rightBV: 1_000,
    });
    await Promise.all(Array.from({ length: 8 }, () => DualShieldMLMEngine.settleMatchingBonus(concurrentRoot.id)));
    const concurrentState = await prisma.user.findUniqueOrThrow({
      where: { id: concurrentRoot.id },
      include: { legBalance: true },
    });
    near(concurrentState.epBalance, 1_000, '동시 정산 단일 지급');
    near(concurrentState.legBalance?.leftPV ?? -1, 0, '동시 정산 후 좌 PV');
    near(concurrentState.legBalance?.rightPV ?? -1, 0, '동시 정산 후 우 PV');
    assert.equal(
      await prisma.transaction.count({ where: { userId: concurrentRoot.id, txType: 'BONUS_MATCHING' } }),
      1,
      '동시 호출에서 수당 트랜잭션은 하나여야 함'
    );

    console.log('PASS  실제 좌/우 계보 PV/BV 전파 및 10% 매칭 지급');
    console.log('PASS  BV cap 반복 정산 과지급 방어');
    console.log('PASS  8-way 동시 정산 중복 지급 방어');
  } finally {
    await removeVerificationUsers();
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? '--all';
  let failed = false;

  if (mode === '--integration' || mode === '--all') {
    console.log('\n[Binary integration verification]');
    await runIntegrationVerification();
  }

  if (mode === '--audit' || mode === '--all') {
    console.log('\n[World-class readiness audit]');
    const checks = await auditBinaryLedger();
    for (const check of checks) console.log(`${check.severity.padEnd(4)}  ${check.name} — ${check.detail}`);
    const counts = checks.reduce(
      (acc, check) => ({ ...acc, [check.severity]: acc[check.severity] + 1 }),
      { PASS: 0, WARN: 0, FAIL: 0 }
    );
    console.log(`\nSUMMARY  PASS=${counts.PASS} WARN=${counts.WARN} FAIL=${counts.FAIL}`);
    failed = counts.FAIL > 0;
  }

  if (!['--integration', '--audit', '--all'].includes(mode)) {
    throw new Error(`알 수 없는 모드: ${mode}`);
  }
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('FAIL  binary verification crashed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
