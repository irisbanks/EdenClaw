# EdenClaw 세계 수준 검증 기준

“세계적 수준”은 화면의 인상이나 기능 개수로 판정하지 않는다. 아래 증거가 자동으로 재현되어야 한다.

## 실행 명령

```bash
npm run test:binary
npm run audit:world-class
npm run build
```

- `test:binary`: 격리된 임시 회원을 생성해 실제 PostgreSQL에서 좌/우 PV·BV 전파, 10% 매칭, BV cap, 8-way 동시 정산을 실행한다. 테스트 데이터는 성공/실패와 관계없이 제거한다.
- `audit:world-class`: 실제 장부를 변경하지 않고 누락 원장, 음수 잔액, 슬롯 중복, 계보 순환, 과지급, 일일 cap, 마이그레이션 상태를 검사한다.
- `build`: 전체 Next.js 프로덕션 컴파일과 TypeScript 검증을 실행한다.

## 합격선

1. 세 명령이 종료 코드 0으로 끝난다.
2. 감사 결과의 `FAIL`이 0이다.
3. `WARN`은 실제 현금 지급 전 모두 해소한다.
4. 수당 트랜잭션마다 `amount <= pvGenerated * 0.1`, `amount <= bvGenerated`, `amount <= 1,000`이 성립한다.
5. 동일 회원 정산이 동시에 여러 번 호출되어도 수당과 거래 로그가 한 번만 기록된다.
6. 한쪽 다리 실적만으로는 수당이 발생하지 않고, 미매칭 실적은 이월된다.

## 서비스 경계

- `/clean-lounge`: 순수 GAS 소비형이며 바이너리/PV를 생성하지 않는다.
- `/ai-lounge`: 성공한 GAS 소비를 PV/BV로 환산하고 기존 Dual-Shield 바이너리 장부에 전파한다.
- `/dashboard`, `/office`: EP 수당, 좌우 PV/BV, 이월 실적과 거래 기록을 조회한다.

이 경계를 유지해야 클린 상품과 바이너리 보상 상품의 회계가 섞이지 않는다.

## 마이그레이션

Supabase PostgreSQL 이력은 `prisma/migrations-postgresql`을 사용한다. `prisma/migrations`는 과거 SQLite 개발 이력 보존용이며 배포에 사용하지 않는다.
