from __future__ import annotations

import os
from typing import Any

import httpx

from ai_common import (
    AgentResult,
    ProductCandidate,
    TradeTask,
    heuristic_result,
    now_ms,
    normalize_result_against_task,
    parse_json_object,
    result_from_payload,
)


class BaseAIAgent:
    name = "AI"
    model = "unknown"
    timeout = 30.0

    async def run(self, task: TradeTask, prompt: str, candidates: list[ProductCandidate]) -> AgentResult:
        started = now_ms()
        try:
            raw, cost = await self.call(prompt)
            parsed = parse_json_object(raw)
            if not parsed:
                fallback = heuristic_result(self.name, self.model, task, candidates, "non-json response")
                fallback.raw = raw
                fallback.latency_ms = now_ms() - started
                fallback.cost_usd = cost
                return fallback
            result = result_from_payload(
                agent=self.name,
                model=self.model,
                scenario=task.scenario,
                payload=parsed,
                raw=raw,
                latency_ms=now_ms() - started,
                source="api",
                ok=True,
            )
            result.cost_usd = cost
            normalize_result_against_task(result, task)
            enrich_missing_market_fields(result, task, candidates)
            normalize_result_against_task(result, task)
            return result
        except Exception as exc:
            fallback = heuristic_result(self.name, self.model, task, candidates, str(exc))
            fallback.latency_ms = now_ms() - started
            return fallback

    async def call(self, prompt: str) -> tuple[str, float]:
        raise NotImplementedError


def enrich_missing_market_fields(
    result: AgentResult,
    task: TradeTask,
    candidates: list[ProductCandidate],
) -> None:
    if not candidates:
        return
    if result.price > 0 and result.platform:
        return
    if task.scenario == "arbitrage" and rejects_arbitrage_candidate(result):
        return
    if task.scenario in {"sell", "arbitrage"}:
        chosen = max(
            candidates,
            key=lambda item: float(item.metadata.get("net_profit_usd") or item.price_usd),
        )
    else:
        chosen = min(candidates, key=lambda item: item.price_usd)
    if result.price <= 0:
        result.price = round(chosen.price_usd, 2)
    if not result.platform or result.platform.lower() in {"n/a", "unknown"}:
        result.platform = chosen.platform
    result.details = (
        f"{result.details}\n\n[market data fill] {chosen.name} "
        f"({chosen.platform}, ${chosen.price_usd:,.2f})"
    ).strip()


def rejects_arbitrage_candidate(result: AgentResult) -> bool:
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
    return result.price <= 0 and any(term in text for term in rejection_terms)


def estimate_cost_usd(
    text_in: str,
    text_out: str,
    input_per_million: float,
    output_per_million: float,
) -> float:
    input_tokens = max(1, len(text_in) // 4)
    output_tokens = max(1, len(text_out) // 4)
    return (input_tokens / 1_000_000 * input_per_million) + (
        output_tokens / 1_000_000 * output_per_million
    )


async def post_json(
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str] | None = None,
    timeout: float = 30.0,
) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        return response.json()


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"{name} is not configured")
    return value
