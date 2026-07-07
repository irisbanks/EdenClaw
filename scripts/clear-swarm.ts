#!/usr/bin/env tsx
// 스웜 데이터 전체 초기화
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const DB_PATH = path.resolve(process.cwd(), 'prisma/dev.db');
const adapter = new PrismaBetterSqlite3({ url: DB_PATH });
const prisma  = new PrismaClient({ adapter } as Parameters<typeof PrismaClient>[0]);

async function main() {
  console.log('[clear-swarm] 스웜 데이터 초기화 시작...');
  const [refDel, txDel, mktDel, botDel] = await Promise.all([
    prisma.botReferralChain.deleteMany({}),
    prisma.swarmTransaction.deleteMany({}),
    prisma.swarmMarketSession.deleteMany({}),
    prisma.swarmBot.deleteMany({}),
  ]);
  console.log(`  BotReferralChain: ${refDel.count}건 삭제`);
  console.log(`  SwarmTransaction: ${txDel.count}건 삭제`);
  console.log(`  SwarmMarketSession: ${mktDel.count}건 삭제`);
  console.log(`  SwarmBot: ${botDel.count}건 삭제`);
  console.log('✅ Cleared all swarm data');
  await prisma.$disconnect();
}

main().catch(e => { console.error('[clear-swarm] 오류:', e); process.exit(1); });
