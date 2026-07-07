from __future__ import annotations

import html
from datetime import datetime
from pathlib import Path
from typing import Any

from ai_common import AgentResult, REPORT_DIR, TradeTask


WEIGHTS = {
    "market_price_accuracy": 0.30,
    "recommendation_accuracy": 0.22,
    "reasoning_quality": 0.18,
    "fraud_avoidance": 0.12,
    "trade_profit": 0.08,
    "negotiation_success": 0.04,
    "response_speed": 0.03,
    "cost_efficiency": 0.03,
}


def score_results(task: TradeTask, results: list[AgentResult]) -> dict[str, Any]:
    if not results:
        return {"winner": None, "results": [], "summary": {}}

    valid_prices = [r.price for r in results if r.price > 0]
    min_price = min(valid_prices) if valid_prices else 0.0
    max_price = max(valid_prices) if valid_prices else 0.0
    market_reference = median(valid_prices)
    fastest = min(max(r.latency_ms, 1.0) for r in results)
    has_live_api = any(r.source == "api" and r.ok for r in results)
    min_cost = min(max(r.cost_usd, 0.0) for r in results)

    scored: list[dict[str, Any]] = []
    for result in results:
        metrics = calculate_metrics(task, result, min_price, max_price, market_reference, fastest, min_cost)
        total = sum(metrics[key] * WEIGHTS[key] for key in WEIGHTS)
        if has_live_api and result.source != "api":
            total -= 35.0
        result.metrics = {**metrics, "total": round(total, 2)}
        scored.append(result.to_dict())

    scored.sort(key=lambda item: item["metrics"]["total"], reverse=True)
    no_viable_arbitrage = task.scenario == "arbitrage" and not valid_prices
    winner = scored[0]
    return {
        "winner": "No viable opportunity" if no_viable_arbitrage else winner["agent"],
        "winner_result": None if no_viable_arbitrage else winner,
        "results": scored,
        "summary": {
            "min_price": min_price,
            "max_price": max_price,
            "market_reference": market_reference,
            "fastest_ms": fastest,
            "weights": WEIGHTS,
        },
    }


def calculate_metrics(
    task: TradeTask,
    result: AgentResult,
    min_price: float,
    max_price: float,
    market_reference: float,
    fastest_ms: float,
    min_cost: float,
) -> dict[str, float]:
    price_score = market_price_score(task, result, min_price, max_price, market_reference)

    speed_score = min(100.0, fastest_ms / max(result.latency_ms, 1.0) * 100.0)
    if result.source != "api":
        speed_score = min(speed_score, 60.0)
    profit_score = max(0.0, min(100.0, result.expected_profit_rate * 2.0))
    if task.scenario == "buy" and result.price > 0 and task.budget:
        profit_score = max(0.0, min(100.0, (task.budget - result.price) / task.budget * 100.0))
    source_penalty = 25.0 if result.source != "api" else 0.0
    error_penalty = 10.0 if not result.ok else 0.0
    accuracy = max(0.0, min(100.0, result.confidence - source_penalty - error_penalty))
    fraud_avoidance = max(0.0, min(100.0, 100.0 - result.fraud_risk))
    reasoning = reasoning_quality_score(task, result)
    cost_score = cost_efficiency_score(result, min_cost)

    return {
        "market_price_accuracy": round(price_score, 2),
        "lowest_price": round(price_score, 2),
        "response_speed": round(speed_score, 2),
        "negotiation_success": round(result.negotiation_success, 2),
        "trade_profit": round(profit_score, 2),
        "recommendation_accuracy": round(accuracy, 2),
        "fraud_avoidance": round(fraud_avoidance, 2),
        "reasoning_quality": round(reasoning, 2),
        "cost_efficiency": round(cost_score, 2),
    }


def median(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def market_price_score(
    task: TradeTask,
    result: AgentResult,
    min_price: float,
    max_price: float,
    market_reference: float,
) -> float:
    if result.price <= 0:
        return 0.0
    if task.scenario == "buy":
        if task.budget and result.price > task.budget:
            return 0.0
        return 100.0 if min_price <= 0 else min(100.0, min_price / result.price * 100.0)
    if task.scenario == "sell":
        return 100.0 if max_price <= 0 else min(100.0, result.price / max_price * 100.0)
    if task.scenario == "arbitrage":
        if task.budget and result.price > task.budget:
            return 0.0
        return 100.0
    if market_reference <= 0:
        return 0.0
    delta = abs(result.price - market_reference) / market_reference
    return max(0.0, min(100.0, 100.0 - delta * 100.0))


def reasoning_quality_score(task: TradeTask, result: AgentResult) -> float:
    text = f"{result.recommendation}\n{result.details}".strip()
    if not text:
        return 0.0
    score = 35.0
    if len(text) >= 80:
        score += 20.0
    if len(text) >= 180:
        score += 10.0
    if result.platform and result.platform.lower() not in {"n/a", "unknown", "해당없음"}:
        score += 10.0
    if result.confidence >= 60:
        score += 10.0
    if result.fraud_risk <= 40:
        score += 10.0
    if task.scenario in {"buy", "sell", "arbitrage"} and result.price <= 0:
        score -= 35.0
    if task.scenario == "arbitrage" and task.budget and result.price > task.budget:
        score -= 45.0
    if "market data fill" in text.lower():
        score -= 15.0
    return max(0.0, min(100.0, score))


def cost_efficiency_score(result: AgentResult, min_cost: float) -> float:
    cost = max(result.cost_usd, 0.0)
    if cost <= 0:
        return 100.0
    baseline = max(min_cost, 0.000001)
    return max(0.0, min(100.0, baseline / cost * 100.0))


def console_table(comparison: dict[str, Any]) -> str:
    rows = comparison.get("results", [])
    if not rows:
        return "No AI results."
    lines = [
        "4개 AI 비교 결과",
        f"우승: {comparison.get('winner')}",
        "",
        f"{'AI':<14} {'가격':>12} {'플랫폼':<18} {'신뢰도':>8} {'속도(ms)':>10} {'종합':>8}",
        "-" * 78,
    ]
    for row in rows:
        metrics = row.get("metrics", {})
        lines.append(
            f"{row['agent']:<14} {format_price(row.get('price')):>12} "
            f"{row['platform'][:18]:<18} {row['confidence']:>7.1f}% "
            f"{row['latency_ms']:>10.0f} {metrics.get('total', 0):>8.2f}"
        )
    return "\n".join(lines)


def write_html_report(task: TradeTask, comparison: dict[str, Any]) -> str:
    REPORT_DIR.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = REPORT_DIR / f"multi_ai_comparison_{stamp}.html"
    rows = comparison.get("results", [])
    body_rows = "\n".join(render_row(row) for row in rows)
    winner = html.escape(str(comparison.get("winner") or "none"))
    html_text = f"""<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Edenclaw Multi AI Comparison</title>
  <style>
    body {{ margin: 0; font-family: Arial, sans-serif; background: #0b0f14; color: #e8edf2; }}
    main {{ max-width: 1180px; margin: 0 auto; padding: 32px 20px; }}
    h1 {{ font-size: 26px; margin: 0 0 8px; }}
    .meta {{ color: #91a0b3; margin-bottom: 22px; }}
    .winner {{ display: inline-block; background: #143d2a; color: #8ff0b2; border: 1px solid #2f8056; padding: 8px 12px; border-radius: 8px; margin-bottom: 22px; }}
    table {{ width: 100%; border-collapse: collapse; background: #101722; border: 1px solid #223044; }}
    th, td {{ border-bottom: 1px solid #223044; padding: 12px; text-align: left; vertical-align: top; }}
    th {{ color: #aab8c8; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }}
    .score {{ font-weight: 700; color: #8fb7ff; }}
    .details {{ color: #b8c4d4; max-width: 420px; }}
  </style>
</head>
<body>
  <main>
    <h1>Edenclaw Multi AI Comparison</h1>
    <div class="meta">{html.escape(task.scenario)} · {html.escape(task.message)}</div>
    <div class="winner">Winner: {winner}</div>
    <table>
      <thead><tr><th>AI</th><th>Price</th><th>Platform</th><th>Confidence</th><th>Risk</th><th>Total</th><th>Details</th></tr></thead>
      <tbody>{body_rows}</tbody>
    </table>
  </main>
</body>
</html>"""
    path.write_text(html_text, encoding="utf-8")
    return str(path)


def render_row(row: dict[str, Any]) -> str:
    metrics = row.get("metrics", {})
    return f"""<tr>
  <td>{html.escape(str(row.get('agent', '')))}<br><small>{html.escape(str(row.get('model', '')))}</small></td>
  <td>{html.escape(format_price(row.get('price')))}</td>
  <td>{html.escape(str(row.get('platform', '')))}</td>
  <td>{float(row.get('confidence') or 0):.1f}%</td>
  <td>{float(row.get('fraud_risk') or 0):.1f}%</td>
  <td class="score">{float(metrics.get('total') or 0):.2f}</td>
  <td class="details">{html.escape(str(row.get('recommendation', '')))}<br>{html.escape(str(row.get('details', ''))[:500])}</td>
</tr>"""


def format_price(value: Any) -> str:
    price = float(value or 0.0)
    if price <= 0:
        return "N/A"
    return f"${price:,.2f}"
