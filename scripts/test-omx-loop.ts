// OMX 격리 루프 검증: 샌드박스 반복 + 통과시에만 승격 + 실패시 라이브 트리 비오염 + 샌드박스 정리
// 실행: npx tsx scripts/test-omx-loop.ts
import fs from 'fs';
import path from 'path';
import { runOmxLoop } from '../lib/swarm/omx-loop';
import { MemoryJobStore } from '../lib/swarm/job-store';
import { runWorkerOnce } from '../lib/swarm/worker';
import type { ModelTier } from '../lib/swarm/autonomous-loop';

const BROKEN = 'export const rate: numer = 0.1;\n';
const FIXED = 'export const rate: number = 0.1;\n';

function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`❌ FAIL: ${msg}`); process.exit(1); }
  console.log(`✅ ${msg}`);
}

const projectRoot = process.cwd();
const TARGET_REL = 'app/api/_generated/__omx_loop_test__.ts';
const TARGET_ABS = path.join(projectRoot, TARGET_REL);

function sandboxExists(): boolean {
  const dir = path.join(projectRoot, '.edenclaw-sandbox');
  return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
}

const gemmaBroken: ModelTier = { key: 'gemma-31b', label: 'Gemma 31B', gasPerCall: 0, generate: async () => ({ text: BROKEN, provider: 'gemma-31b' }) };
const claudeFix: ModelTier = { key: 'claude', label: 'Claude', gasPerCall: 25_000, generate: async () => ({ text: FIXED, provider: 'claude' }) };
const alwaysBroken: ModelTier = { key: 'gemma-31b', label: 'Gemma 31B', gasPerCall: 0, generate: async () => ({ text: BROKEN, provider: 'gemma-31b' }) };

async function main(): Promise<void> {
  fs.rmSync(TARGET_ABS, { force: true });

  // ── 1) 성공 경로: 깨짐(샌드박스) → 에스컬레이션 → 통과 → 타겟 승격 ──
  const ok = await runOmxLoop({ prompt: 'fix', projectRoot, targetFile: TARGET_REL, tiers: [gemmaBroken, claudeFix], maxAttempts: 5 });
  assert(ok.success === true, '성공 경로: 최종 success=true');
  assert(ok.finalTier === 'claude', '에스컬레이션 후 claude 티어에서 통과');
  assert(fs.existsSync(TARGET_ABS), '통과 시 타겟 파일로 승격(promote)됨');
  assert(fs.readFileSync(TARGET_ABS, 'utf8').includes('number'), '승격된 코드가 수정본(fixed)');
  assert(!sandboxExists(), '성공 후 샌드박스 정리됨');
  fs.rmSync(TARGET_ABS, { force: true });

  // ── 2) 실패 경로: 끝까지 깨짐 → 타겟에 절대 안 써짐(라이브 트리 비오염) ──
  const fail = await runOmxLoop({ prompt: 'fix', projectRoot, targetFile: TARGET_REL, tiers: [alwaysBroken], maxAttempts: 3 });
  assert(fail.success === false, '실패 경로: success=false');
  assert(!fs.existsSync(TARGET_ABS), '실패 시 타겟 파일이 생성되지 않음(라이브 트리 비오염) ★핵심');
  assert(!sandboxExists(), '실패 후에도 샌드박스 정리됨');

  // ── 3) 보안 가드: 경로 이탈 → throw ──
  let threw = false;
  try { await runOmxLoop({ prompt: 'x', projectRoot, targetFile: '../../etc/evil.ts', tiers: [claudeFix], maxAttempts: 1 }); }
  catch { threw = true; }
  assert(threw, '경로 이탈(../) 시 Security violation throw');
  assert(!sandboxExists(), '가드 throw 후 잔여 샌드박스 없음');

  // ── 4) 비동기 OMX 잡: 워커가 kind=omx 를 runOmxLoop 로 처리 ──
  const store = new MemoryJobStore();
  const job = await store.createJob({ userId: 'u1', prompt: 'fix', maxAttempts: 5, kind: 'omx', targetFile: TARGET_REL });
  assert(job.kind === 'omx' && job.targetFile === TARGET_REL, '잡이 kind=omx + targetFile 로 생성됨');
  await runWorkerOnce(store, [gemmaBroken, claudeFix]);
  const done = await store.getJob(job.id);
  assert(!!done && done.status === 'succeeded', '워커가 OMX 잡을 succeeded 로 완료');
  assert(!!done && done.files.length === 1 && done.files[0].path === TARGET_REL, 'OMX 잡 결과에 승격 파일 기록');
  const evs = await store.getEvents(job.id);
  assert(evs.some((e) => e.event.type === 'promoted'), 'OMX 잡 이벤트에 promoted 기록');
  assert(fs.existsSync(TARGET_ABS), '워커 경로도 타겟으로 승격됨');
  fs.rmSync(TARGET_ABS, { force: true });

  console.log('\n🎉 OMX 격리/승격/비오염/보안가드/비동기워커 전부 검증 완료');
}

main().catch((e) => { console.error(e); process.exit(1); });
