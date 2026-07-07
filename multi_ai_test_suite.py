from __future__ import annotations

import asyncio
import html
import json
from datetime import datetime
from pathlib import Path
from typing import Any

from ai_router import AIRouter
from ai_common import REPORT_DIR


TEST_CASES = [
    {"name": "고가 상품", "scenario": "buy", "message": "iPhone 15 Pro Max 256GB 사고 싶어"},
    {"name": "저가 상품", "scenario": "buy", "message": "USB 케이블 1m 가성비 좋은거"},
    {"name": "협상", "scenario": "negotiate", "message": "MacBook Pro 16인치 중고 협상해줘"},
    {"name": "매도", "scenario": "sell", "message": "내가 가진 iPad Pro 팔고 싶어"},
    {"name": "차익거래", "scenario": "arbitrage", "message": "100달러 예산으로 차익거래 가능한 상품 찾아줘", "budget": 100},
]

COST_RATES = {
    "GPT-5.5": {"input": 5.00, "output": 30.00, "note": "OpenAI gpt-5.5 standard"},
    "GPT-4o": {"input": 2.50, "output": 10.00, "note": "OpenAI fallback"},
    "Claude": {"input": 5.00, "output": 25.00, "note": "Claude Opus 4.7/4.5 family"},
    "Gemini": {"input": 1.25, "output": 10.00, "note": "Gemini 2.5 Pro <=200K prompt"},
    "Edenclaw AI": {"input": 0.00, "output": 0.00, "note": "self-hosted vLLM; excludes electricity"},
}

ASSUMED_INPUT_TOKENS = 1500
ASSUMED_OUTPUT_TOKENS = 500


async def run_suite() -> dict[str, Any]:
    router = AIRouter()
    outputs: list[dict[str, Any]] = []
    for case in TEST_CASES:
        result = await router.compare(case)
        outputs.append({"case": case, "result": result})
    dashboard_path = write_dashboard(outputs)
    payload = {
        "generated_at": datetime.now().isoformat(),
        "dashboard_path": dashboard_path,
        "cases": outputs,
        "cost_analysis": cost_analysis(),
    }
    json_path = Path(dashboard_path).with_suffix(".json")
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def cost_analysis() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for agent, rate in COST_RATES.items():
        per_request = (
            ASSUMED_INPUT_TOKENS / 1_000_000 * rate["input"]
            + ASSUMED_OUTPUT_TOKENS / 1_000_000 * rate["output"]
        )
        rows.append(
            {
                "agent": agent,
                "input_per_1m": rate["input"],
                "output_per_1m": rate["output"],
                "assumed_input_tokens": ASSUMED_INPUT_TOKENS,
                "assumed_output_tokens": ASSUMED_OUTPUT_TOKENS,
                "estimated_per_request": round(per_request, 6),
                "estimated_monthly_1000": round(per_request * 1000, 4),
                "note": rate["note"],
            }
        )
    return rows


def write_dashboard(outputs: list[dict[str, Any]]) -> str:
    REPORT_DIR.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = REPORT_DIR / f"multi_ai_dashboard_{stamp}.html"
    case_sections = "\n".join(render_case(item) for item in outputs)
    cost_rows = "\n".join(render_cost_row(row) for row in cost_analysis())
    strengths = analyze_strengths(outputs)
    strength_rows = "\n".join(
        f"<tr><td>{html.escape(agent)}</td><td>{wins}</td><td>{avg:.2f}</td><td>{html.escape(note)}</td></tr>"
        for agent, wins, avg, note in strengths
    )
    doc = f"""<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Edenclaw Multi AI Dashboard</title>
  <style>
    body {{ margin:0; background:#081018; color:#e7eef7; font-family:Arial,sans-serif; }}
    main {{ max-width:1220px; margin:0 auto; padding:32px 20px 60px; }}
    h1 {{ margin:0 0 8px; font-size:28px; }}
    h2 {{ margin:30px 0 12px; font-size:20px; }}
    .muted {{ color:#8fa2b8; }}
    .case {{ border:1px solid #233348; background:#101a26; border-radius:8px; margin-top:16px; overflow:hidden; }}
    .caseHead {{ padding:14px 16px; border-bottom:1px solid #233348; display:flex; justify-content:space-between; gap:16px; }}
    table {{ width:100%; border-collapse:collapse; }}
    th, td {{ padding:10px 12px; border-bottom:1px solid #1f2e42; text-align:left; vertical-align:top; }}
    th {{ color:#9fb0c4; font-size:12px; text-transform:uppercase; }}
    .barTrack {{ width:150px; height:9px; background:#172235; border-radius:999px; overflow:hidden; display:inline-block; vertical-align:middle; }}
    .bar {{ height:100%; background:#60a5fa; }}
    .winner {{ color:#86efac; font-weight:800; }}
    .err {{ color:#fca5a5; font-size:12px; }}
    .grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:14px; margin-top:16px; }}
    .card {{ border:1px solid #233348; background:#101a26; border-radius:8px; padding:14px; }}
  </style>
</head>
<body><main>
  <h1>Edenclaw Multi AI 비교 대시보드</h1>
  <div class="muted">5개 시나리오 실제 실행 결과 · 그래프는 종합 점수 기준</div>
  {case_sections}
  <h2>AI별 강점/약점</h2>
  <table><thead><tr><th>AI</th><th>우승 횟수</th><th>평균 점수</th><th>분석</th></tr></thead><tbody>{strength_rows}</tbody></table>
  <h2>비용 분석</h2>
  <div class="muted">월 1,000건 가정: 요청당 입력 {ASSUMED_INPUT_TOKENS:,} tokens + 출력 {ASSUMED_OUTPUT_TOKENS:,} tokens</div>
  <table><thead><tr><th>AI</th><th>Input / 1M</th><th>Output / 1M</th><th>건당 예상</th><th>월 1,000건</th><th>비고</th></tr></thead><tbody>{cost_rows}</tbody></table>
</main></body></html>"""
    path.write_text(doc, encoding="utf-8")
    return str(path)


def render_case(item: dict[str, Any]) -> str:
    case = item["case"]
    result = item["result"]
    rows = "\n".join(render_result_row(row, result["comparison"]["winner"]) for row in result["comparison"]["results"])
    return f"""<section class="case">
  <div class="caseHead">
    <div><strong>{html.escape(case['name'])}</strong> <span class="muted">({html.escape(case['scenario'])})</span><br><span class="muted">{html.escape(case['message'])}</span></div>
    <div class="winner">Winner: {html.escape(result['comparison']['winner'])}</div>
  </div>
  <table>
    <thead><tr><th>AI</th><th>응답 시간</th><th>가격</th><th>플랫폼</th><th>비용</th><th>종합 점수</th><th>상태</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
</section>"""


def render_result_row(row: dict[str, Any], winner: str) -> str:
    total = float(row.get("metrics", {}).get("total") or 0)
    status = row.get("source", "")
    if row.get("error"):
        status += f"<br><span class='err'>{html.escape(str(row['error'])[:140])}</span>"
    name = html.escape(row.get("agent", ""))
    if row.get("agent") == winner:
        name += " <span class='winner'>WIN</span>"
    return f"""<tr>
  <td>{name}<br><span class="muted">{html.escape(row.get('model', ''))}</span></td>
  <td>{float(row.get('latency_ms') or 0):,.0f}ms</td>
  <td>{format_price(row.get('price'))}</td>
  <td>{html.escape(row.get('platform') or '')}</td>
  <td>${float(row.get('cost_usd') or 0):.5f}</td>
  <td><span class="barTrack"><span class="bar" style="width:{max(0, min(100, total))}%"></span></span> {total:.2f}</td>
  <td>{status}</td>
</tr>"""


def format_price(value: Any) -> str:
    price = float(value or 0.0)
    if price <= 0:
        return "N/A"
    return f"${price:,.2f}"


def render_cost_row(row: dict[str, Any]) -> str:
    return f"""<tr>
  <td>{html.escape(row['agent'])}</td>
  <td>${row['input_per_1m']:.2f}</td>
  <td>${row['output_per_1m']:.2f}</td>
  <td>${row['estimated_per_request']:.5f}</td>
  <td>${row['estimated_monthly_1000']:.2f}</td>
  <td>{html.escape(row['note'])}</td>
</tr>"""


def analyze_strengths(outputs: list[dict[str, Any]]) -> list[tuple[str, int, float, str]]:
    by_agent: dict[str, list[float]] = {}
    wins: dict[str, int] = {}
    for item in outputs:
        winner = item["result"]["comparison"]["winner"]
        wins[winner] = wins.get(winner, 0) + 1
        for row in item["result"]["comparison"]["results"]:
            by_agent.setdefault(row["agent"], []).append(float(row["metrics"].get("total") or 0))
    notes = {
        "GPT-5.5": "범용 추론과 가격 비교 설명에 강함. 키/모델 접근권이 없으면 fallback 처리.",
        "Gemini": "빠른 응답과 저렴한 단가가 장점. 무료/쿼터 제한 시 429가 날 수 있음.",
        "Claude": "협상 문구와 리스크 설명에 적합. ANTHROPIC_API_KEY 설정 필요.",
        "Edenclaw AI": "로컬 DB와 vLLM에 가장 잘 붙어 실거래 후보 검색에 강함. 외부 API 비용 없음.",
    }
    rows = []
    for agent, scores in by_agent.items():
        rows.append((agent, wins.get(agent, 0), sum(scores) / max(1, len(scores)), notes.get(agent, "")))
    return sorted(rows, key=lambda row: (row[1], row[2]), reverse=True)


def main() -> int:
    payload = asyncio.run(run_suite())
    print(json.dumps(
        {
            "dashboard_path": payload["dashboard_path"],
            "cost_analysis": payload["cost_analysis"],
            "winners": [
                {
                    "case": item["case"]["name"],
                    "winner": item["result"]["comparison"]["winner"],
                }
                for item in payload["cases"]
            ],
        },
        ensure_ascii=False,
        indent=2,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
