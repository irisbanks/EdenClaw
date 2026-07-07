// Verdent AI(OMX) 스타일 샌드박스 안정화 핸들러
// - sanitizeGeneratedCode: TS1160(미닫힌 템플릿 리터럴/백틱) + 괄호 밸런스 정적 보정
// - runLSPDiagnostics: TS18003(No inputs found) 방지 — 프로젝트 tsconfig를 동적으로 extends 하고
//   컴파일 대상 파일을 files[]로 명시해 단일 파일 레이어만 정밀 타입체크
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * 짝이 맞지 않는 백틱/괄호를 best-effort로 보정하는 정적 새니타이저.
 * 대규모 코드를 출력하다 마지막 백틱(`)·괄호를 닫지 못하고 끊긴 경우의 TS1160 등을 막는다.
 * 완벽 파서가 아니라 가드이며, 남은 오류는 tsc 재시도 루프가 처리한다.
 */
export function sanitizeGeneratedCode(code: string): string {
  let cleaned = (code ?? '')
    .replace(/```(?:tsx|typescript|ts|javascript|js|json)?/g, '')
    .replace(/```/g, '')
    .trim();

  // TS1160 방어: 백틱(`) 홀수면 템플릿 리터럴이 미종료 → 강제 마감
  const backticks = (cleaned.match(/`/g) || []).length;
  if (backticks % 2 !== 0) cleaned += '\n`;';

  // 괄호 밸런스 보정: (), [], {} 순으로 열림>닫힘이면 부족분을 끝에 채운다(블록 {}을 마지막에 닫음).
  // split 사용으로 특수문자 이스케이프 이슈 없이 카운트.
  const pairs: Array<[string, string]> = [['(', ')'], ['[', ']'], ['{', '}']];
  for (const [open, close] of pairs) {
    const opens = cleaned.split(open).length - 1;
    const closes = cleaned.split(close).length - 1;
    if (opens > closes) cleaned += `\n${close.repeat(opens - closes)}`;
  }

  return cleaned;
}

/**
 * 단일 타겟 파일에 대한 tsc 진단.
 * /tmp나 생성 디렉터리에서 tsconfig를 못 찾아 TS18003이 나는 것을 막기 위해,
 * 프로젝트 루트 tsconfig를 extends 하는 임시 설정을 동적 생성하고 files[]에 타겟을 명시한다.
 * (extends 덕분에 strict/jsx/lib/paths(@/*) 등 프로젝트 설정이 그대로 적용됨)
 */
export function runLSPDiagnostics(projectPath: string, targetFile: string): Promise<{ success: boolean; stdout: string }> {
  return new Promise((resolve) => {
    const relTarget = path.relative(projectPath, targetFile).split(path.sep).join('/');
    const tmpConfigPath = path.join(projectPath, `.tsbuild-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    const tmpConfig = {
      extends: './tsconfig.json',
      compilerOptions: { noEmit: true, skipLibCheck: true, pretty: false, composite: false, incremental: false },
      files: [relTarget],
      include: [] as string[],
    };

    try {
      fs.writeFileSync(tmpConfigPath, JSON.stringify(tmpConfig), 'utf8');
    } catch (e) {
      resolve({ success: false, stdout: `임시 tsconfig 작성 실패: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }

    exec(
      `npx tsc -p ${JSON.stringify(tmpConfigPath)}`,
      { cwd: projectPath, maxBuffer: 10 * 1024 * 1024, timeout: 120_000 },
      (error, stdout, stderr) => {
        try { fs.unlinkSync(tmpConfigPath); } catch { /* 정리 실패 무시 */ }
        if (error) {
          resolve({ success: false, stdout: (stdout || stderr || error.message).trim() });
        } else {
          resolve({ success: true, stdout: 'COMPILATION_SUCCESS' });
        }
      }
    );
  });
}
