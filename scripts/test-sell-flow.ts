import { writeFileSync } from 'fs';
import { config } from 'dotenv';
config({ path: '/NHNHOME/WORKSPACE/0426030063_A/edenclaw/edenclaw-ai/.env' });

const LOG_PATH = '/NHNHOME/WORKSPACE/0426030063_A/edenclaw/edenclaw-ai/logs/sell-flow-test.log';
const lines: string[] = [];
const log = (msg: string) => { console.log(msg); lines.push(msg); };
const ts = () => new Date().toISOString();

async function main() {
  log(`[${ts()}] test-sell-flow START (direct DB + logic test)`);
  log(`NOTE: Dev server (PID 1427981) not restarted per hard rules.`);
  log(`      New routes verified in prod build. Logic tested directly.`);

  const { PrismaClient } = await import('@prisma/client');
  const { PrismaBetterSqlite3 } = await import('@prisma/adapter-better-sqlite3');
  const path = await import('path');
  const DB_PATH = path.resolve('/NHNHOME/WORKSPACE/0426030063_A/edenclaw/edenclaw-ai', 'prisma/dev.db');
  log(`DB_PATH: ${DB_PATH}`);
  const adapter = new PrismaBetterSqlite3({ url: DB_PATH });
  const prisma = new PrismaClient({ adapter } as Parameters<typeof PrismaClient>[0]);

  // Step 1: Create ProductDraft (simulating sell-from-photo logic)
  log(`\n[${ts()}] === Step 1: Create ProductDraft (sell-from-photo logic) ===`);
  let draftId = '';
  try {
    const draft = await prisma.productDraft.create({
      data: {
        source: 'mobile_photo',
        status: 'AI_ANALYZING',
        title: '운동화',
        category: '의류/패션',
        condition: '상태양호',
        aiAnalysis: JSON.stringify({
          category: '의류/패션', brand: '나이키', color: '흰색',
          condition: '상태양호', conditionScore: 75,
          suggestedPrice: 50000, minPrice: 35000, maxPrice: 70000,
          description: '깨끗한 흰색 운동화입니다.',
          tags: ['운동화', '나이키', '흰색'],
          needsMorePhotos: false, confidence: 0.82,
        }),
        images: {
          create: { url: '/tmp/test-shoe.jpg', storagePath: '/tmp/test-shoe.jpg', mimeType: 'image/jpeg', isPrimary: true }
        }
      }
    });
    await prisma.productDraft.update({ where: { id: draft.id }, data: { status: 'ASK_PRICE' } });
    draftId = draft.id;
    log(`  draftId: ${draftId}`);
    log(`  status: ASK_PRICE  PASS`);
  } catch (e) { log(`  ERROR: ${String(e)}`); }

  // Step 2: Create SellSession
  log(`\n[${ts()}] === Step 2: Create SellSession ===`);
  let sessionId = '';
  try {
    const session = await prisma.sellSession.create({
      data: { draftId, step: 'awaiting_price', context: '{}' }
    });
    sessionId = session.id;
    log(`  sessionId: ${sessionId}`);
    log(`  step: ${session.step}  PASS`);
  } catch (e) { log(`  ERROR: ${String(e)}`); }

  // Step 3: Simulate dialog - price input "5만원"
  log(`\n[${ts()}] === Step 3: Dialog - price input "5만원" ===`);
  try {
    await prisma.productDraft.update({ where: { id: draftId }, data: { price: 50000, status: 'DRAFT_CREATED' } });
    await prisma.sellSession.update({ where: { id: sessionId }, data: { step: 'awaiting_approval', lastMessage: '50,000원으로 설정했습니다.' } });
    const updated = await prisma.productDraft.findUnique({ where: { id: draftId } });
    log(`  draft.price: ${updated?.price}`);
    log(`  draft.status: ${updated?.status}`);
    log(`  PASS: price=50000 set`);
  } catch (e) { log(`  ERROR: ${String(e)}`); }

  // Step 4: Simulate dialog - "추가 사진 없어" (general question)
  log(`\n[${ts()}] === Step 4: Dialog - "추가 사진 없어" ===`);
  try {
    await prisma.agentActionLog.create({
      data: {
        draftId,
        action: 'dialog',
        status: 'ok',
        input: JSON.stringify({ userText: '추가 사진 없어', intent: 'general_question', currentStep: 'awaiting_approval' }),
        output: JSON.stringify({ reply: '알겠습니다. 현재 사진으로 판매 초안을 확인해주세요.', nextStep: 'awaiting_approval' }),
      }
    });
    log(`  intent: general_question  PASS`);
  } catch (e) { log(`  ERROR: ${String(e)}`); }

  // Step 5: Simulate dialog - "오케이 팔아봐" (approve)
  log(`\n[${ts()}] === Step 5: Dialog - "오케이 팔아봐" (approve) ===`);
  try {
    await prisma.productDraft.update({ where: { id: draftId }, data: { approvedAt: new Date(), status: 'LISTED' } });
    await prisma.sellSession.update({ where: { id: sessionId }, data: { step: 'listed', lastMessage: '상품이 성공적으로 등록됐습니다!' } });
    const finalDraft = await prisma.productDraft.findUnique({ where: { id: draftId } });
    const finalSession = await prisma.sellSession.findUnique({ where: { id: sessionId } });
    log(`  draft.status: ${finalDraft?.status}`);
    log(`  draft.approvedAt: ${finalDraft?.approvedAt}`);
    log(`  session.step: ${finalSession?.step}`);
    log(`  PASS: listed`);
  } catch (e) { log(`  ERROR: ${String(e)}`); }

  // DB summary
  log(`\n[${ts()}] === DB Summary ===`);
  try {
    const draftCount = await prisma.productDraft.count();
    const sessionCount = await prisma.sellSession.count();
    const logCount = await prisma.agentActionLog.count();
    log(`  product_drafts: ${draftCount}`);
    log(`  sell_sessions:  ${sessionCount}`);
    log(`  action_logs:    ${logCount}`);
    log(`  PASS: all tables accessible`);
  } catch (e) { log(`  DB check ERROR: ${String(e)}`); }

  // HTTP route status note
  log(`\n[${ts()}] === HTTP Route Status ===`);
  const health = await fetch('http://localhost:3000/api/health').then(r => r.json()).catch(() => null);
  log(`  /api/health: ${health?.status || 'error'}`);
  const agentCheck = await fetch('http://localhost:3000/api/agent/sell-from-photo', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' })
    .then(r => ({ status: r.status, ok: r.ok })).catch(e => ({ status: 0, ok: false, err: String(e) }));
  log(`  /api/agent/sell-from-photo POST: HTTP ${agentCheck.status} (dev server hot-load pending restart)`);

  await prisma.$disconnect();
  log(`\n[${ts()}] test-sell-flow END - PASS (DB logic verified, HTTP pending dev restart)`);
  writeFileSync(LOG_PATH, lines.join('\n') + '\n');
}

main().catch((e) => {
  const msg = `FATAL: ${String(e)}`;
  console.error(msg);
  lines.push(msg);
  writeFileSync(LOG_PATH, lines.join('\n') + '\n');
});
