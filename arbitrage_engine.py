#!/usr/bin/env python3
"""
Edenclaw arbitrage engine.

Loads marketplace product data, matches the same products by embeddings, compares
USD-normalized prices, and writes the top arbitrage opportunities.
"""

from __future__ import annotations

import csv
import hashlib
import html
import json
import math
import os
import re
import sqlite3
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
SHOP_PRODUCTS_DIR = DATA_DIR / "shop_products"
DB_PATH = DATA_DIR / "shop_products.db"
EXISTING_EMB_PATH = DATA_DIR / "embeddings.npy"
EXISTING_IDS_PATH = DATA_DIR / "product_ids.npy"
OUTPUT_PATH = DATA_DIR / "arbitrage_opportunities.json"

VLLM_EMBEDDINGS_URL = os.getenv(
    "VLLM_EMBEDDINGS_URL", "http://localhost:8000/v1/embeddings"
)
VLLM_MODEL = os.getenv("VLLM_MODEL", "Qwen/Qwen2.5-72B-Instruct")
EMBEDDING_THRESHOLD = float(os.getenv("ARBITRAGE_SIMILARITY_THRESHOLD", "0.85"))
MIN_MARGIN_PERCENT = float(os.getenv("ARBITRAGE_MIN_MARGIN_PERCENT", "5"))
TOP_N = int(os.getenv("ARBITRAGE_TOP_N", "100"))
CONSOLE_TOP_N = int(os.getenv("ARBITRAGE_CONSOLE_TOP_N", "20"))
GPU_ID = int(os.getenv("ARBITRAGE_GPU", "2"))
VAT_RATE = float(os.getenv("ARBITRAGE_KR_VAT", "0.08"))
MIN_RETAIL_PRICE_USD = float(os.getenv("ARBITRAGE_MIN_RETAIL_PRICE_USD", "5"))
MAX_PRICE_RATIO = float(os.getenv("ARBITRAGE_MAX_PRICE_RATIO", "20"))

PLATFORM_FEES = {
    "Amazon": 0.15,
    "AliExpress": 0.05,
    "11번가": 0.08,
}

PLATFORM_ALIASES = {
    "amazon": "Amazon",
    "amz": "Amazon",
    "newegg": "Newegg",
    "newegg_playwright": "Newegg",
    "aliexpress": "AliExpress",
    "ali express": "AliExpress",
    "playwright_aliexpress": "AliExpress",
    "wish": "Wish",
    "11st": "11번가",
    "11street": "11번가",
    "11번가": "11번가",
    "elevenstreet": "11번가",
}

SUPPORTED_PLATFORMS = {"Amazon", "Newegg", "AliExpress", "Wish", "11번가"}

CONDITIONAL_PRICE_PATTERN = re.compile(
    r"(?:\b0\s*원\b|공짜폰|번호이동|기기변경|기변|선택약정|공시지원|요금제|개통|약정|완납)",
    re.IGNORECASE,
)

ACCESSORY_PATTERN = re.compile(
    r"(?:case|cover|charger|charging|cable|adapter|protector|film|strap|stand|mount|"
    r"remote|control|buckle|clasp|band|bracelet|bangle|replacement|compatible|"
    r"silicone|skin|sleeve|bag|pouch|hat|cap|snapback|trucker|bezel|ring|part|"
    r"strings|pick|patch|tee|shirt|battery|keyboard|viewfinder|eyepiece|glass|guide|book|"
    r"케이스|커버|충전기|케이블|어댑터|보호필름|필름|스트랩|거치대|마운트|"
    r"리모컨|버클|클래스프|밴드|시계줄|호환품|호환용|실리콘|스킨|키스킨|"
    r"가방|파우치|서류가방|보호기|강화\s*유리|모자|스냅백|트러커|베젤|"
    r"아우터\s*링|부품|먼지|스트링|피크|패치|티셔츠|배터리|키보드|뷰\s*파인더|"
    r"접안렌즈|유리|가이드|책|렌털|렌탈)",
    re.IGNORECASE,
)

BRAND_SYNONYMS = {
    "애플": "apple iphone ipad macbook",
    "아이폰": "iphone apple",
    "아이패드": "ipad apple",
    "맥북": "macbook apple",
    "삼성": "samsung galaxy",
    "삼성전자": "samsung galaxy",
    "갤럭시": "galaxy samsung",
    "소니": "sony",
    "캐논": "canon",
    "니콘": "nikon",
    "후지필름": "fujifilm",
    "다이슨": "dyson",
    "오즈모": "osmo",
    "포켓": "pocket",
    "닌텐도": "nintendo switch",
    "플레이스테이션": "playstation ps5",
    "나이키": "nike",
    "아디다스": "adidas",
    "뉴발란스": "newbalance",
    "보스": "bose",
    "가민": "garmin",
    "로렉스": "rolex",
    "롤렉스": "rolex",
    "오메가": "omega",
    "샤넬": "chanel",
    "구찌": "gucci",
    "루이비통": "louis vuitton",
    "레노버": "lenovo",
    "델": "dell",
    "엘지": "lg",
    "lg전자": "lg",
    "까르띠에": "cartier",
    "세이코": "seiko",
}

KNOWN_BRAND_TOKENS = {
    "apple",
    "iphone",
    "ipad",
    "macbook",
    "samsung",
    "galaxy",
    "sony",
    "canon",
    "nikon",
    "fujifilm",
    "dyson",
    "dji",
    "nintendo",
    "playstation",
    "xbox",
    "nike",
    "adidas",
    "newbalance",
    "bose",
    "garmin",
    "rolex",
    "omega",
    "seiko",
    "cartier",
    "gucci",
    "vuitton",
    "lenovo",
    "dell",
    "lg",
    "gibson",
    "microsoft",
}

GENERIC_IDENTIFIER_TOKENS = {
    "new",
    "with",
    "for",
    "and",
    "the",
    "from",
    "compatible",
    "refurbished",
    "excellent",
    "black",
    "white",
    "blue",
    "green",
    "red",
    "pink",
    "gold",
    "silver",
    "titanium",
    "edition",
    "세대",
    "해외",
    "정품",
}


def ensure_package(import_name: str, package_name: str | None = None) -> Any:
    try:
        return __import__(import_name)
    except ImportError:
        package_name = package_name or import_name
        print(f"[deps] installing {package_name} ...")
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "-q", package_name]
        )
        return __import__(import_name)


np = ensure_package("numpy")


@dataclass(slots=True)
class ProductRecord:
    record_id: str
    platform: str
    name: str
    price_original: float
    currency: str
    price_usd: float
    brand: str = ""
    keyword: str = ""
    category: str = ""
    seller: str = ""
    url: str = ""
    source: str = ""
    table: str = ""
    numeric_id: int | None = None

    @property
    def embedding_text(self) -> str:
        parts = [self.keyword, self.category, self.brand, self.name]
        return "query: " + " ".join(p.strip() for p in parts if p and p.strip())


@dataclass(slots=True)
class Opportunity:
    product_name: str
    similarity: float
    buy_platform: str
    sell_platform: str
    buy_price_usd: float
    sell_price_usd: float
    sale_fee_percent: float
    vat_percent: float
    net_profit_usd: float
    margin_percent: float
    buy_record_id: str
    sell_record_id: str
    buy_url: str
    sell_url: str


def normalize_platform(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    lowered = re.sub(r"\s+", " ", text.lower())
    if lowered in PLATFORM_ALIASES:
        return PLATFORM_ALIASES[lowered]
    for key, platform in PLATFORM_ALIASES.items():
        if key in lowered:
            return platform
    return text


def clean_text(value: Any) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def parse_price(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)) and not math.isnan(float(value)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    text = html.unescape(text)
    text = text.replace(",", "")
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return None
    price = float(match.group(0))
    return price if price > 0 else None


def is_valid_retail_price(name: str, price_usd: float | None) -> bool:
    if price_usd is None or price_usd < MIN_RETAIL_PRICE_USD:
        return False
    return not CONDITIONAL_PRICE_PATTERN.search(name)


def infer_currency(row: dict[str, Any], platform: str) -> str:
    explicit = str(
        row.get("currency")
        or row.get("price_currency")
        or row.get("currency_code")
        or ""
    ).upper()
    if explicit in {"USD", "KRW", "JPY", "CNY", "EUR", "GBP"}:
        return explicit
    raw_price = str(row.get("raw_price") or row.get("price") or "")
    if "$" in raw_price or "usd" in raw_price.lower():
        return "USD"
    if "₩" in raw_price or "원" in raw_price or "krw" in raw_price.lower():
        return "KRW"
    if "¥" in raw_price or "jpy" in raw_price.lower():
        return "JPY"
    if platform == "11번가":
        return "KRW"
    return "USD"


def fetch_exchange_rates() -> dict[str, float]:
    url = "https://open.er-api.com/v6/latest/USD"
    fallback = {
        "USD": 1.0,
        "KRW": 1473.124555,
        "JPY": 157.0,
        "CNY": 7.24,
        "EUR": 0.88,
        "GBP": 0.76,
    }
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if payload.get("result") == "success" and isinstance(payload.get("rates"), dict):
            rates = {k.upper(): float(v) for k, v in payload["rates"].items()}
            rates["USD"] = 1.0
            print(
                "[rates] live USD rates loaded "
                f"(KRW={rates.get('KRW', fallback['KRW']):,.2f})"
            )
            return rates
    except Exception as exc:
        print(f"[rates] live lookup failed, using fallback rates: {exc}")
    return fallback


def to_usd(amount: float | None, currency: str, rates: dict[str, float]) -> float | None:
    if amount is None or amount <= 0:
        return None
    currency = currency.upper()
    if currency == "USD":
        return float(amount)
    rate = rates.get(currency)
    if not rate:
        return None
    return float(amount) / rate


def load_file_rows(path: Path) -> list[dict[str, Any]]:
    suffix = path.suffix.lower()
    if suffix == ".json":
        with path.open("r", encoding="utf-8") as f:
            payload = json.load(f)
        if isinstance(payload, list):
            return [row for row in payload if isinstance(row, dict)]
        if isinstance(payload, dict):
            for key in ("products", "items", "data", "results"):
                if isinstance(payload.get(key), list):
                    return [row for row in payload[key] if isinstance(row, dict)]
            return [payload]
    if suffix == ".jsonl":
        rows = []
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    item = json.loads(line)
                    if isinstance(item, dict):
                        rows.append(item)
        return rows
    if suffix == ".csv":
        with path.open("r", encoding="utf-8-sig", newline="") as f:
            return list(csv.DictReader(f))
    if suffix in {".parquet", ".pq"}:
        pd = ensure_package("pandas")
        return pd.read_parquet(path).to_dict("records")
    return []


def normalize_file_record(
    row: dict[str, Any], path: Path, row_index: int, rates: dict[str, float]
) -> ProductRecord | None:
    name = clean_text(
        row.get("name")
        or row.get("product_name")
        or row.get("title")
        or row.get("standard_name")
        or row.get("raw_name")
    )
    if not name:
        return None

    platform = normalize_platform(
        row.get("platform")
        or row.get("marketplace")
        or row.get("source")
        or row.get("shop")
        or row.get("seller_shop")
        or path.stem
    )
    if platform not in SUPPORTED_PLATFORMS:
        return None

    price_usd = parse_price(row.get("price_usd") or row.get("usd_price"))
    price_original = parse_price(
        row.get("price")
        or row.get("raw_price")
        or row.get("price_krw")
        or row.get("price_jpy")
    )
    currency = infer_currency(row, platform)
    if price_usd is None:
        price_usd = to_usd(price_original, currency, rates)
    if price_original is None:
        price_original = price_usd
        currency = "USD"
    if price_usd is None or price_usd <= 0 or price_original is None:
        return None
    if not is_valid_retail_price(name, price_usd):
        return None

    return ProductRecord(
        record_id=f"file:{path.relative_to(BASE_DIR)}:{row_index}",
        platform=platform,
        name=name,
        price_original=float(price_original),
        currency=currency,
        price_usd=float(price_usd),
        brand=clean_text(row.get("brand") or row.get("producer_brand")),
        keyword=clean_text(row.get("keyword") or row.get("search_query")),
        category=clean_text(row.get("category")),
        seller=clean_text(row.get("seller") or row.get("seller_shop") or row.get("shop")),
        url=clean_text(row.get("url") or row.get("link")),
        source=clean_text(row.get("source") or path.name),
        table="file",
    )


def load_from_shop_products_dir(rates: dict[str, float]) -> list[ProductRecord]:
    if not SHOP_PRODUCTS_DIR.exists():
        return []
    records: list[ProductRecord] = []
    files = [
        path
        for path in SHOP_PRODUCTS_DIR.rglob("*")
        if path.is_file()
        and path.suffix.lower() in {".json", ".jsonl", ".csv", ".parquet", ".pq"}
    ]
    for path in files:
        try:
            for idx, row in enumerate(load_file_rows(path)):
                record = normalize_file_record(row, path, idx, rates)
                if record:
                    records.append(record)
        except Exception as exc:
            print(f"[load] skipped {path}: {exc}")
    return records


def load_from_sqlite(rates: dict[str, float]) -> list[ProductRecord]:
    if not DB_PATH.exists():
        return []
    records: list[ProductRecord] = []
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    global_rows = conn.execute(
        """
        SELECT id, standard_name, raw_name, price_usd, price_krw, producer_brand,
               seller_shop, raw_seller, source, keyword, search_query, url
        FROM global_products
        WHERE COALESCE(price_usd, 0) > 0 OR COALESCE(price_krw, 0) > 0
        """
    ).fetchall()

    active_keywords = {clean_text(row["keyword"]) for row in global_rows if row["keyword"]}
    product_query = """
        SELECT id, name, price, brand, shop, category, keyword, url
        FROM products
        WHERE COALESCE(price, 0) > 0
    """
    params: list[Any] = []
    if active_keywords:
        placeholders = ",".join("?" for _ in active_keywords)
        product_query += f" AND keyword IN ({placeholders})"
        params = sorted(active_keywords)
    product_rows = conn.execute(product_query, params).fetchall()

    for row in global_rows:
        platform = normalize_platform(row["source"] or row["seller_shop"] or row["raw_seller"])
        if platform not in SUPPORTED_PLATFORMS:
            continue
        price_usd = parse_price(row["price_usd"])
        price_original = price_usd
        currency = "USD"
        if price_usd is None:
            price_original = parse_price(row["price_krw"])
            currency = "KRW"
            price_usd = to_usd(price_original, currency, rates)
        if price_usd is None or price_usd <= 0:
            continue
        name = clean_text(row["standard_name"] or row["raw_name"])
        if not is_valid_retail_price(name, price_usd):
            continue
        records.append(
            ProductRecord(
                record_id=f"global_products:{row['id']}",
                numeric_id=int(row["id"]),
                table="global_products",
                platform=platform,
                name=name,
                price_original=float(price_original or price_usd),
                currency=currency,
                price_usd=float(price_usd),
                brand=clean_text(row["producer_brand"]),
                keyword=clean_text(row["keyword"] or row["search_query"]),
                seller=clean_text(row["seller_shop"] or row["raw_seller"]),
                source=clean_text(row["source"]),
                url=clean_text(row["url"]),
            )
        )

    for row in product_rows:
        price_krw = parse_price(row["price"])
        price_usd = to_usd(price_krw, "KRW", rates)
        if price_usd is None:
            continue
        name = clean_text(row["name"])
        if not is_valid_retail_price(name, price_usd):
            continue
        records.append(
            ProductRecord(
                record_id=f"products:{row['id']}",
                numeric_id=int(row["id"]),
                table="products",
                platform="11번가",
                name=name,
                price_original=float(price_krw or 0),
                currency="KRW",
                price_usd=float(price_usd),
                brand=clean_text(row["brand"]),
                category=clean_text(row["category"]),
                keyword=clean_text(row["keyword"]),
                seller=clean_text(row["shop"]),
                source="11st",
                url=clean_text(row["url"]),
            )
        )

    conn.close()
    return records


def load_products(rates: dict[str, float]) -> tuple[list[ProductRecord], str]:
    records = load_from_shop_products_dir(rates)
    if records:
        return dedupe_records(records), str(SHOP_PRODUCTS_DIR)
    records = load_from_sqlite(rates)
    return dedupe_records(records), str(DB_PATH)


def dedupe_records(records: list[ProductRecord]) -> list[ProductRecord]:
    seen: set[tuple[str, str, int, str]] = set()
    unique: list[ProductRecord] = []
    for record in records:
        normalized_name = re.sub(r"\W+", "", record.name.lower())
        key = (
            record.platform,
            normalized_name[:160],
            int(round(record.price_usd * 100)),
            record.seller.lower()[:80],
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(record)
    if len(unique) != len(records):
        print(f"[load] deduped {len(records) - len(unique):,} duplicate rows")
    return unique


def post_json(url: str, payload: dict[str, Any], timeout: int = 30) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def try_vllm_embeddings(texts: list[str], batch_size: int = 128) -> tuple[Any | None, str]:
    if not texts:
        return np.zeros((0, 0), dtype="float32"), "vllm"
    try:
        probe = post_json(
            VLLM_EMBEDDINGS_URL,
            {"model": VLLM_MODEL, "input": [texts[0]]},
            timeout=15,
        )
        if not probe.get("data") or "embedding" not in probe["data"][0]:
            return None, "vLLM response did not include embeddings"
    except urllib.error.HTTPError as exc:
        return None, f"vLLM embeddings endpoint unavailable ({exc.code})"
    except Exception as exc:
        return None, f"vLLM embeddings endpoint unavailable ({exc})"

    vectors: list[list[float]] = []
    for start in range(0, len(texts), batch_size):
        chunk = texts[start : start + batch_size]
        payload = post_json(
            VLLM_EMBEDDINGS_URL,
            {"model": VLLM_MODEL, "input": chunk},
            timeout=120,
        )
        data = sorted(payload["data"], key=lambda item: item.get("index", 0))
        vectors.extend(item["embedding"] for item in data)
        print(f"[embed:vllm] {min(start + batch_size, len(texts)):,}/{len(texts):,}")

    arr = np.asarray(vectors, dtype="float32")
    return normalize_rows(arr), "vllm"


def normalize_rows(arr: Any) -> Any:
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return (arr / norms).astype("float32")


def load_existing_product_embeddings(records: list[ProductRecord]) -> dict[int, Any]:
    if not EXISTING_EMB_PATH.exists() or not EXISTING_IDS_PATH.exists():
        return {}
    product_ids = np.load(EXISTING_IDS_PATH, mmap_mode="r")
    if not any(r.table == "products" for r in records):
        return {}
    embedding_index = {int(product_id): idx for idx, product_id in enumerate(product_ids)}
    existing = np.load(EXISTING_EMB_PATH, mmap_mode="r")
    usable: dict[int, Any] = {}
    for record_index, record in enumerate(records):
        if record.table == "products" and record.numeric_id in embedding_index:
            usable[record_index] = np.asarray(
                existing[embedding_index[record.numeric_id]], dtype="float32"
            )
    return usable


def embed_with_sentence_transformers(texts: list[str], batch_size: int = 512) -> Any:
    sentence_transformers = ensure_package(
        "sentence_transformers", "sentence-transformers"
    )
    torch = ensure_package("torch")
    device = f"cuda:{GPU_ID}" if torch.cuda.is_available() else "cpu"
    model = sentence_transformers.SentenceTransformer(
        "intfloat/multilingual-e5-small", device=device
    )
    vectors = model.encode(
        texts,
        batch_size=batch_size,
        convert_to_numpy=True,
        normalize_embeddings=True,
        show_progress_bar=True,
    )
    return np.asarray(vectors, dtype="float32")


def hash_embeddings(texts: list[str], dim: int = 384) -> Any:
    vectors = np.zeros((len(texts), dim), dtype="float32")
    for row, text in enumerate(texts):
        normalized = re.sub(r"\s+", " ", text.lower())
        chars = f"  {normalized}  "
        grams = [chars[i : i + n] for n in (3, 4, 5) for i in range(max(1, len(chars) - n + 1))]
        for gram in grams:
            digest = hashlib.blake2b(gram.encode("utf-8"), digest_size=8).digest()
            bucket = int.from_bytes(digest[:4], "little") % dim
            sign = 1.0 if digest[4] & 1 else -1.0
            vectors[row, bucket] += sign
    return normalize_rows(vectors)


def build_embeddings(records: list[ProductRecord]) -> tuple[Any, str]:
    texts = [record.embedding_text for record in records]
    vectors, backend = try_vllm_embeddings(texts)
    if vectors is not None:
        return vectors, backend

    print(f"[embed] {backend}; falling back to local multilingual-e5-small on cuda:{GPU_ID}")
    existing = load_existing_product_embeddings(records)
    if existing:
        dim = len(next(iter(existing.values())))
        embeddings = np.zeros((len(records), dim), dtype="float32")
        missing_indices = [idx for idx in range(len(records)) if idx not in existing]
        for idx, vector in existing.items():
            embeddings[idx] = vector
        if missing_indices:
            missing_texts = [texts[idx] for idx in missing_indices]
            try:
                encoded = embed_with_sentence_transformers(missing_texts)
            except Exception as exc:
                print(f"[embed] local model failed ({exc}); using hash fallback")
                encoded = hash_embeddings(missing_texts, dim=dim)
            for offset, idx in enumerate(missing_indices):
                embeddings[idx] = encoded[offset]
        return normalize_rows(embeddings), "multilingual-e5-small+cached-products"

    try:
        return embed_with_sentence_transformers(texts), "multilingual-e5-small"
    except Exception as exc:
        print(f"[embed] local model failed ({exc}); using hash fallback")
        return hash_embeddings(texts), "hash-ngram-fallback"


def block_key(record: ProductRecord) -> str:
    if record.keyword:
        return "kw:" + record.keyword.lower()
    if record.category:
        return "cat:" + record.category.lower()
    tokens = re.findall(r"[a-z0-9가-힣]+", record.name.lower())
    useful = [token for token in tokens if len(token) >= 2][:4]
    return "name:" + " ".join(useful)


def sale_fee(platform: str) -> float:
    return PLATFORM_FEES.get(platform, 0.0)


def identifier_tokens(record: ProductRecord) -> set[str]:
    text = f"{record.brand} {record.name}".lower()
    expanded = [text]
    for needle, replacement in BRAND_SYNONYMS.items():
        if needle in text:
            expanded.append(replacement)
    text = " ".join(expanded)
    tokens = set(re.findall(r"[a-z]+[a-z0-9]*|\d+[a-z]+[a-z0-9]*|\d+|[가-힣]+", text))
    identifiers: set[str] = set()
    for token in tokens:
        if token in GENERIC_IDENTIFIER_TOKENS:
            continue
        if re.fullmatch(r"\d+(?:g|gb|tb)", token):
            continue
        if re.fullmatch(r"\d+", token):
            if 2 <= len(token) <= 4:
                identifiers.add(f"num{token}")
            continue
        if len(token) >= 4 or re.search(r"\d", token):
            identifiers.add(token)
    return identifiers


def lens_signature(record: ProductRecord) -> set[str]:
    text = f"{record.keyword} {record.category} {record.brand} {record.name}".lower()
    if not re.search(r"\bfe\b|lens|렌즈|oss|sel\d|f/\d", text):
        return set()
    focal_lengths = {
        match.replace(" ", "")
        for match in re.findall(r"\b\d{2,4}\s*-\s*\d{2,4}\s*mm\b|\b\d{2,4}\s*mm\b", text)
    }
    apertures = {
        match.replace(" ", "")
        for match in re.findall(r"f\s*/?\s*\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?", text)
    }
    model_numbers = set(re.findall(r"\bsel[a-z0-9]+\b", text))
    return focal_lengths | apertures | model_numbers


def brand_tokens(record: ProductRecord) -> set[str]:
    text = record.brand.lower().strip()
    if not text:
        return set()
    expanded = [text]
    for needle, replacement in BRAND_SYNONYMS.items():
        if needle in text:
            expanded.append(replacement)
    tokens = set(re.findall(r"[a-z]+[a-z0-9]*|[가-힣]+", " ".join(expanded)))
    return {token for token in tokens if len(token) >= 2 and token not in GENERIC_IDENTIFIER_TOKENS}


def known_brand_mentions(record: ProductRecord) -> set[str]:
    text = f"{record.brand} {record.name}".lower()
    expanded = [text]
    for needle, replacement in BRAND_SYNONYMS.items():
        if needle in text:
            expanded.append(replacement)
    tokens = set(re.findall(r"[a-z]+[a-z0-9]*|[가-힣]+", " ".join(expanded)))
    return tokens & KNOWN_BRAND_TOKENS


def is_accessory(record: ProductRecord) -> bool:
    return bool(ACCESSORY_PATTERN.search(record.name))


def product_types(record: ProductRecord) -> set[str]:
    text = f"{record.category} {record.name}".lower()
    types: set[str] = set()
    checks = [
        ("watch", r"watch|시계|워치|seamaster|speedmaster"),
        ("sunglasses", r"sunglasses|선글라스"),
        ("perfume", r"perfume|eau de toilette|향수"),
        ("guitar", r"guitar|기타|les paul|stratocaster"),
        ("laptop", r"laptop|notebook|노트북|macbook|xps|razer blade|lg gram"),
        ("camera", r"camera|카메라|mirrorless|eos|nikon z|canon r"),
        ("phone", r"smartphone|iphone|galaxy|스마트폰|아이폰|갤럭시"),
        ("tv", r"\btv\b|oled|텔레비전|올레드"),
        ("book", r"book|guide|가이드|책"),
    ]
    for name, pattern in checks:
        if re.search(pattern, text, re.IGNORECASE):
            types.add(name)
    return types


def same_product_candidate(
    left: ProductRecord, right: ProductRecord, similarity: float
) -> bool:
    if similarity < EMBEDDING_THRESHOLD:
        return False
    if is_accessory(left) != is_accessory(right):
        return False
    left_types = product_types(left)
    right_types = product_types(right)
    if left_types and right_types and not (left_types & right_types):
        return False

    left_brand = brand_tokens(left)
    right_brand = brand_tokens(right)
    if left_brand and right_brand and not (left_brand & right_brand):
        return False
    left_known_brands = known_brand_mentions(left)
    right_known_brands = known_brand_mentions(right)
    if left_known_brands and right_known_brands:
        if not (left_known_brands & right_known_brands):
            return False
        if left_known_brands != right_known_brands:
            return False

    left_tokens = identifier_tokens(left)
    right_tokens = identifier_tokens(right)
    left_lens = lens_signature(left)
    right_lens = lens_signature(right)
    if (left_lens or right_lens) and left_lens != right_lens:
        return False
    if not left_tokens or not right_tokens:
        return similarity >= 0.92

    overlap = left_tokens & right_tokens
    if not overlap:
        return False

    # A single broad family token is too weak for a resale match.
    if len(overlap) == 1 and next(iter(overlap)) in {
        "apple",
        "iphone",
        "ipad",
        "samsung",
        "galaxy",
        "sony",
        "nike",
        "adidas",
    }:
        return similarity >= 0.92

    return True


def opportunity_from_pair(
    left: ProductRecord, right: ProductRecord, similarity: float
) -> Opportunity | None:
    if left.platform == right.platform:
        return None
    if not same_product_candidate(left, right, similarity):
        return None
    low, high = (left, right) if left.price_usd <= right.price_usd else (right, left)
    if high.price_usd <= low.price_usd:
        return None
    if high.price_usd / max(low.price_usd, 0.01) > MAX_PRICE_RATIO:
        return None
    fee = sale_fee(high.platform)
    buy_cost = low.price_usd * (1.0 + VAT_RATE)
    sale_net = high.price_usd * (1.0 - fee)
    profit = sale_net - buy_cost
    if profit <= 0:
        return None
    margin = profit / buy_cost * 100.0
    if margin < MIN_MARGIN_PERCENT:
        return None
    product_name = low.name if len(low.name) <= len(high.name) else high.name
    return Opportunity(
        product_name=product_name,
        similarity=round(float(similarity), 4),
        buy_platform=low.platform,
        sell_platform=high.platform,
        buy_price_usd=round(low.price_usd, 2),
        sell_price_usd=round(high.price_usd, 2),
        sale_fee_percent=round(fee * 100.0, 2),
        vat_percent=round(VAT_RATE * 100.0, 2),
        net_profit_usd=round(profit, 2),
        margin_percent=round(margin, 2),
        buy_record_id=low.record_id,
        sell_record_id=high.record_id,
        buy_url=low.url,
        sell_url=high.url,
    )


def top_candidate_indices(scores: Any, top_k: int) -> Iterable[tuple[int, int, float]]:
    rows, cols = scores.shape
    if cols <= top_k:
        for i, j in zip(*np.where(scores >= EMBEDDING_THRESHOLD)):
            yield int(i), int(j), float(scores[i, j])
        return
    partition = np.argpartition(-scores, kth=top_k - 1, axis=1)[:, :top_k]
    for i in range(rows):
        js = partition[i]
        js = js[np.argsort(-scores[i, js])]
        for j in js:
            score = float(scores[i, j])
            if score >= EMBEDDING_THRESHOLD:
                yield i, int(j), score


def find_opportunities(records: list[ProductRecord], embeddings: Any) -> list[Opportunity]:
    groups: dict[str, list[int]] = {}
    for idx, record in enumerate(records):
        groups.setdefault(block_key(record), []).append(idx)

    opportunities: list[Opportunity] = []
    seen_pairs: set[tuple[str, str]] = set()
    compared_pairs = 0
    multi_platform_groups = 0

    for indices in groups.values():
        by_platform: dict[str, list[int]] = {}
        for idx in indices:
            by_platform.setdefault(records[idx].platform, []).append(idx)
        platforms = sorted(by_platform)
        if len(platforms) < 2:
            continue
        multi_platform_groups += 1
        for p_idx, left_platform in enumerate(platforms):
            left_indices = by_platform[left_platform]
            for right_platform in platforms[p_idx + 1 :]:
                right_indices = by_platform[right_platform]
                right_matrix = embeddings[right_indices].T
                for start in range(0, len(left_indices), 128):
                    left_chunk = left_indices[start : start + 128]
                    scores = embeddings[left_chunk] @ right_matrix
                    compared_pairs += scores.size
                    for i, j, score in top_candidate_indices(scores, top_k=8):
                        left_record = records[left_chunk[i]]
                        right_record = records[right_indices[j]]
                        pair_key = tuple(sorted((left_record.record_id, right_record.record_id)))
                        if pair_key in seen_pairs:
                            continue
                        seen_pairs.add(pair_key)
                        opportunity = opportunity_from_pair(left_record, right_record, score)
                        if opportunity:
                            opportunities.append(opportunity)

    opportunities.sort(key=lambda item: (item.net_profit_usd, item.margin_percent), reverse=True)
    print(
        f"[match] groups={multi_platform_groups:,}, compared_pairs={compared_pairs:,}, "
        f"opportunities={len(opportunities):,}"
    )
    return opportunities[:TOP_N]


def display_width(text: str) -> int:
    width = 0
    for char in text:
        width += 2 if unicodedata.east_asian_width(char) in {"F", "W"} else 1
    return width


def truncate_display(text: str, width: int) -> str:
    if display_width(text) <= width:
        return text
    result = ""
    for char in text:
        if display_width(result + char + "...") > width:
            break
        result += char
    return result + "..."


def pad_display(text: str, width: int) -> str:
    text = truncate_display(text, width)
    return text + " " * max(0, width - display_width(text))


def print_table(opportunities: list[Opportunity]) -> None:
    rows = opportunities[:CONSOLE_TOP_N]
    if not rows:
        print("\nNo arbitrage opportunities found above threshold.")
        return
    widths = [52, 14, 14, 12, 10]
    headers = ["상품명", "최저가 플랫폼", "최고가 플랫폼", "차익(USD)", "마진율"]
    print("\nTop arbitrage opportunities")
    print(
        " | ".join(pad_display(header, width) for header, width in zip(headers, widths))
    )
    print("-+-".join("-" * width for width in widths))
    for item in rows:
        values = [
            item.product_name,
            item.buy_platform,
            item.sell_platform,
            f"${item.net_profit_usd:,.2f}",
            f"{item.margin_percent:,.2f}%",
        ]
        print(
            " | ".join(pad_display(value, width) for value, width in zip(values, widths))
        )


def save_output(
    opportunities: list[Opportunity],
    records: list[ProductRecord],
    source: str,
    embedding_backend: str,
    rates: dict[str, float],
) -> None:
    platform_counts: dict[str, int] = {}
    for record in records:
        platform_counts[record.platform] = platform_counts.get(record.platform, 0) + 1
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "record_count": len(records),
        "platform_counts": dict(sorted(platform_counts.items())),
        "embedding_backend": embedding_backend,
        "similarity_threshold": EMBEDDING_THRESHOLD,
        "min_margin_percent": MIN_MARGIN_PERCENT,
        "min_retail_price_usd": MIN_RETAIL_PRICE_USD,
        "max_price_ratio": MAX_PRICE_RATIO,
        "vat_percent": VAT_RATE * 100.0,
        "platform_fees_percent": {
            platform: fee * 100.0 for platform, fee in PLATFORM_FEES.items()
        },
        "usd_rates": {key: rates[key] for key in ("KRW", "JPY", "CNY", "EUR", "GBP") if key in rates},
        "opportunities": [asdict(item) for item in opportunities],
    }
    DATA_DIR.mkdir(exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"\n[save] {OUTPUT_PATH.relative_to(BASE_DIR)} ({len(opportunities):,} items)")


def main() -> int:
    started = time.time()
    print("Edenclaw Arbitrage Engine")
    print(
        f"[config] threshold={EMBEDDING_THRESHOLD}, min_margin={MIN_MARGIN_PERCENT}%, "
        f"max_price_ratio={MAX_PRICE_RATIO}"
    )
    print(f"[config] vLLM embeddings={VLLM_EMBEDDINGS_URL}, model={VLLM_MODEL}")

    rates = fetch_exchange_rates()
    records, source = load_products(rates)
    if not records:
        print("[load] no product records found")
        return 1

    platform_counts: dict[str, int] = {}
    for record in records:
        platform_counts[record.platform] = platform_counts.get(record.platform, 0) + 1
    print(f"[load] source={source}")
    print(f"[load] records={len(records):,}, platforms={dict(sorted(platform_counts.items()))}")

    embeddings, embedding_backend = build_embeddings(records)
    print(f"[embed] backend={embedding_backend}, shape={tuple(embeddings.shape)}")

    opportunities = find_opportunities(records, embeddings)
    save_output(opportunities, records, source, embedding_backend, rates)
    print_table(opportunities)
    print(f"\n[done] elapsed={time.time() - started:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
