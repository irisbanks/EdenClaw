// OMX 새니타이저 + 단일파일 tsc 진단 테스트 (실제 tsc 사용, 라이브 LLM 불필요)
// 실행: npx tsx scripts/test-omx.ts
import fs from 'fs';
import path from 'path';
import { sanitizeGeneratedCode, runLSPDiagnostics } from '../lib/swarm/omx-sanitize';

function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`❌ FAIL: ${msg}`); process.exit(1); }
  console.log(`✅ ${msg}`);
}
const countOf = (s: string, ch: string) => s.split(ch).length - 1;

async function main(): Promise<void> {
  // ── 1) sanitizeGeneratedCode ──
  const fenced = sanitizeGeneratedCode('```typescript\nexport const t = `hello world');
  assert(!fenced.includes('```'), '코드펜스 제거됨');
  assert(countOf(fenced, '`') % 2 === 0, 'TS1160: 미닫힌 백틱 자동 마감(짝수)');

  const braces = sanitizeGeneratedCode('export function f() {\n  if (true) {\n    return 1;');
  assert(countOf(braces, '{') === countOf(braces, '}'), '중괄호 밸런스 보정');

  const parens = sanitizeGeneratedCode('const x = outer(inner(1, 2');
  assert(countOf(parens, '(') === countOf(parens, ')'), '소괄호 밸런스 보정');

  const balanced = sanitizeGeneratedCode('export const ok = 1;');
  assert(balanced === 'export const ok = 1;', '이미 정상인 코드는 변형하지 않음');

  // ── 2) runLSPDiagnostics (실제 tsc, 프로젝트 tsconfig 동적 주입) ──
  const projectRoot = process.cwd();
  const target = path.join(projectRoot, 'app/api/_generated/__omx_selftest__.ts');
  fs.mkdirSync(path.dirname(target), { recursive: true });

  try {
    fs.writeFileSync(target, 'export const broken: numer = 1;\n', 'utf8'); // TS2552
    const bad = await runLSPDiagnostics(projectRoot, target);
    assert(bad.success === false, 'TS18003 없이 깨진 코드의 타입 오류를 실제로 검출(success=false)');
    assert(/numer|TS\d+/.test(bad.stdout), `진단 로그에 컴파일 에러 포함 (${bad.stdout.slice(0, 80)})`);
    assert(!/TS18003/.test(bad.stdout), 'TS18003(No inputs found) 발생하지 않음');

    fs.writeFileSync(target, 'export const fixed: number = 1;\n', 'utf8');
    const good = await runLSPDiagnostics(projectRoot, target);
    assert(good.success === true, '수정된 코드는 tsc 통과(success=true)');
  } finally {
    fs.rmSync(target, { force: true });
  }

  console.log('\n🎉 OMX 새니타이저 + 동적 tsconfig 단일파일 진단 정상');
}

main().catch((e) => { console.error(e); process.exit(1); });
