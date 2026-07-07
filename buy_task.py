from __future__ import annotations

from ai_common import ProductCandidate, TradeTask, build_context_block


def build_buy_prompt(task: TradeTask, candidates: list[ProductCandidate]) -> str:
    budget = f"${task.budget:,.2f}" if task.budget else "not specified"
    preferred = task.preferred_platform or "no preference"
    return f"""You are evaluating a consumer buy request for Edenclaw.

User request: {task.message}
Product: {task.product_name}
Budget: {budget}
Preferred platform: {preferred}

Local marketplace candidates:
{build_context_block(candidates)}

Return JSON only:
{{
  "recommendation": "one concise Korean recommendation",
  "platform": "recommended platform",
  "price": 0,
  "confidence": 0,
  "fraud_risk": 0,
  "negotiation_success": 0,
  "expected_profit_rate": 0,
  "details": "why this is the best buy option and what to verify"
}}"""


def summarize_buy(task: TradeTask, candidates: list[ProductCandidate]) -> dict[str, object]:
    best = min(candidates, key=lambda c: c.price_usd) if candidates else None
    return {
        "task_type": "buy",
        "product": task.product_name,
        "budget": task.budget,
        "best_local_price": best.price_usd if best else None,
        "best_local_platform": best.platform if best else None,
    }
