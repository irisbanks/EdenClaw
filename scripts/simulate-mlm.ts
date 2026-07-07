#!/usr/bin/env tsx
// 다단계 추천 30일 시뮬레이션
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const DB_PATH = path.resolve(process.cwd(), 'prisma/dev.db');
const adapter = new PrismaBetterSqlite3({ url: DB_PATH });
const prisma = new PrismaClient({ adapter } as Parameters<typeof PrismaClient>[0]);

const RATES = [0.10, 0.05, 0.03, 0.01];

async function main() {
  console.log('[simulate-mlm] 30일 다단계 시뮬레이션 시작');

  const bots = await prisma.swarmBot.findMany({ take: 5000 });
  if (bots.length === 0) { console.error('봇 없음. npx tsx scripts/seed-swarm.ts 먼저 실행'); process.exit(1); }

  const chains = await prisma.botReferralChain.findMany({ take: 500 });
  let totalCommission = 0;
  let totalTxCount = 0;

  for (let day = 1; day <= 30; day++) {
    const dailyTx = Math.floor(50 + Math.random() * 150);
    totalTxCount += dailyTx;

    for (let t = 0; t < dailyTx; t++) {
      const amount = 5000 + Math.floor(Math.random() * 95000);
      const chain = chains[Math.floor(Math.random() * chains.length)];
      if (!chain) continue;

      const rate = RATES[Math.min(chain.level - 1, RATES.length - 1)];
      const commission = Math.round(amount * rate);
      totalCommission += commission;

      await prisma.botReferralChain.update({
        where: { id: chain.id },
        data: { earnings: { increment: commission } },
      });
      await prisma.swarmBot.update({
        where: { id: chain.parentBotId },
        data: { totalEarnings: { increment: commission } },
      });
    }

    if (day % 5 === 0) console.log(`[simulate-mlm] ${day}일 / 누적 거래 ${totalTxCount}건 / 누적 커미션 ${totalCommission.toLocaleString()} ET`);
  }

  // 상위 10봇 수익 출력
  const topBots = await prisma.swarmBot.findMany({
    orderBy: { totalEarnings: 'desc' }, take: 10,
  });
  console.log('\n[simulate-mlm] 30일 수익 Top 10:');
  topBots.forEach((b, i) => {
    const name = (JSON.parse(b.persona as string) as { name: string }).name;
    console.log(`  ${i + 1}. ${name}: ${b.totalEarnings.toLocaleString()} ET`);
  });

  console.log(`\n✅ 총 거래: ${totalTxCount}건 / 총 커미션: ${totalCommission.toLocaleString()} ET`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
