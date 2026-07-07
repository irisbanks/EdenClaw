"""
korea_shop_crawler.py
11번가 상품 검색 결과 크롤러 (playwright + playwright-stealth)

사용법:
    python3 scripts/korea_shop_crawler.py            # 기본: 맥북 검색
    python3 scripts/korea_shop_crawler.py 아이폰
    python3 scripts/korea_shop_crawler.py 나이키 --limit 20 --out results.json
"""

import asyncio
import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

from playwright.async_api import async_playwright, TimeoutError as PWTimeout
from playwright_stealth import Stealth

# ── 설정 ──────────────────────────────────────────────────────────────────────
BASE_URL = "https://search.11st.co.kr/pc/total-search"
DEFAULT_KEYWORD = "맥북"
DEFAULT_LIMIT = 40

UA_LIST = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
]

SELECTORS = {
    "card":  ".c-card-item--list",            # 상품 카드 컨테이너
    "name":  ".c-card-item__name",            # 상품명 (텍스트 앞 "상품명\n" 제거 필요)
    "price": ".c-card-item__price .value",    # 가격 숫자 (원 단위)
    "brand": ".c-card-item__brand-name",      # 브랜드명
    "shop":  ".c-seller__name",               # 판매자/스토어명
    "link":  ".c-card-item__anchor",          # 상품 링크 (href)
}

# ── 파서 ──────────────────────────────────────────────────────────────────────
def clean_name(raw: str) -> str:
    """'상품명\n실제이름' → '실제이름'"""
    lines = [l.strip() for l in raw.strip().splitlines() if l.strip()]
    if lines and lines[0] in ("상품명", "상품명:"):
        lines = lines[1:]
    return " ".join(lines[:2])  # 최대 두 줄 합치기


def parse_price(raw: str) -> int | None:
    """'1,190,000원' → 1190000"""
    digits = re.sub(r"[^\d]", "", raw)
    return int(digits) if digits else None


# ── 크롤러 ────────────────────────────────────────────────────────────────────
async def crawl(keyword: str, limit: int = DEFAULT_LIMIT) -> list[dict]:
    import random
    ua = random.choice(UA_LIST)
    stealth = Stealth()

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
                "--disable-infobars",
            ],
        )
        context = await browser.new_context(
            user_agent=ua,
            viewport={"width": 1440, "height": 900},
            locale="ko-KR",
            timezone_id="Asia/Seoul",
            extra_http_headers={
                "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        )

        # stealth 적용: 봇 탐지 우회 스크립트 주입
        await stealth.apply_stealth_async(context)
        page = await context.new_page()

        url = f"{BASE_URL}?kwd={keyword}"
        print(f"[*] 검색 URL: {url}")
        print(f"[*] User-Agent: {ua[:60]}...")

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        except PWTimeout:
            print("[!] 페이지 로딩 타임아웃 — 부분 결과로 진행")

        # JS 렌더링 완료 대기 (상품 카드 출현 대기)
        try:
            await page.wait_for_selector(SELECTORS["card"], timeout=10_000)
        except PWTimeout:
            print("[!] 상품 카드 대기 타임아웃 — 현재 DOM으로 진행")

        # 추가 렌더링 여유
        await page.wait_for_timeout(1_500)

        # ── 상품 추출 ──────────────────────────────────────────────────────
        cards = await page.query_selector_all(SELECTORS["card"])
        print(f"[*] 상품 카드 발견: {len(cards)}개 (최대 {limit}개 추출)")

        results: list[dict] = []

        for i, card in enumerate(cards[:limit]):
            try:
                # 상품명
                name_el = await card.query_selector(SELECTORS["name"])
                name_raw = await name_el.inner_text() if name_el else ""
                name = clean_name(name_raw)

                # 가격
                price_el = await card.query_selector(SELECTORS["price"])
                price_raw = await price_el.inner_text() if price_el else ""
                price = parse_price(price_raw)

                # 브랜드 (optional)
                brand_el = await card.query_selector(SELECTORS["brand"])
                brand = (await brand_el.inner_text()).strip() if brand_el else None

                # 판매자 (optional)
                shop_el = await card.query_selector(SELECTORS["shop"])
                shop = (await shop_el.inner_text()).strip() if shop_el else None

                # 링크 (optional)
                link_el = await card.query_selector(SELECTORS["link"])
                href = await link_el.get_attribute("href") if link_el else None
                if href and href.startswith("/"):
                    href = "https://www.11st.co.kr" + href

                if not name:
                    continue

                results.append(
                    {
                        "rank": i + 1,
                        "name": name,
                        "price": price,
                        "price_str": f"{price:,}원" if price else "가격 없음",
                        "brand": brand,
                        "shop": shop,
                        "url": href,
                    }
                )

            except Exception as e:
                print(f"  [경고] 카드 {i+1} 파싱 실패: {e}")
                continue

        await browser.close()
        return results


# ── 출력 ──────────────────────────────────────────────────────────────────────
def print_table(items: list[dict]) -> None:
    if not items:
        print("[!] 결과 없음")
        return
    header = f"{'순위':>4}  {'상품명':<55}  {'가격':>12}  {'브랜드':<10}"
    print("\n" + "=" * len(header))
    print(header)
    print("=" * len(header))
    for item in items:
        name = item["name"][:54]
        brand = (item["brand"] or "")[:9]
        price = item["price_str"]
        print(f"{item['rank']:>4}  {name:<55}  {price:>12}  {brand:<10}")
    print("=" * len(header))
    prices = [i["price"] for i in items if i["price"]]
    if prices:
        print(f"\n최저가: {min(prices):,}원  /  최고가: {max(prices):,}원  /  평균가: {sum(prices)//len(prices):,}원")


# ── 메인 ──────────────────────────────────────────────────────────────────────
async def main() -> None:
    parser = argparse.ArgumentParser(description="11번가 검색 결과 크롤러")
    parser.add_argument("keyword", nargs="?", default=DEFAULT_KEYWORD, help="검색 키워드 (기본: 맥북)")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="최대 추출 수 (기본: 40)")
    parser.add_argument("--out", type=str, default=None, help="JSON 출력 파일 경로")
    args = parser.parse_args()

    print(f"\n[11번가 크롤러] 키워드: '{args.keyword}' | 최대: {args.limit}개")
    print(f"시작: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    items = await crawl(args.keyword, args.limit)

    print_table(items)

    # JSON 저장
    out_path = args.out
    if out_path is None:
        safe_kw = re.sub(r"[^\w가-힣]", "_", args.keyword)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_path = str(Path(__file__).parent.parent / "logs" / f"crawl_{safe_kw}_{ts}.json")

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "keyword": args.keyword,
        "crawled_at": datetime.now().isoformat(),
        "total": len(items),
        "items": items,
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"\n[*] JSON 저장 완료: {out_path}")
    print(f"[*] 완료: {len(items)}개 상품 추출")


if __name__ == "__main__":
    asyncio.run(main())
