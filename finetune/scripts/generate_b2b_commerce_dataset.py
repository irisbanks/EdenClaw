#!/usr/bin/env python3
# Synthetic B2B commerce SFT generator for edenclaw-commerce-lora-v2.
# Overwrites edenclaw-ai/finetune/datasets/{product_intake,listing_writer,price_agent}_sft.jsonl
# with 200 rows each (600 total >= 500 requested). The first run preserves each
# original file as ${name}.bak.original — subsequent runs do NOT clobber that
# backup, so the original P2P consumer dataset stays recoverable.
#
# Output schema (canonical, deterministic):
#   { "cost": int, "scarcity": int, "gas_effect": float,
#     "counter_offer": int, "reasoning": str }
#
# Every assistant payload uses ONLY facts present in the user prompt + the
# deterministic formula below. No catalog noise, no invented brands, no
# extra meta fields. Reasoning is kept (probe demands "Reasoning"); all other
# meta-fields stay out — this is the over-extrapolation fix.
#
# Counter-offer formula (fact-grounded, no magic numbers):
#   scarcity_premium = (scarcity - 1) / 9  * 0.10      # 0% .. 10%
#   floor            = cost * (1 + gas_effect/100 + scarcity_premium)
#   target           = max(floor, offer + 0.05*cost)   # always defends margin
#   counter_offer    = ceil(target / 10) * 10
import json
import math
import random
import shutil
import sys
import time
from pathlib import Path

SEED = 20260524
DATASETS_DIR = Path("/NHNHOME/WORKSPACE/0426030063_A/edenclaw/edenclaw-ai/finetune/datasets")
ROWS_PER_FILE = 200  # 3 files * 200 = 600

PARTS = [
    ("센서 A-100",              2000, 9),
    ("센서 A-200",              2400, 7),
    ("센서 B-50",                850, 5),
    ("피에조 펌프 P-12",        3200, 8),
    ("피에조 펌프 P-24",        5800, 9),
    ("MEMS 자이로 G-7",         1450, 6),
    ("열전대 어레이 T-8",        720, 4),
    ("산업용 밸브 V-220",       1180, 3),
    ("BLDC 모터 BL-86",          480, 5),
    ("HV 절연 IGBT IG-1200",    2650, 8),
    ("초음파 트랜스듀서 UT-3",   640, 6),
    ("선형 액추에이터 LA-500",  1320, 5),
    ("PLC 모듈 M-340",          2100, 7),
    ("로드셀 LC-5T",             870, 4),
    ("광섬유 커플러 OFC-9",      410, 6),
    ("진공 펌프 VP-300",        4400, 7),
    ("질량 유량계 MFM-10",      5300, 8),
    ("정밀 다이아프램 DM-9",     920, 6),
    ("산소 센서 OX-22",         1640, 7),
    ("고압 레귤레이터 HR-7",    1980, 8),
]

GAS_SCENARIOS = [
    ("가스비 폭등 3% 발생",          3.0),
    ("가스비 안정세 0%",             0.0),
    ("가스비 인하 -2% 적용",        -2.0),
    ("가스비 변동 +1.5% 관측",       1.5),
    ("가스비 급등 +6% 발생",         6.0),
    ("가스비 소폭 인상 +0.8%",       0.8),
    ("가스비 인하 -3.5% 적용",      -3.5),
    ("가스비 급락 -5% 관측",        -5.0),
    ("가스비 변동 없음",             0.0),
    ("가스비 +4.2% 일시 급등",       4.2),
]

OFFER_PCTS = [80, 85, 90, 95, 100, 105, 110]

ROLE_CONTEXTS = {
    "product_intake_sft.jsonl": (
        "너는 에덴클로우 B2B 부품 인테이크 에이전트다. "
        "상품 등록 요청에 대해 입력된 팩트만 사용하여 표준 JSON으로 응답하라."
    ),
    "listing_writer_sft.jsonl": (
        "너는 에덴클로우 B2B 리스팅 에이전트다. "
        "공급자가 등록한 부품 정보만 사용하여 표준 JSON으로 응답하라."
    ),
    "price_agent_sft.jsonl": (
        "너는 에덴클로우 자율 상거래 에이전트다. "
        "이익 마진과 가스비를 방어하는 추론과 최종 호가를 표준 JSON으로 응답하라."
    ),
}


def compute_counter_offer(cost: int, scarcity: int, gas_pct: float, offer: int) -> int:
    scarcity_premium = (scarcity - 1) / 9.0 * 0.10
    floor = cost * (1 + gas_pct / 100.0 + scarcity_premium)
    target = max(floor, offer + 0.05 * cost)
    return int(math.ceil(target / 10.0) * 10)


def build_reasoning(cost: int, scarcity: int, gas_pct: float, offer: int, counter: int) -> str:
    delta_offer = (offer - cost) / cost * 100.0
    delta_counter = (counter - cost) / cost * 100.0
    premium = (scarcity - 1) / 9.0 * 10.0
    return (
        f"제공된 팩트: 원가 ${cost}, 희소성 {scarcity}점, 가스비 변동 {gas_pct:+.1f}%. "
        f"상대방 호가 ${offer}는 원가 대비 {delta_offer:+.1f}%. "
        f"가스비 변동분과 희소성 프리미엄 약 {premium:.1f}%를 합산한 마진 방어선에 따라 "
        f"최종 호가 ${counter} 산출 (원가 대비 {delta_counter:+.1f}%)."
    )


def generate_rows(filename: str, rng: random.Random) -> list[dict]:
    intro = ROLE_CONTEXTS[filename]
    rows = []
    for _ in range(ROWS_PER_FILE):
        product, base_cost, base_scarcity = rng.choice(PARTS)
        cost = int(round(base_cost * rng.uniform(0.8, 1.2) / 10.0) * 10)
        scarcity = max(1, min(10, base_scarcity + rng.randint(-2, 2)))
        gas_label, gas_pct = rng.choice(GAS_SCENARIOS)
        offer_pct = rng.choice(OFFER_PCTS)
        offer = int(round(cost * offer_pct / 100.0 / 10.0) * 10)
        counter = compute_counter_offer(cost, scarcity, gas_pct, offer)
        reasoning = build_reasoning(cost, scarcity, gas_pct, offer, counter)

        user_content = (
            f"{intro}\n"
            f"상품: {product} (원가 ${cost}), 희소성 {scarcity}점, 환경: {gas_label}. "
            f"상대방 호가 ${offer}에 대해 표준 JSON으로 응답하라."
        )
        assistant_payload = {
            "cost": cost,
            "scarcity": scarcity,
            "gas_effect": gas_pct,
            "counter_offer": counter,
            "reasoning": reasoning,
        }
        rows.append({
            "messages": [
                {"role": "user",      "content": user_content},
                {"role": "assistant", "content": json.dumps(assistant_payload, ensure_ascii=False)},
            ]
        })
    return rows


def backup_once(path: Path) -> Path | None:
    # Idempotent: preserve the very first ORIGINAL file, never clobber the original
    # backup with a later (synthetic) snapshot.
    existing = list(path.parent.glob(path.name + ".bak.*"))
    if existing:
        return None
    bak = path.with_suffix(path.suffix + ".bak.original")
    shutil.copy2(path, bak)
    return bak


def main() -> int:
    if not DATASETS_DIR.is_dir():
        print(f"FATAL: datasets dir missing: {DATASETS_DIR}", file=sys.stderr)
        return 1
    rng = random.Random(SEED)
    summary = []
    for fn in ROLE_CONTEXTS:
        path = DATASETS_DIR / fn
        bak = backup_once(path) if path.is_file() else None
        rows = generate_rows(fn, rng)
        path.write_text(
            "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n",
            encoding="utf-8",
        )
        summary.append({
            "file": str(path),
            "rows_written": len(rows),
            "backup": str(bak) if bak else "(already-backed-up; not re-saved)",
        })
        print(f"wrote {len(rows):4d} rows -> {path.name}"
              f"   {'backup=' + bak.name if bak else 'backup already present'}")
    print()
    print(json.dumps({"summary": summary, "seed": SEED, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")},
                     ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
