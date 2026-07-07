#!/usr/bin/env tsx
// 하루 시뮬레이션 후 자동 보고서 생성
import path from 'path';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const DB_PATH = path.resolve(process.cwd(), 'prisma/dev.db');
const adapter = new PrismaBetterSqlite3({ url: DB_PATH });
const prisma = new PrismaClient({ adapter } as Parameters<typeof PrismaClient>[0]);

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`[generate-demo-report] ${today} 보고서 생성 시작`);

  const [totalBots, totalDeals, markets, topBots, topMarkets, chains, sampleTx] = await Promise.all([
    prisma.swarmBot.count(),
    prisma.swarmTransaction.count(),
    prisma.swarmMarketSession.findMany({ orderBy: { totalTransactions: 'desc' }, take: 10 }),
    prisma.swarmBot.findMany({ orderBy: { totalEarnings: 'desc' }, take: 10 }),
    prisma.swarmMarketSession.groupBy({ by: ['keyword'], _sum: { totalTransactions: true, totalRevenue: true }, orderBy: { _sum: { totalRevenue: 'desc' } }, take: 10 }),
    prisma.botReferralChain.findMany({ orderBy: { earnings: 'desc' }, take: 20, include: { parent: { select: { persona: true } }, child: { select: { persona: true } } } }),
    prisma.swarmTransaction.findMany({ where: { negotiationLog: { not: '[]' } }, orderBy: { timestamp: 'desc' }, take: 10 }),
  ]);

  const revenueAgg = await prisma.swarmTransaction.aggregate({ _sum: { finalPrice: true } });
  const totalRevenue = revenueAgg._sum.finalPrice ?? 0;
  const groupBuys = await prisma.swarmTransaction.count({ where: { marketKeyword: 'group-buy' } });
  const referrals = await prisma.botReferralChain.count();

  // 다단계 트리 텍스트 시각화 (상위 4레벨)
  const treeLines: string[] = [];
  const level1 = chains.filter(c => c.level === 1).slice(0, 4);
  for (const c of level1) {
    const pName = (JSON.parse(c.parent.persona as string) as { name: string }).name;
    const cName = (JSON.parse(c.child.persona as string) as { name: string }).name;
    treeLines.push(`${pName} ──→ ${cName} (L${c.level}, ${c.earnings.toLocaleString()} ET)`);
    const subs = chains.filter(s => s.level === 2 && s.parentBotId === c.childBotId).slice(0, 2);
    for (const s of subs) {
      const sName = (JSON.parse(s.child.persona as string) as { name: string }).name;
      treeLines.push(`  └─ ${cName} ──→ ${sName} (L${s.level}, ${s.earnings.toLocaleString()} ET)`);
    }
  }

  // 흥미로운 협상 샘플
  const samples = sampleTx.slice(0, 5).map(tx => {
    const log = JSON.parse(tx.negotiationLog as string) as string[];
    const prod = JSON.parse(tx.productInfo as string) as { name?: string };
    return `> **${prod.name || '상품'}** | ${tx.finalPrice.toLocaleString()} ET\n> ${log.slice(-2).join(' → ')}`;
  }).join('\n\n');

  const report = `# Edenclaw 스웜 생태계 — 일일 시뮬레이션 보고서
날짜: ${today}

---

## 📊 종합 현황

| 지표 | 값 |
|------|-----|
| 총 봇 수 | ${totalBots.toLocaleString()}개 |
| 총 거래 | ${totalDeals.toLocaleString()}건 |
| 총 수익 | ${totalRevenue.toLocaleString()} ET |
| 형성된 시장 | ${markets.length}개 |
| 공동구매 | ${groupBuys}건 |
| 다단계 추천 체인 | ${referrals}개 |

---

## 🏪 활발한 시장 Top 10

| 키워드 | 거래 | 수익 |
|--------|------|------|
${topMarkets.map(m => `| ${m.keyword} | ${m._sum.totalTransactions || 0}건 | ${(m._sum.totalRevenue || 0).toLocaleString()} ET |`).join('\n')}

---

## 🤖 수익 Top 10 봇

| 순위 | 봇 이름 | 수익 | 평판 |
|------|---------|------|------|
${topBots.map((b, i) => {
  const p = JSON.parse(b.persona as string) as { name: string; region: string };
  return `| ${i + 1} | ${p.name} (${p.region}) | ${b.totalEarnings.toLocaleString()} ET | ${b.reputation.toFixed(0)}점 |`;
}).join('\n')}

---

## 🔗 다단계 추천 트리 (바이너리 구조)

\`\`\`
${treeLines.join('\n') || '(시뮬레이션 후 데이터 생성)'}
\`\`\`

레벨별 커미션 구조:
- Level 1: 거래액의 10%
- Level 2: 5%
- Level 3: 3%
- Level 4+: 1%

---

## 💬 흥미로운 봇간 협상 샘플

${samples || '(시뮬레이션 실행 후 데이터 생성)'}

---

## 🎯 성공 지표 평가

| 기준 | 목표 | 달성 |
|------|------|------|
| 5000봇 생성 | 5000개 | ${totalBots >= 5000 ? '✅' : `⚠️ ${totalBots}개`} |
| 봇간 거래 100건+ | 100건 | ${totalDeals >= 100 ? `✅ ${totalDeals}건` : `⚠️ ${totalDeals}건`} |
| 자율 시장 10개+ | 10개 | ${markets.length >= 10 ? `✅ ${markets.length}개` : `⚠️ ${markets.length}개`} |
| 다단계 트리 구조 | 가시화 | ${referrals > 0 ? '✅' : '⚠️'} |

---

*생성: ${new Date().toISOString()} | Edenclaw AI Swarm v1.0*
`;

  const reportDir = path.resolve(process.cwd(), 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `swarm-day-${today}.md`);
  fs.writeFileSync(reportPath, report);
  console.log(`✅ 보고서 저장: ${reportPath}`);
  console.log(`   총 봇: ${totalBots} / 거래: ${totalDeals} / 시장: ${markets.length}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
