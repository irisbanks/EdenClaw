export interface AgentMeta {
  id: string;
  name: string;
  role: string;
  category: string;
  model: string;
  lora_path: string | null;
}

const LORA_BASE = '/NHNHOME/WORKSPACE/0426030063_B/finetune/lora';
const BASE_MODEL = 'Qwen/Qwen2.5-72B-Instruct';
const VISION_MODEL = 'gemini-2.5-flash';
const FAST_MODEL = 'Qwen/Qwen2.5-7B-Instruct';

function lora(name: string): string {
  return `${LORA_BASE}/${name}`;
}

export const AGENT_REGISTRY: AgentMeta[] = [
  // ── Vision (8) ────────────────────────────────────────────────────────────
  { id: 'vision-001', name: '상품 사진 분석가', role: '이미지에서 상품 정보 추출', category: 'vision', model: VISION_MODEL, lora_path: null },
  { id: 'vision-002', name: '상태 판정 에이전트', role: '상품 상태(새상품/중고) 판정', category: 'vision', model: VISION_MODEL, lora_path: null },
  { id: 'vision-003', name: '브랜드 인식 에이전트', role: '로고·브랜드 인식', category: 'vision', model: VISION_MODEL, lora_path: null },
  { id: 'vision-004', name: '개인정보 감지 에이전트', role: '사진 내 개인정보 감지', category: 'vision', model: VISION_MODEL, lora_path: null },
  { id: 'vision-005', name: '썸네일 생성 에이전트', role: '대표 썸네일 자동 생성', category: 'vision', model: VISION_MODEL, lora_path: null },
  { id: 'vision-006', name: '색상 분석 에이전트', role: '주요 색상 팔레트 추출', category: 'vision', model: VISION_MODEL, lora_path: null },
  { id: 'vision-007', name: '하자 감지 에이전트', role: '스크래치·파손 부위 감지', category: 'vision', model: VISION_MODEL, lora_path: null },
  { id: 'vision-008', name: '추가촬영 안내 에이전트', role: '부족한 앵글 안내', category: 'vision', model: VISION_MODEL, lora_path: null },

  // ── Pricing (10) ──────────────────────────────────────────────────────────
  { id: 'pricing-001', name: '시세 조회 에이전트', role: '실시간 중고 시세 조회', category: 'pricing', model: BASE_MODEL, lora_path: lora('pricing-v1') },
  { id: 'pricing-002', name: '가격 추천 에이전트', role: '판매 최적 가격 추천', category: 'pricing', model: BASE_MODEL, lora_path: lora('pricing-v1') },
  { id: 'pricing-003', name: '가격 협상 에이전트', role: '구매자 가격 제안 평가', category: 'pricing', model: BASE_MODEL, lora_path: lora('negotiation-v1') },
  { id: 'pricing-004', name: '트렌드 분석 에이전트', role: '카테고리 가격 트렌드 분석', category: 'pricing', model: BASE_MODEL, lora_path: lora('pricing-v1') },
  { id: 'pricing-005', name: '급매 감지 에이전트', role: '시세 대비 급매 상품 감지', category: 'pricing', model: FAST_MODEL, lora_path: null },
  { id: 'pricing-006', name: '단가 계산 에이전트', role: '단위당 가격 비교', category: 'pricing', model: FAST_MODEL, lora_path: null },
  { id: 'pricing-007', name: '가격 이력 에이전트', role: '상품별 가격 변동 이력 관리', category: 'pricing', model: FAST_MODEL, lora_path: null },
  { id: 'pricing-008', name: '경쟁 가격 에이전트', role: '동일 상품 타 매물 가격 비교', category: 'pricing', model: BASE_MODEL, lora_path: lora('pricing-v1') },
  { id: 'pricing-009', name: '번들 가격 에이전트', role: '여러 상품 묶음 가격 제안', category: 'pricing', model: BASE_MODEL, lora_path: null },
  { id: 'pricing-010', name: '시즌 할인 에이전트', role: '시즌별 최적 할인율 계산', category: 'pricing', model: FAST_MODEL, lora_path: null },

  // ── Seller (15) ───────────────────────────────────────────────────────────
  { id: 'seller-001', name: '판매자 온보딩 에이전트', role: '신규 판매자 가이드', category: 'seller', model: BASE_MODEL, lora_path: lora('seller-v2') },
  { id: 'seller-002', name: '판매글 작성 에이전트', role: '상품 설명 자동 작성', category: 'seller', model: BASE_MODEL, lora_path: lora('listing-v1') },
  { id: 'seller-003', name: '판매 대화 에이전트', role: '구매자 문의 자동 응답', category: 'seller', model: BASE_MODEL, lora_path: lora('seller-v2') },
  { id: 'seller-004', name: '예약 관리 에이전트', role: '구매 예약 일정 관리', category: 'seller', model: FAST_MODEL, lora_path: null },
  { id: 'seller-005', name: '판매 완료 에이전트', role: '거래 완료 처리 안내', category: 'seller', model: FAST_MODEL, lora_path: null },
  { id: 'seller-006', name: '판매자 평판 에이전트', role: '판매자 신뢰도 점수 관리', category: 'seller', model: BASE_MODEL, lora_path: lora('reputation-v1') },
  { id: 'seller-007', name: '거래 확정 에이전트', role: '최종 거래 조건 확정', category: 'seller', model: BASE_MODEL, lora_path: lora('seller-v2') },
  { id: 'seller-008', name: '재등록 에이전트', role: '미판매 상품 재등록 안내', category: 'seller', model: FAST_MODEL, lora_path: null },
  { id: 'seller-009', name: '가격 변경 에이전트', role: '판매 중 가격 변경 처리', category: 'seller', model: FAST_MODEL, lora_path: null },
  { id: 'seller-010', name: '판매 통계 에이전트', role: '개인 판매 통계 분석', category: 'seller', model: BASE_MODEL, lora_path: null },
  { id: 'seller-011', name: '사기 방지 에이전트', role: '판매자 사기 패턴 감지', category: 'seller', model: BASE_MODEL, lora_path: lora('safety-v1') },
  { id: 'seller-012', name: '다중 등록 에이전트', role: '여러 상품 일괄 등록', category: 'seller', model: BASE_MODEL, lora_path: null },
  { id: 'seller-013', name: '판매 홍보 에이전트', role: '상품 노출 최적화', category: 'seller', model: BASE_MODEL, lora_path: lora('listing-v1') },
  { id: 'seller-014', name: '배송비 계산 에이전트', role: '지역별 배송비 안내', category: 'seller', model: FAST_MODEL, lora_path: null },
  { id: 'seller-015', name: '세금 계산 에이전트', role: '거래 세금 계산 안내', category: 'seller', model: FAST_MODEL, lora_path: null },

  // ── Buyer (15) ────────────────────────────────────────────────────────────
  { id: 'buyer-001', name: '구매자 온보딩 에이전트', role: '신규 구매자 가이드', category: 'buyer', model: BASE_MODEL, lora_path: null },
  { id: 'buyer-002', name: '상품 검색 에이전트', role: '자연어로 상품 검색', category: 'buyer', model: BASE_MODEL, lora_path: lora('search-v1') },
  { id: 'buyer-003', name: '구매 제안 에이전트', role: '구매 의향 메시지 작성', category: 'buyer', model: BASE_MODEL, lora_path: lora('buyer-v1') },
  { id: 'buyer-004', name: '상품 문의 에이전트', role: '판매자에게 질문 생성', category: 'buyer', model: BASE_MODEL, lora_path: lora('buyer-v1') },
  { id: 'buyer-005', name: '거래 안전 확인 에이전트', role: '거래 사기 위험 감지', category: 'buyer', model: BASE_MODEL, lora_path: lora('safety-v1') },
  { id: 'buyer-006', name: '찜 목록 에이전트', role: '관심 상품 관리 및 알림', category: 'buyer', model: FAST_MODEL, lora_path: null },
  { id: 'buyer-007', name: '비교 분석 에이전트', role: '유사 상품 비교 분석', category: 'buyer', model: BASE_MODEL, lora_path: lora('pricing-v1') },
  { id: 'buyer-008', name: '구매 이력 에이전트', role: '구매 이력 기반 추천', category: 'buyer', model: BASE_MODEL, lora_path: lora('recommendation-v1') },
  { id: 'buyer-009', name: '예산 관리 에이전트', role: '예산 내 최적 상품 탐색', category: 'buyer', model: BASE_MODEL, lora_path: null },
  { id: 'buyer-010', name: '리뷰 분석 에이전트', role: '판매자 리뷰 요약 분석', category: 'buyer', model: BASE_MODEL, lora_path: lora('recommendation-v1') },
  { id: 'buyer-011', name: '배송 조회 에이전트', role: '배송 상태 추적 안내', category: 'buyer', model: FAST_MODEL, lora_path: null },
  { id: 'buyer-012', name: '환불 안내 에이전트', role: '환불·반품 절차 안내', category: 'buyer', model: FAST_MODEL, lora_path: null },
  { id: 'buyer-013', name: '진품 확인 에이전트', role: '명품·한정판 진품 판별 안내', category: 'buyer', model: BASE_MODEL, lora_path: lora('safety-v1') },
  { id: 'buyer-014', name: '알림 설정 에이전트', role: '가격 하락·재입고 알림', category: 'buyer', model: FAST_MODEL, lora_path: null },
  { id: 'buyer-015', name: '거래 후기 에이전트', role: '거래 완료 후 후기 작성 안내', category: 'buyer', model: FAST_MODEL, lora_path: null },

  // ── Safety (8) ────────────────────────────────────────────────────────────
  { id: 'safety-001', name: '금지품목 감지 에이전트', role: '판매 금지 상품 탐지', category: 'safety', model: BASE_MODEL, lora_path: lora('safety-v1') },
  { id: 'safety-002', name: '텍스트 안전 에이전트', role: '판매글 유해 내용 필터링', category: 'safety', model: BASE_MODEL, lora_path: lora('safety-v1') },
  { id: 'safety-003', name: '이미지 안전 에이전트', role: '이미지 유해 내용 감지', category: 'safety', model: VISION_MODEL, lora_path: null },
  { id: 'safety-004', name: '사기 패턴 에이전트', role: '거래 사기 패턴 실시간 감지', category: 'safety', model: BASE_MODEL, lora_path: lora('safety-v1') },
  { id: 'safety-005', name: '개인정보 보호 에이전트', role: '판매글 개인정보 마스킹', category: 'safety', model: BASE_MODEL, lora_path: lora('safety-v1') },
  { id: 'safety-006', name: '저작권 감지 에이전트', role: '저작권 침해 상품 감지', category: 'safety', model: BASE_MODEL, lora_path: null },
  { id: 'safety-007', name: '가짜 리뷰 감지 에이전트', role: '허위 리뷰 패턴 탐지', category: 'safety', model: BASE_MODEL, lora_path: lora('safety-v1') },
  { id: 'safety-008', name: '계정 위협 에이전트', role: '비정상 계정 활동 감지', category: 'safety', model: BASE_MODEL, lora_path: lora('safety-v1') },

  // ── Listing (10) ──────────────────────────────────────────────────────────
  { id: 'listing-001', name: '카테고리 분류 에이전트', role: '상품 카테고리 자동 분류', category: 'listing', model: BASE_MODEL, lora_path: lora('listing-v1') },
  { id: 'listing-002', name: '태그 생성 에이전트', role: '검색 태그 자동 생성', category: 'listing', model: BASE_MODEL, lora_path: lora('listing-v1') },
  { id: 'listing-003', name: '제목 최적화 에이전트', role: '검색 노출 최적 제목 생성', category: 'listing', model: BASE_MODEL, lora_path: lora('listing-v1') },
  { id: 'listing-004', name: '설명 생성 에이전트', role: '매력적인 상품 설명 생성', category: 'listing', model: BASE_MODEL, lora_path: lora('listing-v1') },
  { id: 'listing-005', name: '디자인 프리뷰 에이전트', role: '판매 카드 디자인 생성', category: 'listing', model: BASE_MODEL, lora_path: lora('listing-v1') },
  { id: 'listing-006', name: '거래 방법 에이전트', role: '직거래·택배 방법 안내', category: 'listing', model: FAST_MODEL, lora_path: null },
  { id: 'listing-007', name: '등록 검토 에이전트', role: '최종 등록 전 품질 검토', category: 'listing', model: BASE_MODEL, lora_path: lora('safety-v1') },
  { id: 'listing-008', name: 'SEO 최적화 에이전트', role: '상품 검색 노출 최적화', category: 'listing', model: BASE_MODEL, lora_path: lora('listing-v1') },
  { id: 'listing-009', name: '번역 에이전트', role: '상품 정보 다국어 번역', category: 'listing', model: BASE_MODEL, lora_path: null },
  { id: 'listing-010', name: '일괄 편집 에이전트', role: '다수 상품 일괄 수정', category: 'listing', model: FAST_MODEL, lora_path: null },

  // ── Swarm (25) ────────────────────────────────────────────────────────────
  { id: 'swarm-001', name: '스웜 코디네이터', role: '스웜 에이전트 전체 조율', category: 'swarm', model: BASE_MODEL, lora_path: lora('swarm-v1') },
  { id: 'swarm-002', name: '시장 탐색 봇 A', role: '상품 시세 탐색', category: 'swarm', model: FAST_MODEL, lora_path: null },
  { id: 'swarm-003', name: '시장 탐색 봇 B', role: '카테고리별 거래량 탐색', category: 'swarm', model: FAST_MODEL, lora_path: null },
  { id: 'swarm-004', name: '시장 탐색 봇 C', role: '신규 등록 상품 탐색', category: 'swarm', model: FAST_MODEL, lora_path: null },
  { id: 'swarm-005', name: '구매 시뮬레이션 봇 A', role: '가격 협상 시뮬레이션', category: 'swarm', model: FAST_MODEL, lora_path: null },
  { id: 'swarm-006', name: '구매 시뮬레이션 봇 B', role: '수요 시뮬레이션', category: 'swarm', model: FAST_MODEL, lora_path: null },
  { id: 'swarm-007', name: '구매 시뮬레이션 봇 C', role: '예산 제약 구매 시뮬레이션', category: 'swarm', model: FAST_MODEL, lora_path: null },
  { id: 'swarm-008', name: '구매 시뮬레이션 봇 D', role: '충동 구매 시뮬레이션', category: 'swarm', model: FAST_MODEL, lora_path: null },
  { id: 'swarm-009', name: '구매 시뮬레이션 봇 E', role: '비교 구매 시뮬레이션', category: 'swarm', model: FAST_MODEL, lora_path: null },
  { id: 'swarm-010', name: 'MLM 추적 봇 A', role: '추천인 체계 트래킹', category: 'swarm', model: FAST_MODEL, lora_path: null },
  { id: 'swarm-011', name: 'MLM 추적 봇 B', role: '보상 체계 계산', category: 'swarm', model: FAST_MODEL, lora_path: null },
  { id: 'swarm-012', name: '사기 탐지 봇 A', role: '이상 거래 패턴 감지', category: 'swarm', model: BASE_MODEL, lora_path: lora('safety-v1') },
  { id: 'swarm-013', name: '사기 탐지 봇 B', role: '다중 계정 감지', category: 'swarm', model: BASE_MODEL, lora_path: lora('safety-v1') },
  { id: 'swarm-014', name: '가격 조작 감지 봇', role: '가격 담합·조작 감지', category: 'swarm', model: BASE_MODEL, lora_path: lora('safety-v1') },
  { id: 'swarm-015', name: '트렌드 봇 A', role: '실시간 트렌드 분석', category: 'swarm', model: FAST_MODEL, lora_path: null },
  { id: 'swarm-016', name: '트렌드 봇 B', role: '키워드 트렌드 추적', category: 'swarm', model: FAST_MODEL, lora_path: null },
  { id: 'swarm-017', name: '피드백 수집 봇', role: '거래 피드백 자동 수집', category: 'swarm', model: FAST_MODEL, lora_path: null },
  { id: 'swarm-018', name: '공급망 봇', role: '공급 부족 상품 예측', category: 'swarm', model: BASE_MODEL, lora_path: null },
  { id: 'swarm-019', name: '지역 탐색 봇', role: '지역별 거래 밀도 분석', category: 'swarm', model: FAST_MODEL, lora_path: null },
  { id: 'swarm-020', name: '타이밍 봇', role: '최적 판매 타이밍 분석', category: 'swarm', model: FAST_MODEL, lora_path: null },
  { id: 'swarm-021', name: '번들 매칭 봇', role: '연관 상품 번들 매칭', category: 'swarm', model: BASE_MODEL, lora_path: null },
  { id: 'swarm-022', name: '재고 봇', role: '반복 판매 재고 추적', category: 'swarm', model: FAST_MODEL, lora_path: null },
  { id: 'swarm-023', name: '소셜 신호 봇', role: '소셜 인기 상품 감지', category: 'swarm', model: BASE_MODEL, lora_path: null },
  { id: 'swarm-024', name: '무결성 검사 봇', role: '상품 정보 일관성 검사', category: 'swarm', model: BASE_MODEL, lora_path: lora('safety-v1') },
  { id: 'swarm-025', name: '스웜 보고 봇', role: '스웜 활동 요약 보고', category: 'swarm', model: FAST_MODEL, lora_path: null },

  // ── Market Operations (15) ─────────────────────────────────────────────────
  { id: 'market-001', name: '시장 현황 에이전트', role: '실시간 마켓 현황 요약', category: 'market_ops', model: BASE_MODEL, lora_path: null },
  { id: 'market-002', name: '카테고리 관리 에이전트', role: '카테고리 체계 관리', category: 'market_ops', model: FAST_MODEL, lora_path: null },
  { id: 'market-003', name: '정책 적용 에이전트', role: '거래 정책 자동 적용', category: 'market_ops', model: BASE_MODEL, lora_path: lora('safety-v1') },
  { id: 'market-004', name: '매물 큐레이션 에이전트', role: '우수 매물 큐레이션', category: 'market_ops', model: BASE_MODEL, lora_path: lora('recommendation-v1') },
  { id: 'market-005', name: '긴급 대응 에이전트', role: '민원·긴급 상황 대응', category: 'market_ops', model: BASE_MODEL, lora_path: null },
  { id: 'market-006', name: '품질 관리 에이전트', role: '등록 상품 품질 관리', category: 'market_ops', model: BASE_MODEL, lora_path: lora('listing-v1') },
  { id: 'market-007', name: '분쟁 조정 에이전트', role: '거래 분쟁 중재 지원', category: 'market_ops', model: BASE_MODEL, lora_path: null },
  { id: 'market-008', name: '마케팅 에이전트', role: '판매 촉진 캠페인 실행', category: 'market_ops', model: BASE_MODEL, lora_path: null },
  { id: 'market-009', name: '오퍼 매칭 에이전트', role: '수요-공급 자동 매칭', category: 'market_ops', model: BASE_MODEL, lora_path: lora('recommendation-v1') },
  { id: 'market-010', name: '데이터 정제 에이전트', role: '상품 데이터 정규화', category: 'market_ops', model: FAST_MODEL, lora_path: null },
  { id: 'market-011', name: '신뢰도 평가 에이전트', role: '플랫폼 신뢰도 지표 관리', category: 'market_ops', model: BASE_MODEL, lora_path: lora('reputation-v1') },
  { id: 'market-012', name: '거래 완결 에이전트', role: '거래 완결율 최적화', category: 'market_ops', model: BASE_MODEL, lora_path: null },
  { id: 'market-013', name: '이탈 방지 에이전트', role: '거래 중단 예방 개입', category: 'market_ops', model: BASE_MODEL, lora_path: null },
  { id: 'market-014', name: '신규 셀러 발굴 에이전트', role: '잠재 판매자 발굴 안내', category: 'market_ops', model: BASE_MODEL, lora_path: null },
  { id: 'market-015', name: '파트너 채널 에이전트', role: '외부 채널 연동 관리', category: 'market_ops', model: FAST_MODEL, lora_path: null },

  // ── Negotiation (10) ──────────────────────────────────────────────────────
  { id: 'negotiation-001', name: '협상 시작 에이전트', role: '협상 세션 시작 관리', category: 'negotiation', model: BASE_MODEL, lora_path: lora('negotiation-v1') },
  { id: 'negotiation-002', name: '가격 역제안 에이전트', role: '판매자 역제안 생성', category: 'negotiation', model: BASE_MODEL, lora_path: lora('negotiation-v1') },
  { id: 'negotiation-003', name: '최저가 방어 에이전트', role: '판매자 최저 수용가 계산', category: 'negotiation', model: BASE_MODEL, lora_path: lora('negotiation-v1') },
  { id: 'negotiation-004', name: '구매자 의도 분석 에이전트', role: '구매자 협상 전략 분석', category: 'negotiation', model: BASE_MODEL, lora_path: lora('negotiation-v1') },
  { id: 'negotiation-005', name: '합의 도출 에이전트', role: '중간 합의점 제안', category: 'negotiation', model: BASE_MODEL, lora_path: lora('negotiation-v1') },
  { id: 'negotiation-006', name: '협상 타임아웃 에이전트', role: '협상 기한 관리', category: 'negotiation', model: FAST_MODEL, lora_path: null },
  { id: 'negotiation-007', name: '번들 협상 에이전트', role: '여러 상품 묶음 협상', category: 'negotiation', model: BASE_MODEL, lora_path: lora('negotiation-v1') },
  { id: 'negotiation-008', name: '감정 분석 에이전트', role: '협상 대화 감정 분석', category: 'negotiation', model: BASE_MODEL, lora_path: null },
  { id: 'negotiation-009', name: '최종 확정 에이전트', role: '협상 결과 최종 확정', category: 'negotiation', model: BASE_MODEL, lora_path: lora('negotiation-v1') },
  { id: 'negotiation-010', name: '협상 이력 에이전트', role: '협상 이력 기반 전략 학습', category: 'negotiation', model: BASE_MODEL, lora_path: lora('negotiation-v1') },

  // ── Recommendation (10) ───────────────────────────────────────────────────
  { id: 'rec-001', name: '개인화 추천 에이전트', role: '사용자 맞춤 상품 추천', category: 'recommendation', model: BASE_MODEL, lora_path: lora('recommendation-v1') },
  { id: 'rec-002', name: '협업 필터링 에이전트', role: '유사 사용자 기반 추천', category: 'recommendation', model: BASE_MODEL, lora_path: lora('recommendation-v1') },
  { id: 'rec-003', name: '콘텐츠 기반 추천 에이전트', role: '상품 속성 기반 추천', category: 'recommendation', model: BASE_MODEL, lora_path: lora('recommendation-v1') },
  { id: 'rec-004', name: '트렌드 추천 에이전트', role: '인기 트렌드 기반 추천', category: 'recommendation', model: BASE_MODEL, lora_path: null },
  { id: 'rec-005', name: '연관 상품 에이전트', role: '함께 구매되는 상품 추천', category: 'recommendation', model: BASE_MODEL, lora_path: lora('recommendation-v1') },
  { id: 'rec-006', name: '재구매 예측 에이전트', role: '재구매 가능성 예측', category: 'recommendation', model: BASE_MODEL, lora_path: null },
  { id: 'rec-007', name: '지역 추천 에이전트', role: '근거리 상품 우선 추천', category: 'recommendation', model: FAST_MODEL, lora_path: null },
  { id: 'rec-008', name: '예산 기반 추천 에이전트', role: '예산 범위 내 최적 추천', category: 'recommendation', model: BASE_MODEL, lora_path: lora('recommendation-v1') },
  { id: 'rec-009', name: '계절 추천 에이전트', role: '시즌·날씨 기반 추천', category: 'recommendation', model: FAST_MODEL, lora_path: null },
  { id: 'rec-010', name: '검색 의도 추천 에이전트', role: '검색 키워드 의도 분석 추천', category: 'recommendation', model: BASE_MODEL, lora_path: lora('recommendation-v1') },

  // ── Analytics (10) ────────────────────────────────────────────────────────
  { id: 'analytics-001', name: '거래량 분석 에이전트', role: '일·주·월 거래량 리포트', category: 'analytics', model: BASE_MODEL, lora_path: null },
  { id: 'analytics-002', name: '사용자 행동 분석 에이전트', role: '방문·클릭·전환 분석', category: 'analytics', model: BASE_MODEL, lora_path: null },
  { id: 'analytics-003', name: '카테고리 성과 에이전트', role: '카테고리별 성과 분석', category: 'analytics', model: BASE_MODEL, lora_path: null },
  { id: 'analytics-004', name: '이상 감지 에이전트', role: '거래 이상 신호 감지', category: 'analytics', model: BASE_MODEL, lora_path: lora('safety-v1') },
  { id: 'analytics-005', name: '성장 예측 에이전트', role: '플랫폼 성장 지표 예측', category: 'analytics', model: BASE_MODEL, lora_path: null },
  { id: 'analytics-006', name: '코호트 분석 에이전트', role: '사용자 코호트 분석', category: 'analytics', model: BASE_MODEL, lora_path: null },
  { id: 'analytics-007', name: '전환율 최적화 에이전트', role: '구매 전환율 개선 제안', category: 'analytics', model: BASE_MODEL, lora_path: null },
  { id: 'analytics-008', name: '이탈 분석 에이전트', role: '사용자 이탈 원인 분석', category: 'analytics', model: BASE_MODEL, lora_path: null },
  { id: 'analytics-009', name: '실험 분석 에이전트', role: 'A/B 테스트 결과 분석', category: 'analytics', model: BASE_MODEL, lora_path: null },
  { id: 'analytics-010', name: '대시보드 에이전트', role: '핵심 지표 대시보드 생성', category: 'analytics', model: BASE_MODEL, lora_path: null },

  // ── Mobile (8) ────────────────────────────────────────────────────────────
  { id: 'mobile-001', name: '모바일 촬영 가이드 에이전트', role: '상품 사진 촬영 가이드', category: 'mobile', model: FAST_MODEL, lora_path: null },
  { id: 'mobile-002', name: '모바일 푸시 에이전트', role: '개인화 푸시 알림 발송', category: 'mobile', model: FAST_MODEL, lora_path: null },
  { id: 'mobile-003', name: '모바일 검색 에이전트', role: '모바일 최적화 검색', category: 'mobile', model: BASE_MODEL, lora_path: lora('search-v1') },
  { id: 'mobile-004', name: '빠른 등록 에이전트', role: '1분 내 상품 등록 지원', category: 'mobile', model: BASE_MODEL, lora_path: lora('listing-v1') },
  { id: 'mobile-005', name: '위치 기반 에이전트', role: '현재 위치 기반 거래 지원', category: 'mobile', model: FAST_MODEL, lora_path: null },
  { id: 'mobile-006', name: '모바일 결제 에이전트', role: '간편 결제 플로우 지원', category: 'mobile', model: FAST_MODEL, lora_path: null },
  { id: 'mobile-007', name: '오프라인 에이전트', role: '네트워크 불안정 시 오프라인 지원', category: 'mobile', model: FAST_MODEL, lora_path: null },
  { id: 'mobile-008', name: '접근성 에이전트', role: '시각·청각 장애인 접근성 지원', category: 'mobile', model: BASE_MODEL, lora_path: null },

  // ── Group Buy (8) ─────────────────────────────────────────────────────────
  { id: 'groupbuy-001', name: '공동구매 기획 에이전트', role: '공동구매 상품 기획', category: 'group_buy', model: BASE_MODEL, lora_path: null },
  { id: 'groupbuy-002', name: '참여자 모집 에이전트', role: '공동구매 참여자 모집', category: 'group_buy', model: BASE_MODEL, lora_path: null },
  { id: 'groupbuy-003', name: '목표 달성 감시 에이전트', role: '인원 목표 달성 모니터링', category: 'group_buy', model: FAST_MODEL, lora_path: null },
  { id: 'groupbuy-004', name: '공동구매 협상 에이전트', role: '판매자와 단가 협상', category: 'group_buy', model: BASE_MODEL, lora_path: lora('negotiation-v1') },
  { id: 'groupbuy-005', name: '배분 계산 에이전트', role: '참여자 배분 계산', category: 'group_buy', model: FAST_MODEL, lora_path: null },
  { id: 'groupbuy-006', name: '공동구매 안전 에이전트', role: '공동구매 사기 방지', category: 'group_buy', model: BASE_MODEL, lora_path: lora('safety-v1') },
  { id: 'groupbuy-007', name: '공동구매 알림 에이전트', role: '진행 상황 알림 발송', category: 'group_buy', model: FAST_MODEL, lora_path: null },
  { id: 'groupbuy-008', name: '공동구매 완료 에이전트', role: '거래 완료 및 정산 처리', category: 'group_buy', model: BASE_MODEL, lora_path: null },

  // ── Voice (9) ─────────────────────────────────────────────────────────────
  { id: 'voice-001', name: '음성 쇼핑 에이전트', role: '음성으로 상품 검색·구매', category: 'voice', model: BASE_MODEL, lora_path: null },
  { id: 'voice-002', name: '음성 등록 에이전트', role: '음성으로 상품 정보 입력', category: 'voice', model: BASE_MODEL, lora_path: lora('listing-v1') },
  { id: 'voice-003', name: '음성 협상 에이전트', role: '음성 대화로 가격 협상', category: 'voice', model: BASE_MODEL, lora_path: lora('negotiation-v1') },
  { id: 'voice-004', name: 'STT 전처리 에이전트', role: '음성 인식 텍스트 정제', category: 'voice', model: FAST_MODEL, lora_path: null },
  { id: 'voice-005', name: '다국어 음성 에이전트', role: '다국어 음성 입력 지원', category: 'voice', model: BASE_MODEL, lora_path: null },
  { id: 'voice-006', name: '음성 알림 에이전트', role: '거래 상태 음성 알림', category: 'voice', model: FAST_MODEL, lora_path: null },
  { id: 'voice-007', name: '의도 분류 에이전트', role: '음성 명령 의도 분류', category: 'voice', model: BASE_MODEL, lora_path: null },
  { id: 'voice-008', name: '감정 인식 에이전트', role: '음성 감정 기반 대응', category: 'voice', model: BASE_MODEL, lora_path: null },
  { id: 'voice-009', name: '음성 요약 에이전트', role: '긴 협상 내용 음성 요약', category: 'voice', model: BASE_MODEL, lora_path: null },
];

export const TOTAL_AGENTS = AGENT_REGISTRY.length;

export function getAgentById(id: string): AgentMeta | undefined {
  return AGENT_REGISTRY.find((a) => a.id === id);
}

export function getAgentsByCategory(category: string): AgentMeta[] {
  return AGENT_REGISTRY.filter((a) => a.category === category);
}

export function getAgentCategories(): string[] {
  return [...new Set(AGENT_REGISTRY.map((a) => a.category))];
}
