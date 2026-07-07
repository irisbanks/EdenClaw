from __future__ import annotations

from ai_common import ProductCandidate, TradeTask, build_context_block


def build_negotiate_prompt(task: TradeTask, candidates: list[ProductCandidate]) -> str:
    start = f"${task.start_price:,.2f}" if task.start_price else "not specified"
    seller = task.seller_info or "not specified"
    return f"""You are a negotiation specialist for Edenclaw.

User request: {task.message}
Product: {task.product_name}
Seller info: {seller}
Starting price: {start}

Market references:
{build_context_block(candidates)}

Use "price" for the expected final transaction price in USD only.
Do not put percentages, discount rates, years, or placeholders in "price"; use 0 if no defensible price can be estimated.

Return JSON only:
{{
  "recommendation": "one concise Korean negotiation plan",
  "platform": "platform or channel",
  "price": 0,
  "confidence": 0,
  "fraud_risk": 0,
  "negotiation_success": 0,
  "expected_profit_rate": 0,
  "details": "include the exact Korean message to send and expected final price"
}}"""


def summarize_negotiate(task: TradeTask, candidates: list[ProductCandidate]) -> dict[str, object]:
    low = min(candidates, key=lambda c: c.price_usd) if candidates else None
    return {
        "task_type": "negotiate",
        "product": task.product_name,
        "start_price": task.start_price,
        "market_floor": low.price_usd if low else None,
        "seller_info": task.seller_info,
    }
