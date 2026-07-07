import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { prisma } from '../../lib/prisma';
import { maskTrainingData } from '../../lib/safety/mask-training-data';

interface SftRecord {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
}

const SYSTEM_BY_ACTION: Record<string, string> = {
  product_analyze: '상품 사진 분석 에이전트다. JSON만 반환한다.',
  listing_draft: '판매글 작성 에이전트다. JSON만 반환한다.',
  listing_preview: '판매 미리보기 에이전트다. JSON만 반환한다.',
  seller_message: '판매 에이전트다. 안전 규칙을 따른다.',
};

function mockLogs() {
  return [
    { action: 'seller_message', input: '{"buyerMessage":"4만원에 가능할까요?"}', output: '{"status":"USER_CONFIRM_REQUIRED","reply":"가격 제안은 판매자 승인 후 확정합니다."}' },
    { action: 'seller_message', input: '{"buyerMessage":"주소랑 전화번호 알려주세요."}', output: '{"status":"USER_CONFIRM_REQUIRED","reply":"개인정보는 임의로 공개할 수 없습니다."}' },
    { action: 'listing_draft', input: '{"productName":"무선 이어폰","price":50000}', output: '{"title":"무선 이어폰 개인 거래","description":"사진 기준으로 안내합니다."}' },
  ];
}

function toRecord(log: { action: string; input: string; output: string }): SftRecord {
  return {
    messages: [
      { role: 'system', content: SYSTEM_BY_ACTION[log.action] || 'Edenclaw 에이전트다. JSON만 반환한다.' },
      { role: 'user', content: maskTrainingData(log.input) },
      { role: 'assistant', content: maskTrainingData(log.output) },
    ],
  };
}

async function main() {
  let logs: { action: string; input: string; output: string }[] = [];
  try {
    logs = await prisma.agentActionLog.findMany({
      where: { action: { in: Object.keys(SYSTEM_BY_ACTION) } },
      orderBy: { createdAt: 'desc' },
      take: 1000,
      select: { action: true, input: true, output: true },
    });
  } catch {
    logs = mockLogs();
  }
  if (!logs.length) logs = mockLogs();

  const records = logs.map(toRecord);
  const outputDir = path.join(process.cwd(), 'finetune', 'datasets');
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'agent_logs_export_sft.jsonl');
  await writeFile(outputPath, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
  console.log(JSON.stringify({ outputPath, records: records.length }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
