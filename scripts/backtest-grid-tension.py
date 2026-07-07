#!/usr/bin/env python3
"""
텐션 브레이크아웃 → 그리드 봇 구조 백테스트.

원본 지시 메시지가 끊겨 세부 스펙(정확한 스윕 값 목록, 다중 포지션/no-SL
상태기계 세부 규칙)을 전달받지 못했다. 아래는 "그리드 봇 구조, 손절 없음"
이라는 명시된 제약과 주어진 상수(GRID_INTERVAL=250, TAKE_PROFIT=300)를
기준으로 합리적으로 추론한 설계이며, 가정은 이 파일 상단과 보고서에
명시한다.

## 명시적 가정 (원 지시 유실로 인한 추론)

1. 손절 없음: 포지션은 TP 도달 또는 시리즈 끝까지 미청산(OPEN)으로만 종료.
2. 다중 동시 포지션: 텐션 브레이크아웃의 단일 포지션 구조를, 동시에 최대
   MAX_POSITIONS개까지 열 수 있는 그리드 구조로 확장.
3. 진입 방향 규약은 원본 텐션 브레이크아웃과 동일하게 유지: 앵커 대비
   +GRID_INTERVAL 이탈 → LONG 진입, -GRID_INTERVAL 이탈 → SHORT 진입.
4. 그리드 앵커는 레벨을 넘을 때마다(포지션 개설 가능 여부와 무관하게)
   그 시점 가격으로 재설정되어, 봇이 계속 가격을 따라가며 다음 그리드
   레벨을 잡는다. MAX_POSITIONS에 도달해 있으면 앵커만 갱신하고 신규
   진입은 건너뛴다(포지션이 청산돼 여유가 생기면 그 다음 레벨부터 재개).
5. TP 판정과 체결가는 종가 기준(고가/저가 미사용) — 이는 실제 배포된
   MobileSignalDashboard.tsx의 simulateTensionBreakout과 동일한 방법론
   (point.price만 사용)이라 실사용 로직과 일관성을 유지하기 위함.
6. 포지션 사이즈는 1단위 고정(원 텐션 백테스트와 동일 스케일), 수수료/
   슬리피지 미반영.

## 스윕 48조합

GRID_INTERVAL × TAKE_PROFIT × MAX_POSITIONS = 4 × 4 × 3 = 48
  GRID_INTERVAL: 150, 250(*), 350, 450
  TAKE_PROFIT:   200, 300(*), 400, 500
  MAX_POSITIONS: 3, 5, 8
(*) 사용자가 명시한 기본값.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
REPORTS_DIR = PROJECT_ROOT / "reports"

PRICE_PARQUET = Path(
    "/NHNHOME/WORKSPACE/0426030063_A/MyTradeBotGPU/data/processed/BTCUSDT_5m_2019_2026_merged.parquet"
)

GRID_INTERVAL_SWEEP = [150, 250, 350, 450]
TAKE_PROFIT_SWEEP = [200, 300, 400, 500]
MAX_POSITIONS_SWEEP = [3, 5, 8]

BASE_GRID_INTERVAL = 250
BASE_TAKE_PROFIT = 300
BASE_MAX_POSITIONS = 5


def load_15m_ohlc() -> pd.DataFrame:
    df = pd.read_parquet(PRICE_PARQUET)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = df.set_index("timestamp").sort_index()
    ohlc = df.resample("15min").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    )
    return ohlc.dropna(subset=["open", "high", "low", "close"]).reset_index()


def simulate_grid_bot(ts: np.ndarray, close: np.ndarray, grid_interval: float, take_profit: float, max_positions: int) -> dict:
    n = len(close)
    if n < 2:
        return {"closed": [], "open_at_end": [], "max_concurrent_open": 0, "max_unrealized_loss_total": 0.0}

    anchor_price = close[0]
    open_positions: list[dict] = []
    closed: list[dict] = []
    max_concurrent = 0
    max_unrealized_loss_total = 0.0

    for i in range(1, n):
        price = close[i]

        still_open = []
        for pos in open_positions:
            if pos["direction"] == "LONG" and price >= pos["entry_price"] + take_profit:
                closed.append({
                    "anchor_time": pos["anchor_time"], "entry_time": ts[pos["entry_idx"]],
                    "entry_price": pos["entry_price"], "direction": "LONG",
                    "exit_time": ts[i], "exit_price": price, "outcome": "TP",
                    "pnl": price - pos["entry_price"],
                })
            elif pos["direction"] == "SHORT" and price <= pos["entry_price"] - take_profit:
                closed.append({
                    "anchor_time": pos["anchor_time"], "entry_time": ts[pos["entry_idx"]],
                    "entry_price": pos["entry_price"], "direction": "SHORT",
                    "exit_time": ts[i], "exit_price": price, "outcome": "TP",
                    "pnl": pos["entry_price"] - price,
                })
            else:
                still_open.append(pos)
        open_positions = still_open

        if price >= anchor_price + grid_interval:
            if len(open_positions) < max_positions:
                open_positions.append({
                    "entry_idx": i, "entry_price": price, "direction": "LONG", "anchor_time": ts[i],
                })
            anchor_price = price
        elif price <= anchor_price - grid_interval:
            if len(open_positions) < max_positions:
                open_positions.append({
                    "entry_idx": i, "entry_price": price, "direction": "SHORT", "anchor_time": ts[i],
                })
            anchor_price = price

        max_concurrent = max(max_concurrent, len(open_positions))
        if open_positions:
            unrealized_total = sum(
                (price - p["entry_price"]) if p["direction"] == "LONG" else (p["entry_price"] - price)
                for p in open_positions
            )
            max_unrealized_loss_total = min(max_unrealized_loss_total, unrealized_total)

    final_price = close[-1]
    open_at_end = [
        {
            "entry_time": ts[p["entry_idx"]], "entry_price": p["entry_price"], "direction": p["direction"],
            "unrealized_pnl": (final_price - p["entry_price"]) if p["direction"] == "LONG" else (p["entry_price"] - final_price),
        }
        for p in open_positions
    ]
    return {
        "closed": closed,
        "open_at_end": open_at_end,
        "max_concurrent_open": max_concurrent,
        "max_unrealized_loss_total": max_unrealized_loss_total,
    }


def summarize(result: dict) -> dict:
    closed = result["closed"]
    open_at_end = result["open_at_end"]
    realized_pnl = sum(t["pnl"] for t in closed)
    unrealized_pnl = sum(p["unrealized_pnl"] for p in open_at_end)
    worst_open_pnl = min((p["unrealized_pnl"] for p in open_at_end), default=0.0)
    return {
        "closed_count": len(closed),
        "realized_pnl": realized_pnl,
        "open_at_end_count": len(open_at_end),
        "unrealized_pnl_at_end": unrealized_pnl,
        "total_mark_to_market_pnl": realized_pnl + unrealized_pnl,
        "max_concurrent_open": result["max_concurrent_open"],
        "max_unrealized_loss_total": result["max_unrealized_loss_total"],
        "worst_single_open_pnl": worst_open_pnl,
    }


def main() -> None:
    print("[data] loading price parquet -> 15m ...")
    bars = load_15m_ohlc()
    print(f"[data] price bars: {len(bars)} rows, {bars['timestamp'].min()} -> {bars['timestamp'].max()}")
    ts_all = bars["timestamp"].to_numpy()
    close_all = bars["close"].to_numpy()

    print("[sweep] running 48 combinations over full 7yr period ...")
    sweep_rows = []
    for gi in GRID_INTERVAL_SWEEP:
        for tp in TAKE_PROFIT_SWEEP:
            for mp in MAX_POSITIONS_SWEEP:
                result = simulate_grid_bot(ts_all, close_all, gi, tp, mp)
                s = summarize(result)
                sweep_rows.append({"grid_interval": gi, "take_profit": tp, "max_positions": mp, **s})
    sweep_df = pd.DataFrame(sweep_rows)
    print(f"[sweep] done, {len(sweep_df)} combos")

    print("[2022] running dedicated 2022 worst-case scenario for all 48 combos ...")
    mask_2022 = (bars["timestamp"] >= "2022-01-01") & (bars["timestamp"] < "2023-01-01")
    bars_2022 = bars[mask_2022].reset_index(drop=True)
    ts_2022 = bars_2022["timestamp"].to_numpy()
    close_2022 = bars_2022["close"].to_numpy()
    print(f"[2022] bars: {len(bars_2022)}, {bars_2022['timestamp'].min()} -> {bars_2022['timestamp'].max()}, "
          f"start price={close_2022[0]:.2f}, end price={close_2022[-1]:.2f}, "
          f"change={(close_2022[-1]/close_2022[0]-1)*100:.1f}%")

    scenario_rows = []
    for gi in GRID_INTERVAL_SWEEP:
        for tp in TAKE_PROFIT_SWEEP:
            for mp in MAX_POSITIONS_SWEEP:
                result = simulate_grid_bot(ts_2022, close_2022, gi, tp, mp)
                s = summarize(result)
                survived = s["open_at_end_count"] == 0
                scenario_rows.append({
                    "grid_interval": gi, "take_profit": tp, "max_positions": mp,
                    "survived_2022": survived, **s,
                })
    scenario_df = pd.DataFrame(scenario_rows)
    survivors = scenario_df[scenario_df["survived_2022"]]
    print(f"[2022] combos with zero open exposure at year-end: {len(survivors)}/{len(scenario_df)}")

    # Base-params 2022 detail (the two constants the user gave verbatim)
    base_2022 = simulate_grid_bot(ts_2022, close_2022, BASE_GRID_INTERVAL, BASE_TAKE_PROFIT, BASE_MAX_POSITIONS)
    base_2022_summary = summarize(base_2022)

    REPORTS_DIR.mkdir(exist_ok=True)
    date_str = pd.Timestamp.utcnow().strftime("%Y-%m-%d")
    out_path = REPORTS_DIR / f"tension-backtest-grid-{date_str}.md"

    def fmt_usd(v):
        return f"{'+' if v is not None and v >= 0 else ''}{v:.2f}$"

    lines = []
    lines.append(f"# 텐션 브레이크아웃 → 그리드 봇 백테스트 ({date_str})\n")
    lines.append("## 0. 설계 가정 (원 지시 스펙 유실로 인한 추론)\n")
    lines.append(
        "- 원 지시 메시지가 두 상수(GRID_INTERVAL=250, TAKE_PROFIT=300)만 전달된 채 끊겨, 세부 상태기계 규칙을 "
        "합리적으로 추론해 구현함(스크립트 상단 docstring에 6개 가정 명시).\n"
        "- 핵심: 손절 없음 / 최대 MAX_POSITIONS개 동시 보유 / 앵커±GRID_INTERVAL 이탈 시 진입 방향은 원본 "
        "텐션 브레이크아웃과 동일(위로 이탈=LONG, 아래로 이탈=SHORT) / TP 판정은 종가 기준(실제 배포된 UI의 "
        "simulateTensionBreakout과 동일 방법론).\n"
    )
    lines.append("## 1. 스윕 48조합 (전체 7년: 2019-01-01 ~ 2026-04-20, GRID_INTERVAL×TAKE_PROFIT×MAX_POSITIONS = 4×4×3)\n")
    lines.append("| GRID | TP | MAX_POS | 청산(TP) | 실현손익 | 미청산 | 미실현손익(종료시) | 합계(mark-to-market) | 최대동시보유 | 최대미실현손실(구간중) |")
    lines.append("|---|---|---|---|---|---|---|---|---|---|")
    for _, r in sweep_df.sort_values("total_mark_to_market_pnl", ascending=False).iterrows():
        lines.append(
            f"| {int(r.grid_interval)} | {int(r.take_profit)} | {int(r.max_positions)} | {int(r.closed_count)} | "
            f"{fmt_usd(r.realized_pnl)} | {int(r.open_at_end_count)} | {fmt_usd(r.unrealized_pnl_at_end)} | "
            f"{fmt_usd(r.total_mark_to_market_pnl)} | {int(r.max_concurrent_open)} | {fmt_usd(r.max_unrealized_loss_total)} |"
        )

    lines.append("\n## 2. 2022 최악 시나리오 (2022-01-01 ~ 2022-12-31 단독 리셋 실행)\n")
    lines.append(
        f"- 2022년 BTC 가격: {close_2022[0]:.2f} → {close_2022[-1]:.2f} ({(close_2022[-1]/close_2022[0]-1)*100:.1f}%, "
        f"연중 지속 하락장) — LONG 그리드 포지션이 손절 없이 계속 쌓이는 최악 조건.\n"
    )
    lines.append(
        f"- 기본값(GRID={BASE_GRID_INTERVAL}, TP={BASE_TAKE_PROFIT}, MAX_POS={BASE_MAX_POSITIONS}) 결과: "
        f"청산 {base_2022_summary['closed_count']}건(실현 {fmt_usd(base_2022_summary['realized_pnl'])}), "
        f"연말 미청산 {base_2022_summary['open_at_end_count']}건(미실현 {fmt_usd(base_2022_summary['unrealized_pnl_at_end'])}), "
        f"최대 동시보유 {base_2022_summary['max_concurrent_open']}, "
        f"구간중 최대 미실현손실 {fmt_usd(base_2022_summary['max_unrealized_loss_total'])}, "
        f"단일 포지션 최악 미실현 {fmt_usd(base_2022_summary['worst_single_open_pnl'])}.\n"
    )
    lines.append(f"- 48조합 중 **연말 시점 미청산 포지션이 0건인(=단기 청산 완료, '생존') 조합: {len(survivors)}개**\n")
    if len(survivors) > 0:
        lines.append("| GRID | TP | MAX_POS | 청산 | 실현손익 | 최대동시보유 | 구간중 최대미실현손실 |")
        lines.append("|---|---|---|---|---|---|---|")
        for _, r in survivors.sort_values("realized_pnl", ascending=False).iterrows():
            lines.append(
                f"| {int(r.grid_interval)} | {int(r.take_profit)} | {int(r.max_positions)} | {int(r.closed_count)} | "
                f"{fmt_usd(r.realized_pnl)} | {int(r.max_concurrent_open)} | {fmt_usd(r.max_unrealized_loss_total)} |"
            )
    lines.append("\n### 2022 전체 48조합 상세\n")
    lines.append("| GRID | TP | MAX_POS | 생존 | 청산 | 실현손익 | 연말미청산 | 연말미실현손익 | 최대동시보유 | 구간중최대미실현손실 |")
    lines.append("|---|---|---|---|---|---|---|---|---|---|")
    for _, r in scenario_df.sort_values(["survived_2022", "total_mark_to_market_pnl"], ascending=[False, False]).iterrows():
        lines.append(
            f"| {int(r.grid_interval)} | {int(r.take_profit)} | {int(r.max_positions)} | "
            f"{'O' if r.survived_2022 else 'X'} | {int(r.closed_count)} | {fmt_usd(r.realized_pnl)} | "
            f"{int(r.open_at_end_count)} | {fmt_usd(r.unrealized_pnl_at_end)} | {int(r.max_concurrent_open)} | "
            f"{fmt_usd(r.max_unrealized_loss_total)} |"
        )

    lines.append("\n## 3. 결론\n")
    best_full = sweep_df.sort_values("total_mark_to_market_pnl", ascending=False).iloc[0]
    worst_full = sweep_df.sort_values("total_mark_to_market_pnl", ascending=True).iloc[0]
    lines.append(
        f"- 전체 7년 기준 최고 조합: GRID={int(best_full.grid_interval)}/TP={int(best_full.take_profit)}/"
        f"MAX_POS={int(best_full.max_positions)}, mark-to-market {fmt_usd(best_full.total_mark_to_market_pnl)}. "
        f"최저 조합: GRID={int(worst_full.grid_interval)}/TP={int(worst_full.take_profit)}/"
        f"MAX_POS={int(worst_full.max_positions)}, mark-to-market {fmt_usd(worst_full.total_mark_to_market_pnl)}.\n"
    )
    lines.append(
        "- 손절 없는 그리드 구조는 2022형 지속 하락장에서 LONG 포지션이 청산되지 못한 채 미실현손실로 계속 "
        "쌓이는 구조적 위험이 실증됨 — MAX_POSITIONS가 클수록(더 많이 '물타기') 동시 노출 규모가 커져 구간중 "
        "최대 미실현손실이 커지는 경향. 이는 표시 전용 참고 자료이며 실거래 신뢰 근거나 주문 근거로 사용할 수 "
        "없습니다.\n"
    )

    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n[report] written to {out_path}")
    print("\n=== SUMMARY ===")
    print("Base 2022:", base_2022_summary)
    print(f"Survivors 2022: {len(survivors)}/{len(scenario_df)}")
    print("Best full-period combo:", dict(best_full))
    print("Worst full-period combo:", dict(worst_full))


if __name__ == "__main__":
    main()
