# 에덴클로 AI MARKET v2 — 구현 완료 문서

## 개요

AI Market v2는 7개의 신규 기능을 추가한 고도화된 AI 쇼핑 플랫폼입니다.
모든 기능은 vLLM (Qwen/Qwen2.5-72B-Instruct) + Prisma 7 + SQLite 기반으로 구현되었습니다.

---

## 신규 기능 7개

### [1] 멀티 에이전트 실시간 협상룸

- **API**: `POST /api/market/negotiation/start` (SSE 스트리밍)
- **UI**: `/market/products/[id]/negotiate`
- **동작**: 구매자 에이전트 + 판매자 에이전트 + 중개자 에이전트가 최대 5턴 실시간 협상
- **합의 시**: 자동 결제 준비 상태 진입 (`paymentReady: true`)
- **DB**: `NegotiationSession`, `NegotiationMessage` 테이블

**테스트**:
```bash
curl -N -X POST http://localhost:3000/api/market/negotiation/start \
  -H "Content-Type: application/json" \
  -d '{"productId":"<id>", "targetPrice": 150000}'
```

---

### [2] AI 상품 검증 v2 — 5차원 점수

- **API**: `POST /api/market/verify/[productId]`
- **5개 차원** (각 100점):
  1. 가격 적정성 (카테고리 시장가 대비)
  2. 판매자 신뢰도 (거래이력 + 평점)
  3. 상품 설명 품질 (Qwen AI 평가)
  4. 사진/메타데이터 완성도
  5. 리뷰 진정성 (이상 패턴 탐지)
- **출력**: 종합 점수 + 5각형 레이더 차트 + 위험 경고
- **DB**: `ProductVerification` 테이블
- **UI**: 상품 상세 페이지 → "🔬 AI 검증 v2" 버튼

**테스트**:
```bash
curl -X POST http://localhost:3000/api/market/verify/<productId>
```

---

### [3] 개인화 추천 엔진

- **API**: `GET /api/market/recommend?userId=xxx&limit=10`
- **동작**:
  1. 사용자 메모리 (`/api/memory`) 에서 관심사 키워드 추출
  2. 과거 구매/조회 이력 반영
  3. TF 기반 코사인 유사도로 상품 매칭 (Top 10)
  4. Qwen 72B로 추천 이유 생성
- **UI**: `/market` 홈에 "✨ 당신을 위한 추천" 섹션

**테스트**:
```bash
curl "http://localhost:3000/api/market/recommend?userId=user_demo&limit=6"
```

---

### [4] 자연어 쇼핑 (텍스트/음성)

- **API**: `POST /api/market/voice-shop`
- **입력**: `{ "text": "감자 5kg을 가장 싸게 사줘" }` 또는 `{ "audioBase64": "..." }`
- **처리 흐름**:
  1. Whisper STT (음성 입력 시)
  2. Qwen으로 의도 파싱 (상품/수량/조건/예산)
  3. DB 검색 → 최적 상품 1개 선정
  4. 결제 준비 응답
- **UI**: `/market` 홈 히어로 섹션 검색바 + 🎤 버튼

**테스트**:
```bash
curl -X POST http://localhost:3000/api/market/voice-shop \
  -H "Content-Type: application/json" \
  -d '{"text": "커피 원두 저렴한 거 추천해줘"}'
```

---

### [5] 공동구매 스마트 매칭 v2

- **API**: `POST /api/market/group-buy/smart-match`
- **매칭 기준** (다차원):
  - 상품 유사도 (TF 코사인 유사도 30%)
  - 지역 근접성 20%
  - 시간대 활성도 10%
  - 예산 범위 20%
  - 인기도 (참여율) 10%
  - 검증 점수 10%
- **크론**: `POST /api/market/group-buy/cron-match` — 10분마다 자동 매칭 점수 갱신

**테스트**:
```bash
curl -X POST http://localhost:3000/api/market/group-buy/smart-match \
  -H "Content-Type: application/json" \
  -d '{"region": "서울", "budgetMin": 0, "budgetMax": 100000}'
```

---

### [6] 판매자 신뢰도 다차원 점수

- **API**: 
  - `POST /api/market/seller/[id]/calculate-reputation` — 계산 및 저장
  - `GET /api/market/seller/[id]/calculate-reputation` — 조회
- **5개 지표**:
  1. 거래 완료율 (30%)
  2. 평균 평점 (25%)
  3. 응답 속도 (20%)
  4. 클레임 비율 (15%)
  5. 활동 일수 (10%)
- **뱃지**: 🥉 브론즈 / 🥈 실버 / 🥇 골드 / 💎 다이아몬드
- **DB**: `SellerReputation` 테이블
- **UI**: 상품 상세 페이지 판매자 신뢰도 섹션

**테스트**:
```bash
curl -X POST http://localhost:3000/api/market/seller/seller_001/calculate-reputation
```

---

### [7] 가격 트렌드 분석

- **API**: `GET /api/market/products/[id]/price-trend`
- **DB**: `PriceHistory` 테이블 (상품별 일별 가격)
- **기능**:
  - 최근 30일 가격 변동 데이터
  - 선형 회귀로 향후 7일 예측
  - Qwen 72B로 "지금 사야 할까?" AI 판단
- **UI**: 상품 상세 페이지 가격 트렌드 섹션 (SVG 라인 차트)

**테스트**:
```bash
curl "http://localhost:3000/api/market/products/<productId>/price-trend"
```

---

## 데이터베이스 신규 테이블

| 테이블 | 설명 |
|--------|------|
| `ProductVerification` | 5차원 AI 검증 결과 |
| `SellerReputation` | 판매자 신뢰도 점수 |
| `PriceHistory` | 상품별 일별 가격 이력 |
| `NegotiationSession` | 협상 세션 |
| `NegotiationMessage` | 협상 메시지 |

---

## 시드 데이터

```bash
npx tsx prisma/seed-market-v2.ts
```

- 상품 50개 (electronics 10, fashion 10, food 10, digital 10, general 10)
- 각 상품별 30일 가격 이력
- 판매자 5명 신뢰도 데이터
- 공동구매 10개

---

## 헬스 체크

```bash
curl http://localhost:3000/api/health
```

7개 신규 기능 상태 포함:
- `negotiation`, `verificationV2`, `recommend`, `voiceShop`, `smartMatch`, `sellerReputation`, `priceTrend`

---

## 기술 스택

- **AI**: vLLM — Qwen/Qwen2.5-72B-Instruct (`http://localhost:8000`)
- **STT**: Whisper (음성 입력)
- **DB**: Prisma 7 + SQLite (better-sqlite3)
- **스트리밍**: SSE (Server-Sent Events)
- **프레임워크**: Next.js 16 (App Router)

---

## 개발 실행

```bash
cd edenclaw-ai
npm run dev
```

---

## 테스트 명령어 모음

```bash
# 헬스 체크 (7개 기능 상태)
curl http://localhost:3000/api/health | jq .

# 개인화 추천
curl "http://localhost:3000/api/market/recommend?userId=user_demo" | jq .recommendations[0]

# 자연어 쇼핑
curl -X POST http://localhost:3000/api/market/voice-shop \
  -H "Content-Type: application/json" \
  -d '{"text": "전자제품 이어폰 추천해줘"}' | jq .result

# 가격 트렌드 (첫 번째 상품)
PRODUCT_ID=$(curl -s "http://localhost:3000/api/market/products?limit=1" | jq -r '.products[0].id')
curl "http://localhost:3000/api/market/products/${PRODUCT_ID}/price-trend" | jq .aiAnalysis

# AI 검증 v2
curl -X POST "http://localhost:3000/api/market/verify/${PRODUCT_ID}" | jq .dimensions

# 판매자 신뢰도
curl -X POST http://localhost:3000/api/market/seller/seller_001/calculate-reputation | jq .

# 공동구매 스마트 매칭
curl -X POST http://localhost:3000/api/market/group-buy/smart-match \
  -H "Content-Type: application/json" \
  -d '{"region":"서울","budgetMax":200000}' | jq .matches[0]

# 협상룸 (SSE)
curl -N -X POST http://localhost:3000/api/market/negotiation/start \
  -H "Content-Type: application/json" \
  -d "{\"productId\":\"${PRODUCT_ID}\",\"targetPrice\":100000}"
```
