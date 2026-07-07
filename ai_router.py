from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
from dataclasses import asdict
from typing import Any

import httpx

from ai_common import (
    AgentResult,
    ProductCandidate,
    TradeTask,
    load_env,
    parse_user_task,
    result_from_payload,
    task_context,
)
from arbitrage_task import build_arbitrage_prompt, summarize_arbitrage
from buy_task import build_buy_prompt, summarize_buy
from claude_agent import ClaudeAgent
from comparison import console_table, score_results, write_html_report
from edenclaw_agent import EdenclawAgent
from gemini_agent import GeminiAgent
from gpt_agent import GPTAgent
from learning import agent_strengths, learning_bias_for, record_run
from negotiate_task import build_negotiate_prompt, summarize_negotiate
from sell_task import build_sell_prompt, summarize_sell


os.environ.setdefault("CUDA_VISIBLE_DEVICES", os.getenv("MULTI_AI_CUDA_VISIBLE_DEVICES", "2,3"))


class AIRouter:
    def __init__(self) -> None:
        load_env()
        self.agents = [GPTAgent(), GeminiAgent(), ClaudeAgent(), EdenclawAgent()]

    async def compare(self, payload: dict[str, Any]) -> dict[str, Any]:
        task = parse_user_task(payload)
        candidates = task_context(task, limit=10)
        price_hint = await expert_price_hint(task)
        prompt = build_prompt(task, candidates)
        summaries = summarize_task(task, candidates)

        results = await asyncio.gather(
            *(agent.run(task, prompt, candidates) for agent in self.agents),
            return_exceptions=True,
        )
        normalized = [
            result if isinstance(result, AgentResult) else exception_result(str(result), task)
            for result in results
        ]
        apply_expert_price_hint(task, normalized, price_hint)

        comparison = score_results(task, normalized)
        if os.getenv("MULTI_AI_ENABLE_LEARNING_BIAS", "0") == "1":
            apply_learning_bias(task, comparison)
        report_path = write_html_report(task, comparison)
        run_id = record_run(task, normalized, comparison, report_path)

        return {
            "ok": True,
            "run_id": run_id,
            "task": task.to_dict(),
            "candidate_count": len(candidates),
            "candidates": [asdict(candidate) for candidate in candidates],
            "task_summary": summaries,
            "expert_price_hint": price_hint,
            "comparison": comparison,
            "report_path": report_path,
            "learning": agent_strengths(),
            "learning_bias_enabled": os.getenv("MULTI_AI_ENABLE_LEARNING_BIAS", "0") == "1",
        }


def build_prompt(task: TradeTask, candidates: list[ProductCandidate]) -> str:
    if task.scenario == "sell":
        return build_sell_prompt(task, candidates)
    if task.scenario == "negotiate":
        return build_negotiate_prompt(task, candidates)
    if task.scenario == "arbitrage":
        return build_arbitrage_prompt(task, candidates)
    return build_buy_prompt(task, candidates)


def summarize_task(task: TradeTask, candidates: list[ProductCandidate]) -> dict[str, object]:
    if task.scenario == "sell":
        return summarize_sell(task, candidates)
    if task.scenario == "negotiate":
        return summarize_negotiate(task, candidates)
    if task.scenario == "arbitrage":
        return summarize_arbitrage(task, candidates)
    return summarize_buy(task, candidates)


def exception_result(error: str, task: TradeTask) -> AgentResult:
    return AgentResult(
        agent="unknown",
        model="unknown",
        scenario=task.scenario,
        recommendation="실행 중 예외가 발생했습니다.",
        platform="",
        price=0.0,
        confidence=0.0,
        fraud_risk=100.0,
        negotiation_success=0.0,
        expected_profit_rate=0.0,
        details=error,
        latency_ms=0.0,
        ok=False,
        error=error,
        source="exception",
    )


async def expert_price_hint(task: TradeTask) -> dict[str, Any] | None:
    if task.scenario != "negotiate":
        return None
    raw_user_price = task.metadata.get("userPrice") or task.metadata.get("user_price")
    if not raw_user_price and not task.start_price:
        return None
    user_price = raw_user_price or task.start_price
    if task.start_price and task.start_price < 10000 and not raw_user_price:
        user_price = round(task.start_price * 1474.07)
    payload = {
        "intent": "negotiate",
        "userPrice": user_price,
        "itemDescription": task.product_name or task.message,
    }
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            response = await client.post("http://localhost:3000/api/expert/respond", json=payload)
            response.raise_for_status()
            data = response.json()
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    parsed = result_from_payload(
        agent="ExpertTrader",
        model="expert-api",
        scenario="negotiate",
        payload=data,
        raw="",
        latency_ms=0.0,
        source="api",
        ok=True,
    )
    if parsed.price <= 0:
        return {"ok": False, "error": "expert response had no price"}
    return {
        "ok": True,
        "price_usd": round(parsed.price, 2),
        "platform": parsed.platform,
        "source": "ExpertTrader",
    }


def apply_expert_price_hint(
    task: TradeTask,
    results: list[AgentResult],
    price_hint: dict[str, Any] | None,
) -> None:
    if task.scenario != "negotiate" or not price_hint or not price_hint.get("ok"):
        return
    price = float(price_hint.get("price_usd") or 0.0)
    if price <= 0:
        return
    for result in results:
        if result.price > 0:
            continue
        result.price = price
        result.details = (
            f"{result.details}\n\n[expert price hint] Filled missing negotiate price "
            f"from ExpertTrader market analysis: ${price:,.2f}."
        ).strip()


def apply_learning_bias(task: TradeTask, comparison: dict[str, Any]) -> None:
    if comparison.get("winner_result") is None:
        return
    bias = learning_bias_for(task.scenario)
    if not bias:
        return
    for row in comparison.get("results", []):
        metrics = row.setdefault("metrics", {})
        base = float(metrics.get("total") or 0.0)
        metrics["learning_bias"] = round(bias.get(row.get("agent"), 0.0), 2)
        metrics["total"] = round(base + metrics["learning_bias"], 2)
    comparison["results"].sort(key=lambda item: item["metrics"]["total"], reverse=True)
    comparison["winner"] = comparison["results"][0]["agent"]
    comparison["winner_result"] = comparison["results"][0]


def ensure_server_dependencies() -> None:
    missing = []
    for module, package in (("fastapi", "fastapi"), ("uvicorn", "uvicorn")):
        try:
            __import__(module)
        except ImportError:
            missing.append(package)
    if missing:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", *missing])


def create_app() -> Any:
    ensure_server_dependencies()
    from fastapi import Body, FastAPI
    from fastapi.middleware.cors import CORSMiddleware

    app = FastAPI(title="Edenclaw Multi AI Trade Compare", version="1.0.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    router = AIRouter()

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {
            "ok": True,
            "agents": [agent.name for agent in router.agents],
            "cuda_visible_devices": os.getenv("CUDA_VISIBLE_DEVICES"),
        }

    @app.post("/compare")
    async def compare(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return await router.compare(payload)

    @app.get("/learning")
    async def learning() -> dict[str, Any]:
        return {"strengths": agent_strengths()}

    return app


app = create_app()


async def run_cli(args: argparse.Namespace) -> int:
    router = AIRouter()
    payload: dict[str, Any] = {"message": args.message, "scenario": args.scenario}
    if args.product:
        payload["product_name"] = args.product
    if args.budget:
        payload["budget"] = args.budget
    if args.user_price:
        payload["userPrice"] = args.user_price
    if args.start_price:
        payload["start_price"] = args.start_price
    if args.category:
        payload["category"] = args.category
    result = await router.compare(payload)
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(console_table(result["comparison"]))
        print(f"\nHTML report: {result['report_path']}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Edenclaw multi AI trade comparison router")
    parser.add_argument("--serve", action="store_true", help="run FastAPI with uvicorn")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.getenv("MULTI_AI_PORT", "8091")))
    parser.add_argument("--message", default="iPhone 15 Pro 사고 싶어, 예산 1500달러")
    parser.add_argument("--scenario", default="")
    parser.add_argument("--product", default="")
    parser.add_argument("--budget", type=float, default=0.0)
    parser.add_argument("--user-price", type=float, default=0.0)
    parser.add_argument("--start-price", type=float, default=0.0)
    parser.add_argument("--category", default="")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    if args.serve:
        ensure_server_dependencies()
        import uvicorn

        uvicorn.run("ai_router:app", host=args.host, port=args.port, reload=False)
        return 0
    return asyncio.run(run_cli(args))


if __name__ == "__main__":
    raise SystemExit(main())
