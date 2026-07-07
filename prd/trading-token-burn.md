# PRD — AI 자율 개발 Swarm 가스비 콘솔 `/trading`

> v2: 메타포를 'AI 트레이딩'에서 **'AI 자율 개발 루프(Dev-Loop Swarm: Claude Code · Gemini API · Codex 연동)'** 로 전면 전환.

## 1. 목적
유저가 **AI 자율 개발 Swarm을 켜고/끄며**, 가입 시 지급된 **2,000,000 토큰(TokenQuota)** 이
개발 루프 가동 중 **초고속 개발 연동에 따른 실시간 가스비(Gas Fee)로 소진(consumed↑)** 되는 모습을
직접 확인할 수 있는 "AI 조작 창"을 제공한다. 소진은 **Supabase `TokenQuota` 테이블과 실시간 연동**(목업 아님).

## 1-1. 가스 고갈 → Overdraft 가스 충전 (신규)
잔여 가스가 0이 되어 개발 루프가 멈추면, **다단계 하부 조직(Left/Right Leg)의 PV/BV 파생 가치와
수당 지갑(epBalance)을 원장에서 즉시 끌어와 가스(토큰)로 스왑 충전**한다.
- 환율: 1 PV ≈ 10,000 가스, 1 수당(EP) ≈ 1,000 가스
- 실원장 잔액이 있으면 큰 다리 PV → 수당 순으로 차감하며 `consumed`를 되채우고 `Transaction(OVERDRAFT_GAS)` 기록
- 원장 잔액 0이면 **미래 수당 담보 프로토타입 선지급**(`OVERDRAFT_GAS_ADVANCE`)으로 데모 충전

## 2. 대상 테이블 (기존 스키마 재사용)
`TokenQuota { userId, allocated BigInt=2_000_000, consumed BigInt=0, updatedAt }`
- `remaining = allocated − consumed`
- 가입(`/api/auth/register`) 시 유저당 1개 자동 생성됨.

## 3. 기능 요구사항
1. **유저 식별**: 이메일로 해당 유저의 `TokenQuota` 로드. 미가입 시 `/dashboard` 가입 유도.
2. **봇 토글(켜기/끄기)**: 켜면 클라이언트가 ~1.2초 간격으로 소진 틱을 서버에 전송.
3. **실시간 소진**: 매 틱마다 서버가 `TokenQuota.consumed` 를 랜덤 번레이트(거래 1건당 약 2만~6만 토큰)만큼 **DB에 직접 증분**하고 갱신된 잔량을 반환. 게이지/숫자/진행바가 실시간 갱신.
4. **소진 가드**: `consumed`는 `allocated`를 넘지 않도록 캡(잔량 0에서 봇 자동 정지). 초과분은 "오버드래프트" 영역으로 별도 표기.
5. **거래 로그**: 틱마다 가짜 체결 로그(심볼/방향/번 토큰) 스트림 표시 — 봇 가동 체감용.
6. **리셋**: `consumed = 0` 으로 되돌려 데모 반복 가능.

## 4. API (Redis 비의존 — 프로덕션 견고성)
`GET  /api/trading/quota?email=` → `{ allocated, consumed, remaining, percentUsed }`
`POST /api/trading/quota` body:
- `{ email, action:'consume', amount }` → consumed += min(amount, remaining); 갱신값 반환(`burned` 포함)
- `{ email, action:'reset' }` → consumed = 0

> 주의: 기존 `lib/services/tokenGuard.ts`(`settleUsage`)는 Redis 의존이라 프로덕션(REDIS_URL 미설정)에서 실패. 본 콘솔은 Prisma로 `TokenQuota`를 직접 갱신한다.

## 5. 화면 `/trading`
- 상단: 이메일 입력 + [봇 가동/정지] 토글 + [리셋]
- 게이지: 잔여/할당 진행바(소진될수록 빨강), 숫자(할당·소진·잔여·사용률)
- 우측: 실시간 거래 로그 스트림
- 잔량 0 → 봇 자동 정지 + "토큰 소진(오버드래프트 진입 가능)" 배너

## 6. 비범위(Out of scope)
실제 거래소 주문 집행, 손익(PnL) 정산, 상위 라인 PV 전파(소비→실적)는 본 콘솔 범위 밖.
(PV 전파는 Redis 정산 큐가 붙는 별도 작업에서 다룬다.)
