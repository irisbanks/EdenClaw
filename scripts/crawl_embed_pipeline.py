"""
crawl_embed_pipeline.py
─────────────────────────────────────────────────────────────────────────────
11번가 카테고리별 크롤링 → SQLite 저장 → GPU 임베딩 → FAISS 인덱스 구축

사용법:
    python3 scripts/crawl_embed_pipeline.py              # 전체 실행
    python3 scripts/crawl_embed_pipeline.py --skip-crawl  # 임베딩만 재실행
    python3 scripts/crawl_embed_pipeline.py --pages 3     # 카테고리당 3페이지
    python3 scripts/crawl_embed_pipeline.py --gpu 3       # GPU 번호 지정
"""

import argparse
import asyncio
import json
import math
import random
import re
import sqlite3
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import torch
from playwright.async_api import async_playwright, TimeoutError as PWTimeout
from playwright_stealth import Stealth
from sentence_transformers import SentenceTransformer
from tqdm import tqdm
import faiss

# ── 경로 설정 ─────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent.parent
DATA_DIR   = BASE_DIR / "data"
LOG_DIR    = BASE_DIR / "logs"
DB_PATH    = DATA_DIR / "shop_products.db"
EMB_PATH   = DATA_DIR / "embeddings.npy"
IDS_PATH   = DATA_DIR / "product_ids.npy"
FAISS_PATH = DATA_DIR / "faiss_index.bin"

DATA_DIR.mkdir(exist_ok=True)
LOG_DIR.mkdir(exist_ok=True)

# ── 크롤링 카테고리 키워드 목록 (광범위 확장판) ──────────────────────────────
CATEGORIES = {
    # ── 스마트폰 ──────────────────────────────────────────────────────────────
    "스마트폰": [
        "아이폰15", "아이폰14", "아이폰13", "아이폰12", "아이폰11", "아이폰SE",
        "갤럭시S24", "갤럭시S23", "갤럭시S22", "갤럭시S21", "갤럭시S20",
        "갤럭시A54", "갤럭시A34", "갤럭시Z플립5", "갤럭시Z폴드5",
        "샤오미14", "픽셀8", "원플러스12",
    ],
    # ── 태블릿 ────────────────────────────────────────────────────────────────
    "태블릿": [
        "아이패드프로", "아이패드에어", "아이패드미니", "아이패드10세대",
        "갤럭시탭S9", "갤럭시탭S8", "갤럭시탭A9", "갤럭시탭A8",
        "레노버탭", "화웨이탭",
    ],
    # ── 노트북 ────────────────────────────────────────────────────────────────
    "노트북": [
        "맥북에어M3", "맥북에어M2", "맥북프로M3", "맥북프로M2",
        "삼성노트북", "삼성갤럭시북4", "삼성갤럭시북3", "삼성갤럭시북2",
        "LG그램", "LG그램16", "레노버노트북", "레노버씽크패드",
        "델노트북", "델XPS", "HP노트북", "에이수스노트북",
        "MSI게이밍노트북", "레이저블레이드",
    ],
    # ── 스니커즈/운동화 ───────────────────────────────────────────────────────
    "스니커즈": [
        "나이키에어맥스", "나이키에어포스1", "나이키조던1", "나이키조던4",
        "나이키덩크로우", "나이키덩크하이", "나이키줌플라이",
        "아디다스삼바", "아디다스가젤", "아디다스슈퍼스타", "아디다스이지부스트",
        "뉴발란스530", "뉴발란스574", "뉴발란스990", "뉴발란스2002R",
        "온클라우드", "온클라우드러너", "아식스겔카야노", "아식스겔님버스",
        "살로몬XT6", "호카원원", "브룩스러닝화",
    ],
    # ── 명품가방 ──────────────────────────────────────────────────────────────
    "명품가방": [
        "구찌가방", "구찌마몬트", "루이비통", "루이비통네버풀", "루이비통스피디",
        "샤넬백", "샤넬클래식", "에르메스버킨", "에르메스켈리",
        "발렌시아가", "프라다백", "셀린느백", "보테가베네타",
        "디올백", "지방시백", "생로랑백", "몽블랑",
    ],
    # ── 일반가방/백팩 ─────────────────────────────────────────────────────────
    "가방": [
        "백팩", "크로스백", "토트백", "숄더백", "캐리어여행가방",
        "노스페이스백팩", "헤르쉘백팩", "탐탐백팩", "에코백",
        "아디다스가방", "나이키가방", "MLB가방",
    ],
    # ── 패션의류 ──────────────────────────────────────────────────────────────
    "패션의류": [
        "나이키후드티", "나이키맨투맨", "아디다스후드티",
        "스톤아일랜드", "몽클레어패딩", "캐나다구스패딩",
        "아미파리스", "메종키츠네", "아크테릭스", "피크퍼포먼스",
        "노스페이스패딩", "노스페이스바람막이", "파타고니아",
        "이자벨마랑", "아페쎄코트", "꼼데가르송",
        "청바지리바이스", "청바지디젤", "디스퀘어드",
    ],
    # ── 시계 ──────────────────────────────────────────────────────────────────
    "시계": [
        "애플워치9", "애플워치울트라2", "갤럭시워치7", "갤럭시워치울트라",
        "롤렉스중고", "롤렉스서브마리너", "오메가시마스터", "오메가스피드마스터",
        "까르띠에탱크", "파네라이", "IWC파일럿", "태그호이어",
        "가민페닉스", "가민포러너",
    ],
    # ── 생활가전 ──────────────────────────────────────────────────────────────
    "가전": [
        "다이슨청소기", "다이슨에어랩", "다이슨에어퓨리파이어",
        "삼성로봇청소기", "LG코드제로", "로보락청소기",
        "LG에어컨", "삼성에어컨", "삼성냉장고", "LG냉장고",
        "삼성세탁기", "LG세탁기드럼", "LG스타일러",
        "삼성TV", "LG올레드TV", "샤오미TV",
        "쿠쿠밥솥", "쿠첸밥솥", "위닉스공기청정기",
    ],
    # ── 카메라/렌즈 ───────────────────────────────────────────────────────────
    "카메라": [
        "소니A7C2", "소니A7IV", "소니A6700", "소니ZV-E10",
        "캐논R50", "캐논R8", "캐논R6마크2",
        "후지필름X100VI", "후지필름XT5", "후지필름XS20",
        "니콘Z30", "니콘Z50II",
        "소니FE렌즈", "시그마렌즈", "탐론렌즈",
        "고프로히어로12", "DJI오즈모포켓3",
    ],
    # ── 오디오/이어폰 ─────────────────────────────────────────────────────────
    "오디오": [
        "에어팟프로2", "에어팟3세대", "에어팟맥스",
        "갤럭시버즈3", "갤럭시버즈프로",
        "소니WH1000XM5", "소니WF1000XM5",
        "보스QC45", "보스QC울트라", "보스700",
        "뱅앤올룹슨", "센하이저모멘텀",
        "마샬스피커", "JBL스피커", "소니스피커",
    ],
    # ── 게임기/콘솔 ───────────────────────────────────────────────────────────
    "게임기": [
        "플레이스테이션5", "PS5게임", "플스5컨트롤러",
        "닌텐도스위치", "닌텐도스위치라이트", "닌텐도스위치OLED",
        "엑스박스시리즈X", "엑스박스시리즈S",
        "스팀덱", "ROGAlly", "레노버레기온고",
    ],
    # ── 골프용품 ──────────────────────────────────────────────────────────────
    "골프": [
        "타이틀리스트드라이버", "타이틀리스트아이언", "타이틀리스트웨지",
        "캘러웨이드라이버", "캘러웨이아이언", "캘러웨이패러다임",
        "핑드라이버", "핑아이언",
        "테일러메이드스텔스", "테일러메이드SIM",
        "클리브랜드웨지", "골프공타이틀리스트", "골프백",
    ],
    # ── 자전거 ────────────────────────────────────────────────────────────────
    "자전거": [
        "캐논데일자전거", "트렉자전거", "자이언트자전거",
        "삼천리자전거", "스페셜라이즈드", "비앙키자전거",
        "전기자전거", "따릉이자전거", "MTB자전거",
        "픽시자전거", "로드자전거",
    ],
    # ── 스포츠/아웃도어 ───────────────────────────────────────────────────────
    "스포츠": [
        "등산화", "살로몬등산화", "머렐등산화",
        "헬스기구홈짐", "덤벨세트", "바벨세트", "요가매트",
        "테니스라켓윌슨", "배드민턴라켓요넥스",
        "스케이트보드", "롤러블레이드",
        "캠핑의자", "캠핑테이블", "텐트", "침낭",
    ],
    # ── 악기 ──────────────────────────────────────────────────────────────────
    "악기": [
        "어쿠스틱기타", "일렉기타", "베이스기타",
        "펜더기타", "깁슨기타", "야마하기타",
        "디지털피아노", "전자드럼", "Roland피아노",
        "바이올린", "우쿨렐레", "카혼",
    ],
    # ── 뷰티/향수 ─────────────────────────────────────────────────────────────
    "뷰티": [
        "샤넬향수", "디올향수", "조말론향수", "톰포드향수",
        "맥립스틱", "샤넬립스틱", "나스파운데이션",
        "설화수화장품", "후화장품", "이니스프리",
        "다이슨헤어드라이어", "GHD고데기",
    ],
    # ── 유아/아동용품 ─────────────────────────────────────────────────────────
    "유아용품": [
        "레고클래식", "레고테크닉", "레고시티",
        "다이어퍼백", "유모차스토케", "유모차맥클라렌",
        "아기띠에르고베이비", "카시트",
        "닌텐도게임", "마블레고",
    ],
    # ── 자동차용품 ────────────────────────────────────────────────────────────
    "자동차": [
        "블랙박스", "네비게이션", "차량용공기청정기",
        "카시트", "썬팅필름", "타이어", "차량용청소기",
        "자동차방향제", "하이패스단말기",
    ],
    # ── 도서/문구 ─────────────────────────────────────────────────────────────
    "도서": [
        "베스트셀러소설", "자기계발서", "경제경영도서",
        "파이로트볼펜", "몰스킨노트", "스테들러연필",
        "아이패드필름", "킨들페이퍼화이트",
    ],
}

PAGES_PER_KEYWORD = 5   # 기본 페이지 수 (변경 가능)
DELAY_RANGE       = (1.5, 3.0)  # 요청 간 딜레이 (초)

SELECTORS = {
    "card":  ".c-card-item--list",
    "name":  ".c-card-item__name",
    "price": ".c-card-item__price .value",
    "brand": ".c-card-item__brand-name",
    "shop":  ".c-seller__name",
    "link":  ".c-card-item__anchor",
}

UA_LIST = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
]

# ═════════════════════════════════════════════════════════════════════════════
# 1. DB 초기화
# ═════════════════════════════════════════════════════════════════════════════
def init_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS products (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            price       INTEGER,
            brand       TEXT,
            shop        TEXT,
            category    TEXT,
            keyword     TEXT,
            url         TEXT,
            crawled_at  TEXT DEFAULT (datetime('now','localtime'))
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_keyword ON products(keyword)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_category ON products(category)")
    conn.commit()
    return conn


def already_crawled(conn: sqlite3.Connection, keyword: str) -> bool:
    row = conn.execute("SELECT COUNT(*) FROM products WHERE keyword=?", (keyword,)).fetchone()
    return row[0] > 0


def insert_products(conn: sqlite3.Connection, rows: list[dict]) -> int:
    if not rows:
        return 0
    conn.executemany(
        "INSERT INTO products (name, price, brand, shop, category, keyword, url) VALUES (?,?,?,?,?,?,?)",
        [(r["name"], r["price"], r["brand"], r["shop"], r["category"], r["keyword"], r["url"]) for r in rows],
    )
    conn.commit()
    return len(rows)


# ═════════════════════════════════════════════════════════════════════════════
# 2. 크롤러
# ═════════════════════════════════════════════════════════════════════════════
def clean_name(raw: str) -> str:
    lines = [l.strip() for l in raw.strip().splitlines() if l.strip()]
    if lines and lines[0] in ("상품명", "상품명:"):
        lines = lines[1:]
    return " ".join(lines[:2])


def parse_price(raw: str) -> int | None:
    digits = re.sub(r"[^\d]", "", raw)
    return int(digits) if digits else None


async def crawl_keyword(
    page,
    keyword: str,
    category: str,
    pages: int,
    pbar: tqdm,
) -> list[dict]:
    results: list[dict] = []
    base_url = f"https://search.11st.co.kr/pc/total-search?kwd={keyword}"

    for pg in range(1, pages + 1):
        url = base_url if pg == 1 else f"{base_url}&currentPage={pg}"
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=25_000)
            await page.wait_for_selector(SELECTORS["card"], timeout=8_000)
            await page.wait_for_timeout(random.randint(800, 1400))

            cards = await page.query_selector_all(SELECTORS["card"])
            if not cards:
                break

            for card in cards:
                try:
                    name_el  = await card.query_selector(SELECTORS["name"])
                    price_el = await card.query_selector(SELECTORS["price"])
                    brand_el = await card.query_selector(SELECTORS["brand"])
                    shop_el  = await card.query_selector(SELECTORS["shop"])
                    link_el  = await card.query_selector(SELECTORS["link"])

                    name = clean_name(await name_el.inner_text()) if name_el else ""
                    if not name:
                        continue

                    price_raw = await price_el.inner_text() if price_el else ""
                    price     = parse_price(price_raw)
                    brand     = (await brand_el.inner_text()).strip() if brand_el else None
                    shop      = (await shop_el.inner_text()).strip() if shop_el else None
                    href      = await link_el.get_attribute("href") if link_el else None
                    if href and href.startswith("/"):
                        href = "https://www.11st.co.kr" + href

                    results.append({
                        "name": name, "price": price, "brand": brand,
                        "shop": shop, "category": category,
                        "keyword": keyword, "url": href,
                    })
                except Exception:
                    continue

        except PWTimeout:
            pbar.write(f"  ⚠ 타임아웃: {keyword} p{pg}")
            break
        except Exception as e:
            pbar.write(f"  ⚠ 오류: {keyword} p{pg} — {e}")
            break

        delay = random.uniform(*DELAY_RANGE)
        await asyncio.sleep(delay)

    return results


async def run_crawl(conn: sqlite3.Connection, pages: int) -> int:
    all_keywords = [(kw, cat) for cat, kws in CATEGORIES.items() for kw in kws]
    todo = [(kw, cat) for kw, cat in all_keywords if not already_crawled(conn, kw)]
    skip = len(all_keywords) - len(todo)

    print(f"\n{'='*60}")
    print(f"[크롤링 단계]  총 {len(all_keywords)}개 키워드 | 재개: {skip}개 스킵 | 실행: {len(todo)}개")
    eta_sec = len(todo) * pages * 2.5
    print(f"예상 소요: 약 {eta_sec/60:.0f}분  (키워드당 {pages}페이지, delay 포함)")
    print(f"{'='*60}\n")

    if not todo:
        total = conn.execute("SELECT COUNT(*) FROM products").fetchone()[0]
        print(f"✅ 모든 키워드 크롤링 완료 (DB 누적: {total:,}개)")
        return total

    stealth = Stealth()
    total_saved = 0

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage",
                  "--disable-blink-features=AutomationControlled"],
        )
        context = await browser.new_context(
            user_agent=random.choice(UA_LIST),
            viewport={"width": 1440, "height": 900},
            locale="ko-KR",
            timezone_id="Asia/Seoul",
            extra_http_headers={
                "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        )
        await stealth.apply_stealth_async(context)
        page = await context.new_page()

        with tqdm(total=len(todo), unit="kw", ncols=80, colour="cyan") as pbar:
            for kw, cat in todo:
                pbar.set_description(f"{cat}/{kw[:10]}")
                rows = await crawl_keyword(page, kw, cat, pages, pbar)

                saved = insert_products(conn, rows)
                total_saved += saved
                pbar.set_postfix({"저장": f"{saved}개", "누적": f"{total_saved:,}"})
                pbar.update(1)

        await browser.close()

    total_db = conn.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    print(f"\n✅ 크롤링 완료 — 이번 실행: {total_saved:,}개 | DB 전체: {total_db:,}개")
    return total_db


# ═════════════════════════════════════════════════════════════════════════════
# 3. 임베딩 + FAISS 인덱스
# ═════════════════════════════════════════════════════════════════════════════
def run_embed(gpu: int, batch_size: int = 512) -> None:
    print(f"\n{'='*60}")
    print(f"[임베딩 단계]  GPU cuda:{gpu}  모델: multilingual-e5-small")
    print(f"{'='*60}\n")

    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT id, name, category, brand, price FROM products ORDER BY id"
    ).fetchall()
    conn.close()

    if not rows:
        print("⚠ DB에 상품이 없습니다.")
        return

    ids     = np.array([r[0] for r in rows], dtype=np.int64)
    texts   = [
        f"query: {r[2]} {r[3] or ''} {r[1]}".strip()
        for r in rows
    ]

    print(f"대상 상품: {len(rows):,}개  |  배치 크기: {batch_size}")

    device = f"cuda:{gpu}" if torch.cuda.is_available() else "cpu"
    model  = SentenceTransformer("intfloat/multilingual-e5-small", device=device)

    n_batches = math.ceil(len(texts) / batch_size)
    embeddings_list: list[np.ndarray] = []

    t0 = time.time()
    with tqdm(total=len(texts), unit="item", ncols=80, colour="green") as pbar:
        for i in range(n_batches):
            chunk = texts[i * batch_size : (i + 1) * batch_size]
            vecs  = model.encode(chunk, convert_to_numpy=True,
                                 normalize_embeddings=True, show_progress_bar=False)
            embeddings_list.append(vecs)
            pbar.update(len(chunk))

    elapsed = time.time() - t0
    embeddings = np.vstack(embeddings_list).astype("float32")
    speed = len(rows) / elapsed

    print(f"\n임베딩 완료 — shape: {embeddings.shape} | {elapsed:.1f}초 ({speed:,.0f}개/초)")

    # 저장
    np.save(EMB_PATH, embeddings)
    np.save(IDS_PATH, ids)
    print(f"저장: {EMB_PATH}")
    print(f"저장: {IDS_PATH}")

    # FAISS 인덱스 구축 (cosine similarity = 정규화된 벡터의 inner product)
    dim   = embeddings.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(embeddings)
    faiss.write_index(index, str(FAISS_PATH))
    print(f"FAISS 인덱스: {FAISS_PATH}  ({index.ntotal:,} 벡터)")


# ═════════════════════════════════════════════════════════════════════════════
# 4. 통계 리포트
# ═════════════════════════════════════════════════════════════════════════════
def print_report() -> None:
    conn = sqlite3.connect(DB_PATH)
    total = conn.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    cats  = conn.execute(
        "SELECT category, COUNT(*) cnt, AVG(price) avg_price, MIN(price) min_p, MAX(price) max_p "
        "FROM products WHERE price > 0 GROUP BY category ORDER BY cnt DESC"
    ).fetchall()
    conn.close()

    print(f"\n{'='*70}")
    print(f"  최종 리포트  |  전체 상품: {total:,}개")
    print(f"{'='*70}")
    print(f"  {'카테고리':<12} {'상품수':>7} {'평균가':>12} {'최저가':>12} {'최고가':>12}")
    print(f"  {'-'*58}")
    for cat, cnt, avg, mn, mx in cats:
        print(f"  {cat:<12} {cnt:>7,} {int(avg):>11,}원 {int(mn):>11,}원 {int(mx):>11,}원")
    print(f"{'='*70}")

    if FAISS_PATH.exists():
        index = faiss.read_index(str(FAISS_PATH))
        print(f"\nFAISS 인덱스: {index.ntotal:,} 벡터 ({FAISS_PATH.stat().st_size/1024/1024:.1f}MB)")

    # 검색 데모
    print("\n[검색 데모] '나이키 에어맥스 중고' 유사 상품 Top5:")
    if EMB_PATH.exists() and IDS_PATH.exists():
        conn2  = sqlite3.connect(DB_PATH)
        model  = SentenceTransformer(
            "intfloat/multilingual-e5-small",
            device="cuda:2" if torch.cuda.is_available() else "cpu"
        )
        index  = faiss.read_index(str(FAISS_PATH))
        ids    = np.load(IDS_PATH)

        q_vec  = model.encode(["query: 스니커즈  나이키에어맥스"],
                               normalize_embeddings=True).astype("float32")
        scores, idx = index.search(q_vec, 5)
        for rank, (sc, fi) in enumerate(zip(scores[0], idx[0]), 1):
            pid  = int(ids[fi])
            row  = conn2.execute(
                "SELECT name, price, brand FROM products WHERE id=?", (pid,)
            ).fetchone()
            if row:
                price_str = f"{row[1]:,}원" if row[1] else "가격없음"
                print(f"  {rank}. {row[0][:50]:<52} {price_str:>10}  (유사도 {sc:.3f})")
        conn2.close()


# ═════════════════════════════════════════════════════════════════════════════
# 메인
# ═════════════════════════════════════════════════════════════════════════════
async def main() -> None:
    parser = argparse.ArgumentParser(description="11번가 크롤링 → GPU 임베딩 파이프라인")
    parser.add_argument("--skip-crawl",  action="store_true", help="크롤링 건너뛰고 임베딩만")
    parser.add_argument("--skip-embed",  action="store_true", help="임베딩 건너뜀")
    parser.add_argument("--pages",  type=int, default=PAGES_PER_KEYWORD, help="카테고리당 페이지 수")
    parser.add_argument("--gpu",    type=int, default=2,  help="임베딩에 사용할 GPU 번호")
    parser.add_argument("--batch",  type=int, default=512, help="임베딩 배치 크기")
    args = parser.parse_args()

    started = datetime.now()
    print(f"\n🚀 EDENCLAW 데이터 파이프라인 시작: {started.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"   카테고리: {len(CATEGORIES)}개 | 키워드: {sum(len(v) for v in CATEGORIES.values())}개 | 페이지: {args.pages}")

    conn = init_db()

    # ── 단계 1: 크롤링 ──────────────────────────────────────────────────────
    if not args.skip_crawl:
        await run_crawl(conn, args.pages)
    else:
        total = conn.execute("SELECT COUNT(*) FROM products").fetchone()[0]
        print(f"\n[크롤링 스킵]  DB 현재: {total:,}개")

    conn.close()

    # ── 단계 2: 임베딩 ──────────────────────────────────────────────────────
    if not args.skip_embed:
        run_embed(args.gpu, args.batch)

    # ── 단계 3: 리포트 ──────────────────────────────────────────────────────
    print_report()

    elapsed = (datetime.now() - started).total_seconds()
    print(f"\n✅ 전체 완료  —  총 소요: {elapsed/60:.1f}분")

    # 결과 요약 JSON 저장
    summary = {
        "completed_at": datetime.now().isoformat(),
        "elapsed_min": round(elapsed / 60, 1),
        "db_path": str(DB_PATH),
        "embeddings_path": str(EMB_PATH),
        "faiss_path": str(FAISS_PATH),
    }
    summary_path = LOG_DIR / f"pipeline_{started.strftime('%Y%m%d_%H%M%S')}.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"요약 저장: {summary_path}\n")


if __name__ == "__main__":
    asyncio.run(main())
