#!/usr/bin/env python3
"""Generate 161 LoRA training datasets for EDENCLAW agents.
Each agent gets 500 train + 50 eval examples.
Data is synthesized from agent role definitions + swarm market context.
"""
import json
import os
import random
import time

LORA_BASE = "/NHNHOME/WORKSPACE/0426030063_A/edenclaw/edenclaw-ai/finetune/adapters"
STATS_PATH = "/NHNHOME/WORKSPACE/0426030063_A/edenclaw/edenclaw-ai/reports/finetune-dataset-stats-2026-05-01.md"
SWARM_MARKETS = ["맥북", "아이폰", "덤벨", "마우스", "운동화", "자전거", "유산균", "카시트", "공기청정기", "캐시미어"]
PRICES = [5000, 10000, 15000, 20000, 30000, 50000, 80000, 100000, 150000, 200000, 300000, 500000]
CONDITIONS = ["새상품", "거의새것", "상태양호", "보통", "하자있음"]

AGENTS = [
    # vision (8)
    ("vision-001", "상품 사진 분석가", "vision", lambda: gen_vision_analysis()),
    ("vision-002", "상태 판정 에이전트", "vision", lambda: gen_condition_judge()),
    ("vision-003", "브랜드 인식 에이전트", "vision", lambda: gen_brand_recognition()),
    ("vision-004", "개인정보 감지 에이전트", "vision", lambda: gen_privacy_detection()),
    ("vision-005", "썸네일 생성 에이전트", "vision", lambda: gen_thumbnail_guide()),
    ("vision-006", "색상 분석 에이전트", "vision", lambda: gen_color_analysis()),
    ("vision-007", "하자 감지 에이전트", "vision", lambda: gen_defect_detection()),
    ("vision-008", "추가촬영 안내 에이전트", "vision", lambda: gen_photo_guide()),
    # pricing (10)
    ("pricing-001", "시세 조회 에이전트", "pricing", lambda: gen_price_query()),
    ("pricing-002", "가격 추천 에이전트", "pricing", lambda: gen_price_recommend()),
    ("pricing-003", "가격 협상 에이전트", "pricing", lambda: gen_price_negotiate()),
    ("pricing-004", "트렌드 분석 에이전트", "pricing", lambda: gen_trend_analysis()),
    ("pricing-005", "급매 감지 에이전트", "pricing", lambda: gen_urgent_sale()),
    ("pricing-006", "단가 계산 에이전트", "pricing", lambda: gen_unit_price()),
    ("pricing-007", "가격 이력 에이전트", "pricing", lambda: gen_price_history()),
    ("pricing-008", "경쟁 가격 에이전트", "pricing", lambda: gen_competitive_price()),
    ("pricing-009", "번들 가격 에이전트", "pricing", lambda: gen_bundle_price()),
    ("pricing-010", "시즌 할인 에이전트", "pricing", lambda: gen_season_discount()),
    # seller (15)
    ("seller-001", "판매자 온보딩 에이전트", "seller", lambda: gen_seller_onboard()),
    ("seller-002", "판매글 작성 에이전트", "seller", lambda: gen_listing_write()),
    ("seller-003", "판매 대화 에이전트", "seller", lambda: gen_seller_chat()),
    ("seller-004", "예약 관리 에이전트", "seller", lambda: gen_reservation()),
    ("seller-005", "판매 완료 에이전트", "seller", lambda: gen_sale_complete()),
    ("seller-006", "판매자 평판 에이전트", "seller", lambda: gen_reputation()),
    ("seller-007", "거래 확정 에이전트", "seller", lambda: gen_trade_confirm()),
    ("seller-008", "재등록 에이전트", "seller", lambda: gen_relist()),
    ("seller-009", "가격 변경 에이전트", "seller", lambda: gen_price_change()),
    ("seller-010", "판매 통계 에이전트", "seller", lambda: gen_sell_stats()),
    ("seller-011", "사기 방지 에이전트", "seller", lambda: gen_fraud_prevent()),
    ("seller-012", "다중 등록 에이전트", "seller", lambda: gen_bulk_list()),
    ("seller-013", "판매 홍보 에이전트", "seller", lambda: gen_promotion()),
    ("seller-014", "배송비 계산 에이전트", "seller", lambda: gen_shipping()),
    ("seller-015", "세금 계산 에이전트", "seller", lambda: gen_tax()),
    # buyer (15)
    ("buyer-001", "구매자 온보딩 에이전트", "buyer", lambda: gen_buyer_onboard()),
    ("buyer-002", "상품 검색 에이전트", "buyer", lambda: gen_search()),
    ("buyer-003", "구매 제안 에이전트", "buyer", lambda: gen_buy_offer()),
    ("buyer-004", "상품 문의 에이전트", "buyer", lambda: gen_product_inquiry()),
    ("buyer-005", "거래 안전 확인 에이전트", "buyer", lambda: gen_safety_check()),
    ("buyer-006", "찜 목록 에이전트", "buyer", lambda: gen_wishlist()),
    ("buyer-007", "비교 분석 에이전트", "buyer", lambda: gen_compare()),
    ("buyer-008", "구매 이력 에이전트", "buyer", lambda: gen_purchase_history()),
    ("buyer-009", "예산 관리 에이전트", "buyer", lambda: gen_budget()),
    ("buyer-010", "리뷰 분석 에이전트", "buyer", lambda: gen_review_analysis()),
    ("buyer-011", "배송 조회 에이전트", "buyer", lambda: gen_delivery()),
    ("buyer-012", "환불 안내 에이전트", "buyer", lambda: gen_refund()),
    ("buyer-013", "진품 확인 에이전트", "buyer", lambda: gen_authenticity()),
    ("buyer-014", "알림 설정 에이전트", "buyer", lambda: gen_notification()),
    ("buyer-015", "거래 후기 에이전트", "buyer", lambda: gen_review_write()),
    # safety (8)
    ("safety-001", "금지품목 감지 에이전트", "safety", lambda: gen_prohibited()),
    ("safety-002", "텍스트 안전 에이전트", "safety", lambda: gen_text_safety()),
    ("safety-003", "이미지 안전 에이전트", "safety", lambda: gen_image_safety()),
    ("safety-004", "사기 패턴 에이전트", "safety", lambda: gen_fraud_pattern()),
    ("safety-005", "개인정보 보호 에이전트", "safety", lambda: gen_privacy_protect()),
    ("safety-006", "저작권 감지 에이전트", "safety", lambda: gen_copyright()),
    ("safety-007", "가짜 리뷰 감지 에이전트", "safety", lambda: gen_fake_review()),
    ("safety-008", "계정 위협 에이전트", "safety", lambda: gen_account_threat()),
    # listing (10)
    ("listing-001", "카테고리 분류 에이전트", "listing", lambda: gen_category()),
    ("listing-002", "태그 생성 에이전트", "listing", lambda: gen_tags()),
    ("listing-003", "제목 최적화 에이전트", "listing", lambda: gen_title()),
    ("listing-004", "설명 생성 에이전트", "listing", lambda: gen_description()),
    ("listing-005", "디자인 프리뷰 에이전트", "listing", lambda: gen_design_preview()),
    ("listing-006", "거래 방법 에이전트", "listing", lambda: gen_trade_method()),
    ("listing-007", "등록 검토 에이전트", "listing", lambda: gen_review_listing()),
    ("listing-008", "SEO 최적화 에이전트", "listing", lambda: gen_seo()),
    ("listing-009", "번역 에이전트", "listing", lambda: gen_translate()),
    ("listing-010", "일괄 편집 에이전트", "listing", lambda: gen_bulk_edit()),
    # swarm (25)
    *[("swarm-{:03d}".format(i), f"스웜 에이전트 {i:03d}", "swarm", lambda i=i: gen_swarm(i)) for i in range(1, 26)],
    # market_ops (15)
    *[("market-{:03d}".format(i), f"마켓 운영 에이전트 {i:03d}", "market_ops", lambda i=i: gen_market_ops(i)) for i in range(1, 16)],
    # negotiation (10)
    *[("negotiation-{:03d}".format(i), f"협상 에이전트 {i:03d}", "negotiation", lambda i=i: gen_negotiation(i)) for i in range(1, 11)],
    # recommendation (10)
    *[("rec-{:03d}".format(i), f"추천 에이전트 {i:03d}", "recommendation", lambda i=i: gen_recommendation(i)) for i in range(1, 11)],
    # analytics (10)
    *[("analytics-{:03d}".format(i), f"분석 에이전트 {i:03d}", "analytics", lambda i=i: gen_analytics(i)) for i in range(1, 11)],
    # mobile (8)
    *[("mobile-{:03d}".format(i), f"모바일 에이전트 {i:03d}", "mobile", lambda i=i: gen_mobile(i)) for i in range(1, 9)],
    # group_buy (8)
    *[("groupbuy-{:03d}".format(i), f"공동구매 에이전트 {i:03d}", "group_buy", lambda i=i: gen_groupbuy(i)) for i in range(1, 9)],
    # voice (9)
    *[("voice-{:03d}".format(i), f"음성 에이전트 {i:03d}", "voice", lambda i=i: gen_voice(i)) for i in range(1, 10)],
]

# ─── Generators ──────────────────────────────────────────────────────────────

def rp(): return random.choice(PRICES)
def rm(): return random.choice(SWARM_MARKETS)
def rc(): return random.choice(CONDITIONS)

def gen_vision_analysis():
    items = [rm() for _ in range(3)]
    item = random.choice(items)
    return (f"이 사진의 {item} 정보를 분석해줘.",
            f'{{\"category\": \"{item}\", \"brand\": \"분석 중\", \"condition\": \"{rc()}\", \"confidence\": {random.uniform(0.6,0.95):.2f}, \"needsMorePhotos\": {str(random.choice([True,False])).lower()}}}')

def gen_condition_judge():
    return (f"이 사진에서 상품 상태를 판단해줘.",
            f"상품 상태는 '{rc()}'입니다. 전반적으로 {random.choice(['깨끗하고 사용감이 적습니다','적당한 사용감이 있습니다','하자가 일부 있습니다'])}.")

def gen_brand_recognition():
    brands = ["나이키", "애플", "삼성", "LG", "소니", "파나소닉", "아디다스", "뉴발란스"]
    return (f"사진에서 브랜드를 인식해줘.", f"인식된 브랜드: {random.choice(brands)}. 로고 위치: {random.choice(['정면 중앙','좌측 하단','우측 상단'])}에서 확인됩니다.")

def gen_privacy_detection():
    flags = ["이름", "전화번호", "계좌번호", "주소", "이메일"]
    detected = random.sample(flags, k=random.randint(0, 2))
    if detected:
        return (f"이 이미지에 개인정보가 있나요?", f"경고: {', '.join(detected)} 정보가 감지됩니다. 가려주세요.")
    return (f"이미지 개인정보 체크해줘.", "개인정보 미감지. 안전하게 업로드 가능합니다.")

def gen_thumbnail_guide():
    return (f"썸네일 이미지 어떻게 생성하면 돼?", f"주요 상품을 중앙에 배치하고 배경을 {random.choice(['흰색','밝은 회색'])}으로 설정하세요. 최적 크기: 800x800px.")

def gen_color_analysis():
    colors = ["흰색", "검정", "파랑", "빨강", "회색", "베이지", "민트", "네이비"]
    return (f"이 상품 주요 색상은?", f"주요 색상: {random.choice(colors)} ({random.randint(60,90)}%), 보조: {random.choice(colors)} ({random.randint(10,30)}%).")

def gen_defect_detection():
    return (f"하자 부위 감지해줘.", random.choice([
        "스크래치 1개 감지: 좌측 하단 모서리. 거래 시 공개 권장합니다.",
        "하자 미감지. 상태 양호합니다.",
        "흠집 2~3개 감지: 후면 중앙부. 상태 '보통'으로 표기하세요."
    ]))

def gen_photo_guide():
    angles = ["정면", "뒷면", "측면", "라벨/모델명", "하자 부위 근접"]
    missing = random.sample(angles, k=random.randint(1, 3))
    return (f"추가로 찍어야 할 사진이 있나요?", f"권장 추가 촬영: {', '.join(missing)}. 구매자 신뢰도 향상에 도움됩니다.")

def gen_price_query():
    item, price = rm(), rp()
    return (f"{item} 현재 시세는?", f"{item}의 현재 중고 시세는 {price:,}~{int(price*1.3):,}원입니다. 최근 7일 거래 기준입니다.")

def gen_price_recommend():
    item, price = rm(), rp()
    cond = rc()
    return (f"{item} ({cond}) 얼마에 팔면 적당해?", f"{cond} 기준 권장가: {price:,}원. 빠른 판매를 원하시면 {int(price*0.9):,}원, 높은 가격을 원하시면 {int(price*1.1):,}원을 고려하세요.")

def gen_price_negotiate():
    price = rp()
    offer = int(price * random.uniform(0.7, 0.9))
    return (f"구매자가 {offer:,}원 제안했어. 어떻게 해?", f"제안가 {offer:,}원은 시세 대비 {int((1-offer/price)*100)}% 낮습니다. {int(price*0.92):,}원으로 역제안 추천합니다.")

def gen_trend_analysis():
    item = rm()
    return (f"{item} 가격 트렌드 알려줘.", f"{item}: 최근 30일 {random.choice(['상승','하락','보합'])} 트렌드. 주간 변동률 {random.uniform(-5,5):.1f}%. {random.choice(['현재 판매 적기','잠시 대기 권장','즉시 판매 추천'])}.")

def gen_urgent_sale():
    item, price = rm(), rp()
    return (f"급매 상품 있어?", f"급매 감지: {item} {int(price*0.7):,}원 (시세 대비 30% 저렴). 빠른 구매 권장합니다.")

def gen_unit_price():
    return (f"500g에 15,000원이면 100g당 얼마야?", "100g당 3,000원입니다. 시장 평균 2,500원 대비 20% 높습니다.")

def gen_price_history():
    item = rm()
    return (f"{item} 가격 이력 보여줘.", f"{item} 가격 이력 (최근 3개월): {rp():,}원 → {rp():,}원 → 현재 {rp():,}원. 전반적 {random.choice(['상승','하락'])} 추세.")

def gen_competitive_price():
    item, price = rm(), rp()
    return (f"비슷한 {item} 다른 매물 가격은?", f"유사 매물 3건: {int(price*0.95):,}원, {price:,}원, {int(price*1.05):,}원. 중간값 {price:,}원 추천.")

def gen_bundle_price():
    return (f"3개 묶음 팔면 얼마가 적당해?", f"3개 묶음 번들 권장가: 개별가 합계의 85% 적용. 구매자 유입 효과 예상.")

def gen_season_discount():
    return (f"겨울 상품 할인은 얼마나 해야 해?", f"겨울 시즌 종료 후 15~20% 할인 권장. 비시즌 재고는 25%까지 가능합니다.")

def gen_seller_onboard():
    return ("처음 판매 등록하려는데 어떻게 해?", "1) 상품 사진 촬영 2) 카테고리 선택 3) 상태 및 가격 입력 4) 판매글 작성 5) 등록 완료. AI가 단계별로 도와드립니다!")

def gen_listing_write():
    item, price, cond = rm(), rp(), rc()
    return (f"{item} 판매글 써줘. 상태: {cond}, 가격: {price:,}원",
            f"제목: [{cond}] {item} 판매합니다\n{item}입니다. 상태는 {cond}로 {random.choice(['깨끗하게 사용했습니다','꼼꼼히 관리했습니다'])}. 가격: {price:,}원. 직거래/택배 모두 가능합니다.")

def gen_seller_chat():
    return (f"구매자가 '아직 판매 중인가요?' 라고 물었어.", "네, 아직 판매 중입니다! 관심 가져주셔서 감사합니다. 직거래/택배 모두 가능하고 언제든 문의주세요.")

def gen_reservation():
    return ("구매자가 내일 직거래 예약 원해.", "예약 등록 완료. 내일 거래 장소와 시간을 구매자와 확정해주세요. 예약 후 다른 구매자 문의 시 '예약 중' 안내해드릴게요.")

def gen_sale_complete():
    return ("거래 완료됐어.", "축하드립니다! 거래가 성공적으로 완료됐습니다. 구매자 후기 요청 메시지를 발송할까요?")

def gen_reputation():
    score = random.uniform(60, 98)
    return (f"내 판매자 평점은 어때?", f"현재 신뢰도 점수: {score:.1f}점. {random.choice(['우수 판매자입니다','양호합니다','빠른 응답률 개선 시 점수 상승 가능합니다'])}.")

def gen_trade_confirm():
    price = rp()
    return (f"거래 확정해도 돼?", f"거래 조건 확인: 금액 {price:,}원, 거래 방법 {random.choice(['직거래','택배'])}. 모든 조건에 동의하시면 확정 버튼을 눌러주세요.")

def gen_relist():
    item = rm()
    return (f"{item} 2주째 안 팔려. 어떻게 해?", f"재등록 권장: 사진 교체, 가격 5~10% 인하, 제목에 '급매' 키워드 추가. 노출 시간대: 오후 7~9시가 효과적입니다.")

def gen_price_change():
    price = rp()
    return (f"가격 {price:,}원으로 낮추고 싶어.", f"가격 변경 완료: {price:,}원. 변경 즉시 검색 상단 재노출됩니다.")

def gen_sell_stats():
    return ("이번 달 판매 현황 알려줘.", f"이번 달: 등록 {random.randint(3,15)}건, 판매 완료 {random.randint(1,8)}건, 총 수익 {random.randint(50000,500000):,}원. 평균 판매 기간 {random.randint(2,14)}일.")

def gen_fraud_prevent():
    return ("송금 먼저 해달라는 구매자가 있어.", "주의! 정상적인 직거래는 현장 확인 후 거래합니다. 선송금 요구는 사기 패턴입니다. 거래를 중단하고 신고를 권장합니다.")

def gen_bulk_list():
    return ("상품 10개 한 번에 등록하고 싶어.", "일괄 등록 기능으로 최대 20개까지 동시 등록 가능합니다. CSV 파일 업로드 또는 수동 입력 중 선택하세요.")

def gen_promotion():
    return ("상품 더 잘 보이게 하려면?", f"노출 최적화 방법: 1) 고화질 정면 사진 2) 검색 키워드 태그 추가 3) 상세 설명 {random.randint(100,200)}자 이상 4) 오후 7시 재등록.")

def gen_shipping():
    return ("서울→부산 택배비 얼마야?", "서울→부산 1kg 이하: 4,000원, 3kg: 5,500원, 5kg: 7,000원. 편의점 접수 시 500원 추가 할인 가능.")

def gen_tax():
    price = rp()
    return (f"이번 달 총 판매 {price:,}원인데 세금 어떻게 돼?", f"개인 간 중고거래는 일반적으로 비과세입니다. 단, 사업 목적 반복 거래 시 종합소득세 신고 필요. 월 {price*12:,}원 이상 시 세무사 상담 권장.")

def gen_buyer_onboard():
    return ("처음 구매하려는데 어떻게 해?", "1) 상품 검색 2) 판매자 신뢰도 확인 3) 문의 메시지 발송 4) 직거래/택배 협의 5) 거래 완료 후 후기 작성. 에덴이 안전한 거래를 도와드립니다!")

def gen_search():
    item = rm()
    return (f"{item} 찾고 있어.", f"{item} 검색 결과: {random.randint(10,200)}건. 최저가 {rp():,}원 ~ 최고가 {rp():,}원. 신뢰도 높은 판매자 상품을 우선 추천합니다.")

def gen_buy_offer():
    price, offer = rp(), 0
    offer = int(price * 0.85)
    return (f"판매자에게 {offer:,}원 제안 메시지 써줘.", f"안녕하세요! 상품에 관심이 있어서 연락드립니다. {offer:,}원에 구매 가능할까요? 직거래 가능합니다.")

def gen_product_inquiry():
    return ("판매자한테 뭐라고 물어봐야 해?", "문의 예시: '안녕하세요, 상품 상태 더 자세히 알 수 있을까요? 박스/구성품은 있나요? 직거래 가능한 지역은 어디인가요?'")

def gen_safety_check():
    return ("이 판매자 믿을 수 있어?", f"신뢰도 분석: 거래 {random.randint(5,50)}건 완료, 후기 평점 {random.uniform(4.0,5.0):.1f}/5.0, 응답률 {random.randint(70,99)}%. {random.choice(['신뢰할 수 있는 판매자입니다','일반적인 수준입니다'])}.")

def gen_wishlist():
    item = rm()
    return (f"{item} 찜해놨는데 가격 내리면 알려줘.", f"{item} 찜 목록에 추가됐습니다. 가격이 10% 이상 하락하거나 재고가 소진될 때 알림을 드릴게요.")

def gen_compare():
    item, p1, p2 = rm(), rp(), rp()
    return (f"{item} 두 개 비교해줘: {p1:,}원 vs {p2:,}원",
            f"비교 결과: {min(p1,p2):,}원 상품이 {abs(p1-p2):,}원 저렴합니다. 상태와 판매자 신뢰도를 함께 확인하세요.")

def gen_purchase_history():
    return ("내 구매 이력 보여줘.", f"최근 구매: {random.randint(3,20)}건. 주요 카테고리: {rm()}, {rm()}. 총 구매액: {random.randint(100000,1000000):,}원.")

def gen_budget():
    budget = rp()
    return (f"예산 {budget:,}원으로 {rm()} 살 수 있어?", f"예산 {budget:,}원 내 {rm()} 매물 {random.randint(5,30)}건 발견됐습니다. 상태 '{rc()}' 상품부터 추천드립니다.")

def gen_review_analysis():
    return ("이 판매자 후기 분석해줘.", f"후기 분석: 긍정 {random.randint(70,95)}%, 부정 {random.randint(5,20)}%. 주요 키워드: '빠른 발송', '설명과 동일', '친절한 판매자'.")

def gen_delivery():
    return ("택배 언제 와?", f"송장 번호 조회 결과: 현재 {random.choice(['발송 완료','배송 중','배달 완료'])} 상태. 예상 도착: {random.choice(['오늘 저녁','내일 오전','모레'])}.")

def gen_refund():
    return ("환불 어떻게 해?", "개인 간 거래는 법적 청약철회가 어렵습니다. 판매자와 직접 협의를 권장하고, 합의 불가 시 에덴 분쟁 신고를 이용하세요.")

def gen_authenticity():
    item = rm()
    return (f"{item} 정품인지 확인하고 싶어.", f"{item} 정품 확인 방법: 1) 시리얼 넘버 조회 2) 로고/박스 확인 3) 공식 홈페이지 인증. 의심 시 직거래 후 확인 권장.")

def gen_notification():
    item = rm()
    return (f"{item} 새 매물 올라오면 알려줘.", f"{item} 알림 설정 완료. 새 매물 등록 시 즉시 푸시 알림을 드립니다. 가격 범위: {rp():,}~{rp():,}원.")

def gen_review_write():
    return ("거래 후기 어떻게 써?", "거래 후기 예시: '상품 상태가 설명과 동일했고 빠른 발송에 감사합니다. 다음에도 거래하고 싶습니다!' 솔직하고 구체적으로 작성해주세요.")

def gen_prohibited():
    items = ["총기", "마약", "불법 복제 소프트웨어", "도난 물품", "의약품"]
    item = random.choice(items)
    return (f"이런 상품 판매 가능해? '{item}'", f"'{item}'는 판매 금지 품목입니다. 등록 시 즉시 삭제되고 계정이 제재될 수 있습니다.")

def gen_text_safety():
    return ("이 판매글 안전한가요?", random.choice([
        "안전합니다. 규정 위반 내용 미감지.",
        "주의: 과장 광고 문구가 감지됩니다. 수정을 권장합니다.",
        "경고: 금지 키워드가 포함됩니다. 등록 전 반드시 수정하세요."
    ]))

def gen_image_safety():
    return ("이 사진 업로드 가능해?", random.choice([
        "안전합니다. 개인정보 및 유해 콘텐츠 미감지.",
        "주의: 배경에 개인정보(전화번호)가 노출됩니다. 수정 후 업로드하세요."
    ]))

def gen_fraud_pattern():
    return ("이 거래 이상한 것 같아.", "사기 위험 신호 감지: 1) 시세 대비 과도한 저가 2) 선송금 요구 3) 빠른 거래 압박. 거래를 중단하고 신고를 권장합니다.")

def gen_privacy_protect():
    return ("판매글에 내 번호 노출됐어?", "스캔 결과: 전화번호 노출 감지. 자동 마스킹 처리됐습니다. 게시글에서 직접 번호를 입력하지 마세요.")

def gen_copyright():
    return ("이 상품 저작권 문제 없어?", random.choice([
        "저작권 위반 미감지. 정상 등록 가능합니다.",
        "주의: 브랜드 로고가 포함된 이미지입니다. 공식 유통 여부를 확인하세요."
    ]))

def gen_fake_review():
    return ("이 판매자 후기 조작된 것 같아.", random.choice([
        "분석 결과: 자연스러운 후기 패턴. 의심 징후 없음.",
        "주의: 단기간 대량 후기, 유사 문구 반복 감지. 신중한 거래를 권장합니다."
    ]))

def gen_account_threat():
    return ("내 계정에서 이상한 활동이 있어.", "비정상 로그인 감지: 새 기기에서 접속. 비밀번호 즉시 변경을 권장합니다. 2단계 인증 설정도 권장합니다.")

def gen_category():
    return (f"이 상품 카테고리는?", f"카테고리: {rm()}. 정확도 {random.uniform(85,99):.0f}%. 대분류→중분류→소분류 자동 분류 완료.")

def gen_tags():
    item = rm()
    return (f"{item} 태그 뭐가 좋아?", f"추천 태그: #{item}, #{rc().replace(' ','')}, #{'중고거래'}, #{'직거래'}, #{random.choice(['급매','가성비','선물용'])}.")

def gen_title():
    item, cond = rm(), rc()
    return (f"{item} 판매글 제목 써줘.", f"[{cond}] {item} 판매 | 정품/실사진/빠른답장")

def gen_description():
    item, cond, price = rm(), rc(), rp()
    return (f"{item} 설명글 써줘.", f"{item}입니다. 구매 후 {random.choice(['2주','한 달','3개월'])} 사용했습니다. 상태: {cond}. 가격: {price:,}원. 직거래 우선, 택배 가능합니다.")

def gen_design_preview():
    return ("판매 카드 어떻게 디자인해?", "추천 레이아웃: 상단 상품 사진 + 하단 가격/상태 뱃지. 흰 배경에 메인 색상 포인트 1가지 권장.")

def gen_trade_method():
    return ("직거래 vs 택배 뭐가 나아?", f"직거래 장점: 즉시 확인, 수수료 없음. 택배 장점: 편리함, 광역 판매. {'직거래 권장' if random.random()>0.5 else '택배 권장'}.")

def gen_review_listing():
    return ("등록 전 마지막 점검해줘.", "점검 완료: ✅ 사진 3장, ✅ 상태 명시, ✅ 가격 기재, ✅ 금지어 없음. 등록 가능합니다.")

def gen_seo():
    item = rm()
    return (f"{item} 검색 노출 높이려면?", f"SEO 최적화: 제목에 '{item}' 포함, 상태/가격/지역 명시, 태그 5개 이상, 상세 설명 150자+. 주요 검색어 강조.")

def gen_translate():
    return ("이 판매글 영어로 번역해줘.", "Selling: Gently used item in good condition. Reasonable price, quick response. Direct trade or shipping available.")

def gen_bulk_edit():
    return ("등록된 상품 가격 일괄로 10% 낮추고 싶어.", f"선택된 {random.randint(5,20)}개 상품 가격 10% 일괄 인하 완료. 변경 즉시 검색 노출이 갱신됩니다.")

def gen_swarm(i):
    market = random.choice(SWARM_MARKETS)
    price = rp()
    action = random.choice(["시세 탐색", "구매 제안", "협상 진행", "거래 완료", "이상 감지"])
    return (f"봇-{i:03d}의 다음 행동은?", f"[{market}] 시장 진입. {action}: {price:,}원. 신뢰도: {random.uniform(50,99):.1f}. 다음 타겟: {random.choice(SWARM_MARKETS)}.")

def gen_market_ops(i):
    return (f"시장 운영 상태 리포트 요청.", f"현재 활성 마켓: {random.randint(50,150)}개. 운영 이슈: {random.choice(['없음','경미한 가격 이상 감지','일시적 트래픽 급증'])}. 조치: {random.choice(['자동 처리됨','모니터링 중'])}.")

def gen_negotiation(i):
    price = rp()
    offer = int(price * random.uniform(0.75, 0.92))
    counter = int(price * random.uniform(0.88, 0.97))
    return (f"협상 중 - 판매가 {price:,}원, 구매 제안 {offer:,}원", f"역제안 권장: {counter:,}원. 현재 차이: {price-offer:,}원. 합의 가능성: {random.choice(['높음','중간','낮음'])}.")

def gen_recommendation(i):
    item = rm()
    return (f"비슷한 상품 추천해줘.", f"추천 상품 {random.randint(3,10)}건: {item} 관련 매물. 가격대 {rp():,}~{rp():,}원. 판매자 신뢰도 {random.uniform(80,99):.0f}점 이상 필터 적용.")

def gen_analytics(i):
    return (f"이번 주 거래 분석 보고서.", f"이번 주: 거래 {random.randint(100,1000)}건 (+{random.randint(5,30)}%). 인기 카테고리: {rm()}. 평균 거래가: {rp():,}원. 이상 거래: {random.randint(0,5)}건.")

def gen_mobile(i):
    return (f"모바일에서 {random.choice(['사진 찍는','검색하는','결제하는','알림 받는'])} 방법?", f"모바일 앱에서 {random.choice(['카메라 버튼','검색창','결제 탭','알림 설정'])}을 이용하세요. 위치 기반 서비스 허용 시 더 빠른 거래가 가능합니다.")

def gen_groupbuy(i):
    item = rm()
    return (f"{item} 공동구매 어때?", f"{item} 공동구매 모집 중: {random.randint(5,50)}명 목표, 현재 {random.randint(1,30)}명 참여. 목표 달성 시 {random.randint(10,30)}% 할인 예상.")

def gen_voice(i):
    item = rm()
    return (f"음성으로 '{item} 검색'이라고 했을 때 처리 방법?", f"음성 인식: '{item} 검색' 파악됨. 검색 실행 중... {random.randint(10,100)}건 결과. 최저가 {rp():,}원 상품이 첫 번째입니다.")


# ─── Main ─────────────────────────────────────────────────────────────────────

def write_jsonl(path, examples):
    with open(path, "w", encoding="utf-8") as f:
        for ex in examples:
            f.write(json.dumps(ex, ensure_ascii=False) + "\n")

def main():
    os.makedirs(LORA_BASE, exist_ok=True)
    stats = []
    total_examples = 0
    start_time = time.time()

    for idx, (agent_id, agent_name, category, gen_fn) in enumerate(AGENTS):
        dir_name = f"agent_{agent_id.replace('-','_')}_{agent_name.replace(' ','_')}"
        dir_path = os.path.join(LORA_BASE, dir_name)
        os.makedirs(dir_path, exist_ok=True)

        train_examples = []
        eval_examples = []
        SYSTEM = f"당신은 Eden 마켓플레이스의 {agent_name}입니다. 역할: {category}. 정확하고 친절하게 응답하세요."

        # Generate 500 train + 50 eval
        for j in range(550):
            try:
                user_text, assistant_text = gen_fn()
                # Add variety
                if j % 7 == 0:
                    user_text = user_text + f" (상품: {rm()})"
                if j % 11 == 0:
                    user_text = f"[{rc()}] " + user_text
                example = {
                    "messages": [
                        {"role": "system", "content": SYSTEM},
                        {"role": "user", "content": user_text},
                        {"role": "assistant", "content": assistant_text}
                    ]
                }
                if j < 500:
                    train_examples.append(example)
                else:
                    eval_examples.append(example)
            except Exception as e:
                pass  # skip failed examples

        write_jsonl(os.path.join(dir_path, "train.jsonl"), train_examples)
        write_jsonl(os.path.join(dir_path, "eval.jsonl"), eval_examples)
        total_examples += len(train_examples) + len(eval_examples)
        stats.append((agent_id, agent_name, category, len(train_examples), len(eval_examples)))

        if (idx + 1) % 20 == 0:
            elapsed = time.time() - start_time
            print(f"  Progress: {idx+1}/161 agents ({elapsed:.1f}s)")

    elapsed = time.time() - start_time
    print(f"Done: {len(AGENTS)} agents, {total_examples:,} total examples in {elapsed:.1f}s")

    # Write stats report
    lines = [
        "# LoRA Finetune Dataset Stats",
        f"**Generated:** 2026-05-01",
        f"**Total Agents:** {len(AGENTS)}",
        f"**Total Examples:** {total_examples:,}",
        f"**Format:** JSONL messages (system/user/assistant)",
        f"**Generation Time:** {elapsed:.1f}s",
        "",
        "## Per-Agent Stats",
        "",
        "| Agent ID | Name | Category | Train | Eval |",
        "|----------|------|----------|-------|------|",
    ]
    for agent_id, name, cat, tr, ev in stats:
        lines.append(f"| {agent_id} | {name} | {cat} | {tr} | {ev} |")
    lines.append("")
    lines.append(f"**Total:** {sum(s[3] for s in stats):,} train + {sum(s[4] for s in stats):,} eval")

    with open(STATS_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Stats written to {STATS_PATH}")

if __name__ == "__main__":
    main()
