#!/usr/bin/env python3
# Sanitize commerce SFT datasets for the upcoming commerce-LoRA-v2.
#
# Operator audit notes (2026-05-24):
#   * "원" in the user-given drop list is a SUBSTRING of the REQUIRED canonical
#     field "원가" (cost). Naive substring drop on "원" would delete every cost-
#     bearing row. This script uses a *price-suffix* pattern with negative
#     lookahead so "50000원" is dropped while "원가", "원본", "원화", "원서"
#     are preserved (원화 is handled by its own explicit pattern below).
#   * The canonical schema {cost, scarcity, gas_effect, counter_offer} does NOT
#     appear in any of the 60 source rows; the standardization step will leave
#     all current assistant payloads EMPTY. Rows that become unmappable are
#     dropped. Run --audit first to see the realistic survival count before
#     committing _clean.jsonl files.
#
# I/O
#   reads : edenclaw-ai/finetune/datasets/{product_intake,listing_writer,price_agent}_sft.jsonl
#   writes: edenclaw-ai/finetune/datasets/{...}_clean.jsonl   (only when --apply)

import argparse
import json
import sys
import re
from pathlib import Path

DATASETS_DIR = Path("/NHNHOME/WORKSPACE/0426030063_A/edenclaw/edenclaw-ai/finetune/datasets")
SOURCE_FILES = [
    "product_intake_sft.jsonl",
    "listing_writer_sft.jsonl",
    "price_agent_sft.jsonl",
]

# Rule 1 — consumer/B2C catalog noise. These are the actual hallucination triggers
# the operator flagged (Nike / Airmax / smartwatch class). Audit shows the named
# brands occur 0 times in source; smartwatch occurs 3 times.
CONSUMER_NOISE_PATTERNS = [
    ("Nike",       re.compile(r"\bNike\b|나이키|NIKE", re.IGNORECASE)),
    ("AirMax",     re.compile(r"에어\s*맥스|air\s*max|airmax", re.IGNORECASE)),
    ("smartwatch", re.compile(r"스마트\s*워치|smart\s*watch", re.IGNORECASE)),
]

# Rule 1b — KRW-pricing patterns. Default ON because the v2 target is $-priced B2B.
# Price-suffix pattern preserves "원가"/"원본"/"원화"/"원서" via negative lookahead.
WON_PRICE_PATTERN = re.compile(r"\d[\d,]*\s*원(?![가본화서])")
KRW_FIELD_PATTERN = re.compile(r'"currency"\s*:\s*"KRW"', re.IGNORECASE)
WONHWA_PATTERN    = re.compile(r"원화")

# Rule 2 — canonical assistant-output schema. Anything else in the JSON payload
# is stripped. If a row's assistant payload becomes empty after stripping, the
# row is unmappable and dropped.
CANONICAL_OUTPUT_FIELDS = ("cost", "scarcity", "gas_effect", "counter_offer", "reasoning")


def classify_row(row: dict) -> list[str]:
    flat = json.dumps(row, ensure_ascii=False)
    reasons = []
    for name, pat in CONSUMER_NOISE_PATTERNS:
        if pat.search(flat):
            reasons.append(f"consumer_noise:{name}")
    if WON_PRICE_PATTERN.search(flat):
        reasons.append("won_price_suffix")
    if KRW_FIELD_PATTERN.search(flat):
        reasons.append("krw_currency_field")
    if WONHWA_PATTERN.search(flat):
        reasons.append("wonhwa_token")
    return reasons


def standardize_assistant(content: str):
    """Strip non-canonical fields. Returns (new_content, stripped_keys, became_empty)."""
    try:
        obj = json.loads(content)
    except (json.JSONDecodeError, ValueError):
        return content, [], False
    if not isinstance(obj, dict):
        return content, [], False
    stripped = [k for k in obj.keys() if k not in CANONICAL_OUTPUT_FIELDS]
    if not stripped:
        return content, [], False
    cleaned = {k: obj[k] for k in CANONICAL_OUTPUT_FIELDS if k in obj}
    return (
        json.dumps(cleaned, ensure_ascii=False),
        stripped,
        len(cleaned) == 0,
    )


def process_file(src: Path, apply: bool):
    rows = [json.loads(l) for l in src.read_text(encoding="utf-8").splitlines() if l.strip()]
    stats = {
        "source":               src.name,
        "total":                len(rows),
        "kept":                 0,
        "drop_reason_counts":   {},
        "fields_stripped":      {},
        "dropped_empty_after_standardize": 0,
        "dropped_examples":     [],
    }
    kept = []
    for row in rows:
        reasons = classify_row(row)
        if reasons:
            for r in reasons:
                stats["drop_reason_counts"][r] = stats["drop_reason_counts"].get(r, 0) + 1
            if len(stats["dropped_examples"]) < 2:
                stats["dropped_examples"].append({
                    "reasons": reasons,
                    "preview": json.dumps(row, ensure_ascii=False)[:200],
                })
            continue

        unmappable = False
        for msg in row.get("messages", []):
            if msg.get("role") != "assistant":
                continue
            new_content, stripped, empty = standardize_assistant(msg.get("content", ""))
            for fk in stripped:
                stats["fields_stripped"][fk] = stats["fields_stripped"].get(fk, 0) + 1
            if empty:
                unmappable = True
                break
            msg["content"] = new_content
        if unmappable:
            stats["dropped_empty_after_standardize"] += 1
            continue

        kept.append(row)

    stats["kept"] = len(kept)

    if apply:
        out = src.with_name(src.name.replace("_sft.jsonl", "_clean.jsonl"))
        out.write_text(
            "\n".join(json.dumps(r, ensure_ascii=False) for r in kept) + ("\n" if kept else ""),
            encoding="utf-8",
        )
        stats["output_file"] = str(out)

    return stats


def main():
    ap = argparse.ArgumentParser(description="Sanitize commerce SFT datasets for LoRA v2.")
    ap.add_argument("--apply", action="store_true",
                    help="Write _clean.jsonl files. Without it, audit-only (no writes).")
    args = ap.parse_args()
    print(f"# sanitize_commerce_dataset.py — mode={'APPLY' if args.apply else 'AUDIT'}")
    grand_total = 0
    grand_kept = 0
    for fn in SOURCE_FILES:
        st = process_file(DATASETS_DIR / fn, apply=args.apply)
        grand_total += st["total"]
        grand_kept  += st["kept"]
        print(json.dumps(st, ensure_ascii=False, indent=2))
    pct = (grand_kept / grand_total * 100) if grand_total else 0.0
    print(f"\n# rollup: kept {grand_kept}/{grand_total} rows ({pct:.1f}%)")
    if grand_kept < 10:
        print("# WARNING: under 10 rows survive sanitization — insufficient for a 27B SFT.")
        print("# Recommendation: regenerate B2B-hardware-parts SFT data before launching v2.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
