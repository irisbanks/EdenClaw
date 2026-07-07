from __future__ import annotations

from ai_common import ProductCandidate, TradeTask, build_context_block


def build_sell_prompt(task: TradeTask, candidates: list[ProductCandidate]) -> str:
    target = f"${task.target_price:,.2f}" if task.target_price else "not specified"
    return f"""You are evaluating a consumer sell request for Edenclaw.

User request: {task.message}
Owned product: {task.product_name}
Target price: {target}

Comparable marketplace candidates:
{build_context_block(candidates)}

Return JSON only:
{{
  "recommendation": "one concise Korean selling recommendation",
  "platform": "best selling platform",
  "price": 0,
  "confidence": 0,
  "fraud_risk": 0,
  "negotiation_success": 0,
  "expected_profit_rate": 0,
  "details": "include a short Korean listing draft and pricing logic"
}}"""


def summarize_sell(task: TradeTask, candidates: list[ProductCandidate]) -> dict[str, object]:
    high = max(candidates, key=lambda c: c.price_usd) if candidates else None
    return {
        "task_type": "sell",
        "product": task.product_name,
        "target_price": task.target_price,
        "best_comparable_price": high.price_usd if high else None,
        "best_platform": high.platform if high else None,
    }
