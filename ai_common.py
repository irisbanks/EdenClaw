from __future__ import annotations

import json
import math
import os
import re
import sqlite3
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
SHOP_DB_PATH = DATA_DIR / "shop_products.db"
PERFORMANCE_DB_PATH = DATA_DIR / "ai_performance.db"
REPORT_DIR = BASE_DIR / "reports"

USD_KRW_FALLBACK = float(os.getenv("USD_KRW_FALLBACK", "1474.07"))
CONDITIONAL_PRICE_RE = re.compile(
    r"(?:0\s*원|공짜폰|무료폰|번호이동|기기변경|기변|선택약정|공시|지원금|완납|요금제|개통|약정)",
    re.IGNORECASE,
)
ACCESSORY_RE = re.compile(
    r"(?:case|protector|adapter|charger|cable|screen|glass|lens protector|cover|skin|"
    r"케이스|보호기|보호필름|필름|충전기|케이블|어댑터|커버|키스킨|가방|파우치)",
    re.IGNORECASE,
)


def load_env(path: Path | None = None) -> None:
    env_path = path or BASE_DIR / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def now_ms() -> float:
    return time.perf_counter() * 1000.0


def parse_json_object(text: str) -> dict[str, Any] | None:
    text = (text or "").strip()
    if not text:
        return None
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"\s*```$", "", text).strip()
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def safe_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, (int, float)) and not math.isnan(float(value)):
        return float(value)
    match = re.search(r"-?\d+(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?", str(value))
    if not match:
        return default
    return float(match.group(0).replace(",", ""))


def money_usd(value: Any) -> float:
    value = safe_float(value, 0.0)
    if value > 10000:
        return value / USD_KRW_FALLBACK
    return value


@dataclass(slots=True)
class TradeTask:
    scenario: str
    message: str
    product_name: str = ""
    budget: float | None = None
    preferred_platform: str = ""
    target_price: float | None = None
    seller_info: str = ""
    start_price: float | None = None
    category: str = ""
    currency: str = "USD"
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class ProductCandidate:
    name: str
    platform: str
    price_usd: float
    source_id: str
    seller: str = ""
    url: str = ""
    confidence: float = 0.75
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_prompt_line(self, index: int) -> str:
        line = (
            f"{index}. [{self.source_id}] {self.name} | {self.platform} | "
            f"${self.price_usd:,.2f} | seller={self.seller or 'unknown'}"
        )
        if self.metadata:
            extras = []
            if self.metadata.get("required_capital_usd") is not None:
                extras.append(f"required_capital=${float(self.metadata['required_capital_usd']):,.2f}")
            if self.metadata.get("sell_price_usd") is not None:
                extras.append(f"sell_price=${float(self.metadata['sell_price_usd']):,.2f}")
            if self.metadata.get("net_profit_usd") is not None:
                extras.append(f"net_profit=${float(self.metadata['net_profit_usd']):,.2f}")
            if self.metadata.get("margin_percent") is not None:
                extras.append(f"roi={float(self.metadata['margin_percent']):,.2f}%")
            if extras:
                line += " | " + " | ".join(extras)
        return line


@dataclass(slots=True)
class AgentResult:
    agent: str
    model: str
    scenario: str
    recommendation: str
    platform: str
    price: float
    confidence: float
    fraud_risk: float
    negotiation_success: float
    expected_profit_rate: float
    details: str
    raw: str = ""
    latency_ms: float = 0.0
    cost_usd: float = 0.0
    ok: bool = True
    error: str = ""
    source: str = "api"
    metrics: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def infer_scenario(message: str, explicit: str | None = None) -> str:
    if explicit:
        return explicit
    text = message.lower()
    if any(token in text for token in ("차익", "arbitrage", "마진", "수익률")):
        return "arbitrage"
    if any(token in text for token in ("협상", "negotiate", "깎", "할인", "흥정")):
        return "negotiate"
    if any(token in text for token in ("팔", "판매", "매도", "sell")):
        return "sell"
    return "buy"


def parse_user_task(payload: dict[str, Any]) -> TradeTask:
    message = str(payload.get("message") or payload.get("text") or "").strip()
    scenario = infer_scenario(message, payload.get("scenario"))
    budget = payload.get("budget")
    target = payload.get("target_price") or payload.get("targetPrice")
    start = payload.get("start_price") or payload.get("startPrice")
    user_price = payload.get("userPrice") or payload.get("user_price")
    product = str(payload.get("product_name") or payload.get("productName") or "").strip()

    if not product:
        product = extract_product_name(message, scenario)
    if budget is None:
        budget = extract_budget(message)
    if target is None and scenario in {"sell", "negotiate"}:
        target = extract_labeled_number(message, ("목표", "target"))
    if start is None and scenario == "negotiate":
        start = user_price or extract_labeled_number(message, ("시작", "start", "판매가", "가격"))

    return TradeTask(
        scenario=scenario,
        message=message,
        product_name=product,
        budget=money_usd(budget) if budget is not None else None,
        preferred_platform=str(payload.get("preferred_platform") or payload.get("preferredPlatform") or "").strip(),
        target_price=money_usd(target) if target is not None else None,
        seller_info=str(payload.get("seller_info") or payload.get("sellerInfo") or "").strip(),
        start_price=money_usd(start) if start is not None else None,
        category=str(payload.get("category") or infer_category(message, scenario)).strip(),
        currency=str(payload.get("currency") or "USD"),
        metadata={k: v for k, v in payload.items() if k not in {"message", "text"}},
    )


def extract_labeled_number(message: str, labels: tuple[str, ...]) -> float | None:
    lowered = message.lower()
    for label in labels:
        idx = lowered.find(label.lower())
        if idx >= 0:
            chunk = lowered[idx : idx + 40]
            value = safe_float(chunk, 0.0)
            if value > 0:
                return value
    return None


def extract_budget(message: str) -> float | None:
    patterns = [
        r"(?:예산|budget|under|below|까지|이하)\s*[:=]?\s*\$?\s*(\d+(?:,\d{3})*(?:\.\d+)?)",
        r"\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)",
        r"(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:달러|usd|불)",
        r"(\d+(?:,\d{3})*(?:\.\d+)?)\s*원",
    ]
    lowered = message.lower()
    for pattern in patterns:
        match = re.search(pattern, lowered, flags=re.IGNORECASE)
        if match:
            return safe_float(match.group(1))
    return None


def infer_category(message: str, scenario: str) -> str:
    if scenario != "arbitrage":
        return ""
    text = re.sub(r"\d+(?:,\d{3})*(?:\.\d+)?\s*(?:달러|usd|원)?", "", message, flags=re.IGNORECASE)
    text = re.sub(r"(예산|으로|차익거래|가능한|상품|찾아줘|추천|해줘|카테고리)", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return "" if len(text) < 2 else text


def extract_product_name(message: str, scenario: str) -> str:
    text = message
    text = re.sub(
        r"\d+(?:,\d{3})*(?:\.\d+)?\s*(?:달러|usd|불|원)\s*(?:예산)?",
        " ",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\b(budget|under|below|target|start)\b\s*[:=]?\s*\$?\d[\d,.]*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"(예산|목표|시작|희망가|판매가)\s*[:=]?\s*\$?\d[\d,.]*\s*(달러|원|usd|krw)?", "", text, flags=re.IGNORECASE)
    stopwords = {
        "사고", "싶어", "구매", "매수", "팔고", "판매", "매도", "협상", "가격", "차익",
        "찾아줘", "추천", "해줘", "협상해줘", "하고", "싶다", "싶어", "내가", "가진",
        "예산", "예산으로", "으로", "가능한", "상품", "차익거래",
        "please", "buy", "sell", "negotiate",
        "arbitrage", "budget", "with", "for",
    }
    tokens = []
    for token in re.split(r"\s+", text.strip()):
        token = token.strip(" ,.?!")
        if token and token.lower() not in stopwords:
            tokens.append(token)
    cleaned = " ".join(tokens).strip(" ,.")
    if cleaned:
        return cleaned
    return {"buy": "product", "sell": "owned product", "negotiate": "product", "arbitrage": "category"}.get(scenario, "product")


def task_context(task: TradeTask, limit: int = 8) -> list[ProductCandidate]:
    if task.scenario == "arbitrage":
        return arbitrage_candidates(task, limit)
    query = task.product_name or task.category or task.message
    return search_local_products(query, budget=task.budget, limit=limit)


def search_local_products(query: str, budget: float | None = None, limit: int = 8) -> list[ProductCandidate]:
    if not SHOP_DB_PATH.exists():
        return []
    tokens = [t for t in re.split(r"\s+", query) if len(t) > 1][:5]
    if not tokens:
        tokens = [query]
    candidates: list[ProductCandidate] = []
    conn = sqlite3.connect(SHOP_DB_PATH)
    try:
        candidates.extend(fetch_product_rows(conn, query, tokens, budget, require_all=True))
        candidates.extend(fetch_global_rows(conn, query, tokens, budget, require_all=True))
        if len(candidates) < limit:
            candidates.extend(fetch_product_rows(conn, query, tokens, budget, require_all=False))
            candidates.extend(fetch_global_rows(conn, query, tokens, budget, require_all=False))
    finally:
        conn.close()

    seen: set[tuple[str, str, int]] = set()
    unique: list[ProductCandidate] = []
    for item in sorted(candidates, key=lambda c: (candidate_relevance(query, c), c.price_usd)):
        key = (item.platform, re.sub(r"\W+", "", item.name.lower())[:120], int(item.price_usd * 100))
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
        if len(unique) >= limit:
            break
    return unique


def fetch_product_rows(
    conn: sqlite3.Connection,
    query: str,
    tokens: list[str],
    budget: float | None,
    require_all: bool,
) -> list[ProductCandidate]:
    joiner = " AND " if require_all else " OR "
    where = joiner.join(["name LIKE ?" for _ in tokens])
    params = [f"%{token}%" for token in tokens]
    rows = conn.execute(
        f"""
        SELECT id, name, price, shop, url
        FROM products
        WHERE price > 0 AND ({where})
        ORDER BY price ASC
        LIMIT 500
        """,
        params,
    ).fetchall()
    out: list[ProductCandidate] = []
    for row in rows:
        price_usd = float(row[2]) / USD_KRW_FALLBACK
        if not valid_market_candidate(query, row[1], price_usd):
            continue
        if budget and price_usd > budget * 1.1:
            continue
        out.append(
            ProductCandidate(
                name=row[1],
                platform="11번가",
                price_usd=price_usd,
                source_id=f"products:{row[0]}",
                seller=row[3] or "",
                url=row[4] or "",
            )
        )
    return out


def fetch_global_rows(
    conn: sqlite3.Connection,
    query: str,
    tokens: list[str],
    budget: float | None,
    require_all: bool,
) -> list[ProductCandidate]:
    joiner = " AND " if require_all else " OR "
    where = joiner.join(["(standard_name LIKE ? OR keyword LIKE ?)" for _ in tokens])
    params: list[str] = []
    for token in tokens:
        params.extend([f"%{token}%", f"%{token}%"])
    rows = conn.execute(
        f"""
        SELECT id, standard_name, price_usd, seller_shop, source, url
        FROM global_products
        WHERE price_usd > 0 AND ({where})
        ORDER BY price_usd ASC
        LIMIT 500
        """,
        params,
    ).fetchall()
    out: list[ProductCandidate] = []
    for row in rows:
        price_usd = float(row[2])
        if not valid_market_candidate(query, row[1], price_usd):
            continue
        if budget and price_usd > budget * 1.1:
            continue
        platform = normalize_platform(row[4] or row[3])
        out.append(
            ProductCandidate(
                name=row[1],
                platform=platform,
                price_usd=price_usd,
                source_id=f"global_products:{row[0]}",
                seller=row[3] or "",
                url=row[5] or "",
            )
        )
    return out


def valid_market_candidate(query: str, name: str, price_usd: float) -> bool:
    if price_usd < 5:
        return False
    if CONDITIONAL_PRICE_RE.search(name or ""):
        return False
    query_is_accessory = bool(ACCESSORY_RE.search(query or ""))
    if not query_is_accessory and ACCESSORY_RE.search(name or ""):
        return False
    query_lower = (query or "").lower()
    if any(token in query_lower for token in ("iphone", "아이폰", "galaxy", "갤럭시", "smartphone")) and price_usd < 100:
        return False
    if any(token in query_lower for token in ("ipad", "아이패드", "tablet", "태블릿")) and price_usd < 100:
        return False
    if any(token in query_lower for token in ("macbook", "노트북", "laptop")) and price_usd < 150:
        return False
    return True


def candidate_relevance(query: str, item: ProductCandidate) -> int:
    haystack = item.name.lower()
    tokens = [token.lower().strip(" ,.?!") for token in re.split(r"\s+", query) if len(token) > 1]
    misses = sum(1 for token in tokens if token and token not in haystack)
    return misses


def arbitrage_candidates(task: TradeTask, limit: int = 8) -> list[ProductCandidate]:
    path = DATA_DIR / "arbitrage_opportunities.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    category = (task.category or task.product_name or "").lower()
    if any(token in category for token in ("차익", "상품", "가능", "찾아")):
        category = strip_generic_arbitrage_terms(category)
    out: list[ProductCandidate] = []
    for item in data.get("opportunities", []):
        name = str(item.get("product_name") or "")
        if not arbitrage_item_matches(category, item):
            continue
        buy_price = safe_float(item.get("buy_price_usd"))
        sell_price = safe_float(item.get("sell_price_usd"))
        fee = safe_float(item.get("sale_fee_percent")) / 100.0
        vat = safe_float(item.get("vat_percent"), 8.0) / 100.0
        required_capital = buy_price * (1.0 + vat)
        if task.budget and required_capital > task.budget:
            continue
        net_profit = safe_float(item.get("net_profit_usd"))
        margin = safe_float(item.get("margin_percent"))
        out.append(
            ProductCandidate(
                name=name,
                platform=f"{item.get('buy_platform')} -> {item.get('sell_platform')}",
                price_usd=buy_price,
                source_id=f"{item.get('buy_record_id')}|{item.get('sell_record_id')}",
                seller=f"profit ${net_profit:,.2f}, roi {margin:.2f}%",
                url=str(item.get("buy_url") or item.get("sell_url") or ""),
                confidence=safe_float(item.get("similarity"), 0.8),
                metadata={
                    "buy_price_usd": round(buy_price, 2),
                    "sell_price_usd": round(sell_price, 2),
                    "required_capital_usd": round(required_capital, 2),
                    "net_profit_usd": round(net_profit, 2),
                    "margin_percent": round(margin, 2),
                    "sale_fee_percent": safe_float(item.get("sale_fee_percent")),
                    "vat_percent": safe_float(item.get("vat_percent"), 8.0),
                    "similarity": safe_float(item.get("similarity"), 0.0),
                },
            )
        )
        if len(out) >= limit:
            break
    return out


def strip_generic_arbitrage_terms(text: str) -> str:
    text = re.sub(
        r"(차익거래|차익|상품|가능한|가능|찾아줘|추천|예산|budget|arbitrage|with|for|under|below)",
        " ",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\d+(?:,\d{3})*(?:\.\d+)?\s*(?:달러|usd|불|원)?", " ", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()


def arbitrage_item_matches(query: str, item: dict[str, Any]) -> bool:
    query = strip_generic_arbitrage_terms(query or "")
    if not query:
        return True
    haystack = " ".join(
        str(item.get(key) or "")
        for key in ("product_name", "buy_platform", "sell_platform", "buy_record_id", "sell_record_id")
    ).lower()
    query_lower = query.lower()
    family_aliases = {
        "iphone": ("iphone", "아이폰"),
        "ipad": ("ipad", "아이패드"),
        "macbook": ("macbook", "맥북"),
        "galaxy": ("galaxy", "갤럭시"),
        "sony": ("sony", "소니"),
    }
    for aliases in family_aliases.values():
        if any(alias in query_lower for alias in aliases):
            return any(alias in haystack for alias in aliases)

    tokens = [
        token
        for token in re.findall(r"[a-z0-9]+|[가-힣]+", query_lower)
        if len(token) >= 3 and token not in {"pro", "max", "gb", "budget", "usd", "krw"}
    ]
    if not tokens:
        return True
    required = max(1, min(len(tokens), 2))
    return sum(1 for token in tokens if token in haystack) >= required


def normalize_platform(value: str) -> str:
    text = (value or "").lower()
    if "amazon" in text:
        return "Amazon"
    if "newegg" in text:
        return "Newegg"
    if "ali" in text:
        return "AliExpress"
    if "wish" in text:
        return "Wish"
    if "11" in text:
        return "11번가"
    return value or "Unknown"


def build_context_block(candidates: list[ProductCandidate]) -> str:
    if not candidates:
        return "No local marketplace candidates were found. Be conservative and say what should be verified."
    return "\n".join(candidate.to_prompt_line(i + 1) for i, candidate in enumerate(candidates))


def result_from_payload(
    agent: str,
    model: str,
    scenario: str,
    payload: dict[str, Any] | None,
    raw: str,
    latency_ms: float,
    source: str,
    ok: bool,
    error: str = "",
) -> AgentResult:
    payload = payload or {}
    confidence = normalize_percent(payload.get("confidence"), 70.0)
    fraud_risk = normalize_percent(payload.get("fraud_risk"), 25.0)
    negotiation_success = normalize_percent(payload.get("negotiation_success"), 55.0)
    profit_rate = normalize_percent(payload.get("expected_profit_rate") or payload.get("profit_rate"), 0.0)
    price = extract_price_from_payload(payload, scenario)
    return AgentResult(
        agent=agent,
        model=model,
        scenario=scenario,
        recommendation=str(payload.get("recommendation") or payload.get("summary") or "로컬 후보 기반 추천"),
        platform=str(payload.get("platform") or payload.get("recommended_platform") or ""),
        price=price,
        confidence=confidence,
        fraud_risk=fraud_risk,
        negotiation_success=negotiation_success,
        expected_profit_rate=profit_rate,
        details=str(payload.get("details") or payload.get("reason") or raw[:500]),
        raw=raw,
        latency_ms=latency_ms,
        cost_usd=max(0.0, safe_float(payload.get("cost_usd"), 0.0)),
        ok=ok,
        error=error,
        source=source,
    )


def extract_price_from_payload(payload: dict[str, Any], scenario: str) -> float:
    keys = (
        "price",
        "expected_price",
        "estimated_price",
        "suggested_price",
        "fair_price",
        "market_price",
    )
    for key in keys:
        price = money_usd(payload.get(key))
        if price > 0:
            return price
    for container_key in ("analysis", "strategy", "result", "data"):
        nested = payload.get(container_key)
        if not isinstance(nested, dict):
            continue
        nested_keys = keys
        if scenario == "negotiate":
            nested_keys = (
                "suggested_price",
                "fair_price",
                "market_price",
                "avg_final_price",
                "expected_final_price",
                "estimated_price",
                "price",
            )
        for key in nested_keys:
            price = money_usd(nested.get(key))
            if price > 0:
                return price
    for key in ("message", "details", "reason", "summary"):
        price = extract_labeled_price_from_text(payload.get(key), scenario)
        if price > 0:
            return price
    return 0.0


def extract_labeled_price_from_text(value: Any, scenario: str) -> float:
    if value is None:
        return 0.0
    if isinstance(value, dict):
        texts = [str(item) for item in value.values()]
    elif isinstance(value, list):
        texts = [str(item) for item in value]
    else:
        texts = [str(value)]
    text = "\n".join(texts)
    labels = (
        "suggested price",
        "expected final price",
        "estimated price",
        "market price",
        "fair price",
        "추천가",
        "예상 최종 가격",
        "평균 최종 거래가",
        "시세",
    )
    if scenario == "negotiate":
        labels = (
            "시세",
            "suggested price",
            "market price",
            "fair price",
            "expected final price",
            "예상 최종 가격",
            "평균 최종 거래가",
            "추천가",
        )
    for label in labels:
        manwon_pattern = rf"{re.escape(label)}[^\d$]{{0,40}}(\d+(?:\.\d+)?)\s*만\s*원"
        manwon_match = re.search(manwon_pattern, text, flags=re.IGNORECASE)
        if manwon_match:
            amount = safe_float(manwon_match.group(1)) * 10000.0
            if amount > 0:
                return amount / USD_KRW_FALLBACK
        pattern = rf"{re.escape(label)}[^\d$]{{0,40}}(?:\$?\s*(\d+(?:,\d{{3}})*(?:\.\d+)?)\s*(원|krw|usd|달러|불)?|\$\s*(\d+(?:,\d{{3}})*(?:\.\d+)?))"
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if not match:
            continue
        value_text = match.group(1) or match.group(3)
        unit = (match.group(2) or ("usd" if match.group(3) else "")).lower()
        amount = safe_float(value_text)
        if amount <= 0:
            continue
        if unit in {"원", "krw"} or amount > 10000:
            return amount / USD_KRW_FALLBACK
        return amount
    return 0.0


def normalize_result_against_task(result: AgentResult, task: TradeTask) -> None:
    if task.scenario == "negotiate":
        floor = expected_minimum_price(task)
        if 0.0 < result.price < floor:
            result.details = f"{result.details}\n\n[price normalization] Ignored implausible non-price value ${result.price:,.2f}."
            result.price = 0.0
    if task.scenario == "arbitrage":
        text = f"{result.recommendation}\n{result.details}\n{result.platform}".lower()
        rejection_terms = (
            "not possible",
            "not viable",
            "no viable",
            "cannot",
            "unavailable",
            "n/a",
            "불가능",
            "불가",
            "없습니다",
            "초과",
            "해당없음",
        )
        if any(term in text for term in rejection_terms):
            result.price = 0.0
            result.expected_profit_rate = 0.0
        if task.budget and result.price > task.budget:
            result.details = (
                f"{result.details}\n\n[budget filter] Candidate price ${result.price:,.2f} "
                f"exceeds budget ${task.budget:,.2f}."
            )
            result.price = 0.0
            result.expected_profit_rate = 0.0


def expected_minimum_price(task: TradeTask) -> float:
    text = f"{task.product_name} {task.message}".lower()
    if any(token in text for token in ("macbook", "맥북", "laptop", "노트북")):
        return 150.0
    if any(token in text for token in ("iphone", "아이폰", "ipad", "아이패드", "galaxy", "갤럭시")):
        return 100.0
    return 20.0


def normalize_percent(value: Any, default: float = 0.0) -> float:
    score = safe_float(value, default)
    if 0.0 < score <= 1.0:
        score *= 100.0
    return max(0.0, min(100.0, score))


def heuristic_result(agent: str, model: str, task: TradeTask, candidates: list[ProductCandidate], error: str = "") -> AgentResult:
    started = now_ms()
    if candidates:
        if task.scenario == "sell":
            chosen = max(candidates, key=lambda c: c.price_usd)
            price = task.target_price or chosen.price_usd * 0.96
            platform = "11번가" if agent in {"Edenclaw AI", "Gemini"} else chosen.platform
            recommendation = f"{chosen.name} 판매가는 ${price:,.2f} 근처가 적정합니다."
            profit = 0.0
        elif task.scenario == "arbitrage":
            chosen = max(candidates, key=candidate_profit_usd)
            price = chosen.price_usd
            platform = chosen.platform
            recommendation = f"{chosen.name} 차익 후보를 우선 검토하세요."
            profit = max(0.0, min(100.0, float(chosen.metadata.get("margin_percent") or 0.0)))
        else:
            chosen = min(candidates, key=lambda c: c.price_usd)
            price = chosen.price_usd
            platform = chosen.platform
            recommendation = f"{chosen.name} 후보가 현재 로컬 데이터에서 가장 경쟁력 있습니다."
            profit = 0.0
    else:
        price = 0.0 if task.scenario == "arbitrage" else task.budget or task.target_price or task.start_price or 0.0
        platform = task.preferred_platform or "검증 필요"
        recommendation = (
            "예산과 키워드에 맞는 차익거래 후보가 없습니다."
            if task.scenario == "arbitrage"
            else "로컬 후보가 부족해 외부 가격 검증 후 진행이 필요합니다."
        )
        profit = 0.0

    agent_bias = {
        "GPT-5.5": (3.0, 20.0, 78.0),
        "Gemini": (1.5, 24.0, 74.0),
        "Claude": (2.0, 16.0, 82.0),
        "Edenclaw AI": (-2.0, 12.0, 88.0),
    }.get(agent, (0.0, 25.0, 70.0))
    price = max(0.0, price * (1.0 + agent_bias[0] / 100.0))
    return AgentResult(
        agent=agent,
        model=model,
        scenario=task.scenario,
        recommendation=recommendation,
        platform=platform,
        price=round(price, 2),
        confidence=agent_bias[2],
        fraud_risk=agent_bias[1],
        negotiation_success=72.0 if task.scenario == "negotiate" else 58.0,
        expected_profit_rate=profit,
        details="API 응답이 없거나 키가 없어 로컬 상품 DB와 규칙 기반 평가로 생성했습니다.",
        raw="",
        latency_ms=now_ms() - started,
        cost_usd=0.0,
        ok=False if error else True,
        error=error,
        source="local-fallback",
    )


def candidate_profit_usd(candidate: ProductCandidate) -> float:
    return float(candidate.metadata.get("net_profit_usd") or 0.0)
