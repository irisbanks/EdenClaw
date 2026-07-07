from __future__ import annotations

from ai_common import ProductCandidate, TradeTask, build_context_block


def build_arbitrage_prompt(task: TradeTask, candidates: list[ProductCandidate]) -> str:
    budget = f"${task.budget:,.2f}" if task.budget else "not specified"
    category = task.category or task.product_name or "not specified"
    return f"""You are evaluating an arbitrage request for Edenclaw.

User request: {task.message}
Category: {category}
Budget: {budget}

Arbitrage candidates from the local engine:
{build_context_block(candidates)}

Use "price" for the actual buy price only. Do not put net profit in "price".
If every candidate exceeds the budget or no candidate is listed, return price 0 and explain that no safe opportunity is available.

Return JSON only:
{{
  "recommendation": "one concise Korean arbitrage recommendation",
  "platform": "buy platform -> sell platform",
  "price": 0,
  "confidence": 0,
  "fraud_risk": 0,
  "negotiation_success": 0,
  "expected_profit_rate": 0,
  "details": "explain expected profit, risk, and verification steps"
}}"""


def summarize_arbitrage(task: TradeTask, candidates: list[ProductCandidate]) -> dict[str, object]:
    best = max(candidates, key=lambda c: float(c.metadata.get("net_profit_usd") or 0.0)) if candidates else None
    return {
        "task_type": "arbitrage",
        "category": task.category or task.product_name,
        "budget": task.budget,
        "best_buy_price_usd": best.price_usd if best else None,
        "best_required_capital_usd": best.metadata.get("required_capital_usd") if best else None,
        "best_profit_usd": best.metadata.get("net_profit_usd") if best else None,
        "best_roi_percent": best.metadata.get("margin_percent") if best else None,
        "best_route": best.platform if best else None,
    }
