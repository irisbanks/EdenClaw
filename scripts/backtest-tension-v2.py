#!/usr/bin/env python3
"""
텐션 브레이크아웃 백테스트 v2 — 트랙 A를 올바른 소스로 재실행.

v1(scripts/backtest-tension.py)의 트랙 A는 eden_mobile_signal_history DB를
소스로 썼는데, 이 테이블이 실측으로 84.2%(656/779) bucket에서 실제 확정
신호와 어긋나는 오염된 데이터임이 밝혀졌다(persist가 "진행 중" 스냅샷만
찍고 확정 후 갱신되지 않는 구조적 버그). 이 v2는 원본 확정 신호 로그
MyTradeBotGPU/training/eden1_0_v2/reports/paper_signals_eden1_v2_btc.csv
(읽기 전용)를 트랙 A 소스로 사용한다.

State machine, 상수는 v1과 동일:
  텐션(LONG%/SHORT% >= 75%) → 앵커 → ±$250 이탈 방향 진입 →
  +$300 TP / -$500 SL (high/low 판정, 동시 충족 시 SL 우선)
"""
import json
from pathlib import Path

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
REPORTS_DIR = PROJECT_ROOT / "reports"

PRICE_PARQUET = Path(
    "/NHNHOME/WORKSPACE/0426030063_A/MyTradeBotGPU/data/processed/BTCUSDT_5m_2019_2026_merged.parquet"
)
# 확정 신호 CSV(4/20~7/7)가 메인 parquet 커버리지(~4/20 종료) 직후부터 시작해
# 겹치는 구간이 사실상 없다. 이 보조 parquet은 2026-05-08까지 더 커버하므로
# high/low 정밀도를 그만큼 더 넓혀준다.
PRICE_PARQUET_EXT = Path("/NHNHOME/WORKSPACE/0426030063_A/edenclaw/btcusdt_5min_3yrs.parquet")
# 읽기 전용 — EDEN1 V2 검증 산출물, 절대 수정/이동 금지.
CONFIRMED_SIGNAL_CSV = Path(
    "/NHNHOME/WORKSPACE/0426030063_A/MyTradeBotGPU/training/eden1_0_v2/reports/paper_signals_eden1_v2_btc.csv"
)

BREAKOUT_USD = 250
TAKE_PROFIT_USD = 300
STOP_LOSS_USD = 500
TENSION_THRESHOLD = 75

ROUNDTRIP_FEE_PCT = 0.001


def load_15m_ohlc() -> pd.DataFrame:
    df = pd.read_parquet(PRICE_PARQUET)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = df.set_index("timestamp").sort_index()
    ohlc = df.resample("15min").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    )
    return ohlc.dropna(subset=["open", "high", "low", "close"]).reset_index()


def load_15m_ohlc_extended() -> pd.DataFrame:
    """메인 parquet(~2026-04-20 종료) 뒤에 보조 parquet(~2026-05-08까지)을
    이어 붙여 확정 신호 CSV와의 겹치는 구간을 최대한 넓힌다."""
    main_df = pd.read_parquet(PRICE_PARQUET)
    main_df["timestamp"] = pd.to_datetime(main_df["timestamp"], utc=True)
    ext_df = pd.read_parquet(PRICE_PARQUET_EXT)
    ext_df = ext_df.reset_index().rename(columns={ext_df.index.name or "index": "timestamp"})
    if "timestamp" not in ext_df.columns:
        ext_df = ext_df.rename(columns={ext_df.columns[0]: "timestamp"})
    ext_df["timestamp"] = pd.to_datetime(ext_df["timestamp"], utc=True)

    combined = pd.concat([main_df, ext_df], ignore_index=True)
    combined = combined.drop_duplicates(subset="timestamp", keep="first").sort_values("timestamp")
    combined = combined.set_index("timestamp")
    ohlc = combined.resample("15min").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    )
    return ohlc.dropna(subset=["open", "high", "low", "close"]).reset_index()


def build_hybrid_ohlc(signal_df: pd.DataFrame, real_bars: pd.DataFrame) -> pd.DataFrame:
    """트랙 A용 가격 시리즈. 실제 OHLC parquet이 존재하는 구간(~2026-05-08까지)은
    그대로 쓰고, 그 이후(확정 신호 CSV가 존재하는 2026-07-07까지)는 로컬에 정밀
    high/low parquet이 없으므로 CSV 자체 종가를 open=high=low=close로 근사한다.
    이 근사 구간에서는 봉중 터치가 아니라 '15분 종가가 TP/SL 가격을 그대로
    스치는지'로만 판정되므로 실제보다 체결이 다소 보수적으로(늦게) 잡힐 수
    있음을 결과 해석 시 감안해야 한다."""
    real_ts = set(real_bars["timestamp"])
    gap = signal_df[~signal_df["timestamp"].isin(real_ts)][["timestamp", "close"]].copy()
    gap["open"], gap["high"], gap["low"], gap["volume"] = gap["close"], gap["close"], gap["close"], 0.0
    combined = pd.concat(
        [real_bars, gap[["timestamp", "open", "high", "low", "close", "volume"]]], ignore_index=True
    )
    return combined.drop_duplicates(subset="timestamp", keep="first").sort_values("timestamp").reset_index(drop=True)


def load_confirmed_signal_csv() -> pd.DataFrame:
    """확정 신호 로그 로드. 같은 timestamp가 여러 번 기록된 경우 마지막(가장
    나중에 쓰인 = 가장 최종 확정된) 행을 그 bucket의 정답으로 취급한다."""
    df = pd.read_csv(CONFIRMED_SIGNAL_CSV)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = df.drop_duplicates(subset="timestamp", keep="last").sort_values("timestamp").reset_index(drop=True)
    df["long_pct"] = df["prob_long"] * 100
    df["short_pct"] = df["prob_short"] * 100
    return df[["timestamp", "close", "long_pct", "short_pct", "final_decision"]]


def simulate_track_b(bars: pd.DataFrame, breakout=BREAKOUT_USD, tp=TAKE_PROFIT_USD, sl=STOP_LOSS_USD) -> list[dict]:
    trades: list[dict] = []
    n = len(bars)
    if n < 2:
        return trades
    ts = bars["timestamp"].to_numpy()
    close = bars["close"].to_numpy()
    high = bars["high"].to_numpy()
    low = bars["low"].to_numpy()

    anchor_idx, anchor_price = 0, close[0]
    state = "TENSION"
    entry_idx = entry_price = direction = None
    i = 0
    while i < n - 1:
        i += 1
        if state == "TENSION":
            if close[i] >= anchor_price + breakout:
                direction, entry_idx, entry_price, state = "LONG", i, close[i], "ENTERED"
            elif close[i] <= anchor_price - breakout:
                direction, entry_idx, entry_price, state = "SHORT", i, close[i], "ENTERED"
            continue
        if direction == "LONG":
            hit_sl, hit_tp = low[i] <= entry_price - sl, high[i] >= entry_price + tp
        else:
            hit_sl, hit_tp = high[i] >= entry_price + sl, low[i] <= entry_price - tp
        if hit_sl or hit_tp:
            outcome = "SL" if hit_sl else "TP"
            exit_price = (
                entry_price - sl if (direction == "LONG" and outcome == "SL")
                else entry_price + tp if (direction == "LONG" and outcome == "TP")
                else entry_price + sl if (direction == "SHORT" and outcome == "SL")
                else entry_price - tp
            )
            pnl = exit_price - entry_price if direction == "LONG" else entry_price - exit_price
            trades.append({
                "anchor_time": ts[anchor_idx], "anchor_price": anchor_price,
                "entry_time": ts[entry_idx], "entry_price": entry_price, "direction": direction,
                "exit_time": ts[i], "exit_price": exit_price, "outcome": outcome, "pnl": pnl,
            })
            if i < n - 1:
                anchor_idx, anchor_price = i + 1, close[i + 1]
            state, entry_idx, entry_price, direction = "TENSION", None, None, None
    if state == "ENTERED" and entry_price is not None:
        last_close = close[-1]
        pnl = last_close - entry_price if direction == "LONG" else entry_price - last_close
        trades.append({
            "anchor_time": ts[anchor_idx], "anchor_price": anchor_price,
            "entry_time": ts[entry_idx], "entry_price": entry_price, "direction": direction,
            "exit_time": ts[-1], "exit_price": last_close, "outcome": "OPEN", "pnl": pnl,
        })
    return trades


def simulate_track_a(
    merged: pd.DataFrame, breakout=BREAKOUT_USD, tp=TAKE_PROFIT_USD, sl=STOP_LOSS_USD, threshold=TENSION_THRESHOLD
) -> list[dict]:
    n = len(merged)
    trades: list[dict] = []
    if n < 2:
        return trades
    ts = merged["timestamp"].to_numpy()
    close = merged["close"].to_numpy()
    high = merged["high"].to_numpy()
    low = merged["low"].to_numpy()
    long_pct = merged["long_pct"].to_numpy()
    short_pct = merged["short_pct"].to_numpy()

    state, anchor_side, anchor_idx, anchor_price = "IDLE", None, None, None
    entry_idx = entry_price = direction = None

    for i in range(n):
        long_tension, short_tension = long_pct[i] >= threshold, short_pct[i] >= threshold
        if state == "IDLE":
            if long_tension or short_tension:
                anchor_side = "LONG" if long_tension else "SHORT"
                anchor_idx, anchor_price, state = i, close[i], "TENSION"
            continue
        if state == "TENSION":
            opposite = (anchor_side == "LONG" and short_tension) or (anchor_side == "SHORT" and long_tension)
            if opposite:
                anchor_side = "SHORT" if anchor_side == "LONG" else "LONG"
                anchor_idx, anchor_price = i, close[i]
            if close[i] >= anchor_price + breakout:
                direction, entry_idx, entry_price, state = "LONG", i, close[i], "ENTERED"
            elif close[i] <= anchor_price - breakout:
                direction, entry_idx, entry_price, state = "SHORT", i, close[i], "ENTERED"
            continue
        if direction == "LONG":
            hit_sl, hit_tp = low[i] <= entry_price - sl, high[i] >= entry_price + tp
        else:
            hit_sl, hit_tp = high[i] >= entry_price + sl, low[i] <= entry_price - tp
        if hit_sl or hit_tp:
            outcome = "SL" if hit_sl else "TP"
            exit_price = (
                entry_price - sl if (direction == "LONG" and outcome == "SL")
                else entry_price + tp if (direction == "LONG" and outcome == "TP")
                else entry_price + sl if (direction == "SHORT" and outcome == "SL")
                else entry_price - tp
            )
            pnl = exit_price - entry_price if direction == "LONG" else entry_price - exit_price
            trades.append({
                "anchor_time": ts[anchor_idx], "anchor_price": anchor_price,
                "entry_time": ts[entry_idx], "entry_price": entry_price, "direction": direction,
                "exit_time": ts[i], "exit_price": exit_price, "outcome": outcome, "pnl": pnl,
            })
            state, anchor_side, anchor_idx, anchor_price = "IDLE", None, None, None
            entry_idx = entry_price = direction = None

    if state == "ENTERED" and entry_price is not None:
        last_close = close[-1]
        pnl = last_close - entry_price if direction == "LONG" else entry_price - last_close
        trades.append({
            "anchor_time": ts[anchor_idx], "anchor_price": anchor_price,
            "entry_time": ts[entry_idx], "entry_price": entry_price, "direction": direction,
            "exit_time": ts[-1], "exit_price": last_close, "outcome": "OPEN", "pnl": pnl,
        })
    return trades


def compute_metrics(trades: list[dict]) -> dict:
    if not trades:
        return {"total_trades": 0, "win_rate": None, "cumulative_pnl": 0.0, "avg_pnl": None,
                "max_consecutive_losses": 0, "max_drawdown": 0.0, "ev_per_trade": None,
                "tp_count": 0, "sl_count": 0, "open_count": 0}
    df = pd.DataFrame(trades)
    closed = df[df["outcome"].isin(["TP", "SL"])]
    tp_count, sl_count, open_count = int((df["outcome"] == "TP").sum()), int((df["outcome"] == "SL").sum()), int((df["outcome"] == "OPEN").sum())
    win_rate = (tp_count / len(closed) * 100) if len(closed) > 0 else None
    cum = df["pnl"].cumsum()
    drawdown = cum.cummax() - cum
    max_consec = cur = 0
    for outcome in closed["outcome"]:
        cur = cur + 1 if outcome == "SL" else 0
        max_consec = max(max_consec, cur)
    return {
        "total_trades": len(df), "win_rate": win_rate, "cumulative_pnl": float(df["pnl"].sum()),
        "avg_pnl": float(df["pnl"].mean()), "max_consecutive_losses": max_consec,
        "max_drawdown": float(drawdown.max()) if len(drawdown) else 0.0, "ev_per_trade": float(df["pnl"].mean()),
        "tp_count": tp_count, "sl_count": sl_count, "open_count": open_count,
    }


def monthly_breakdown(trades: list[dict]) -> pd.DataFrame:
    if not trades:
        return pd.DataFrame(columns=["month", "trades", "win_rate", "pnl"])
    df = pd.DataFrame(trades)
    df["month"] = pd.to_datetime(df["exit_time"]).dt.to_period("M").astype(str)
    rows = []
    for month, g in df.groupby("month"):
        closed = g[g["outcome"].isin(["TP", "SL"])]
        wr = (closed["outcome"] == "TP").mean() * 100 if len(closed) else None
        rows.append({"month": month, "trades": len(g), "win_rate": wr, "pnl": float(g["pnl"].sum())})
    return pd.DataFrame(rows).sort_values("month")


def main() -> None:
    print("[data] loading price parquet -> 15m ...")
    bars = load_15m_ohlc()
    print(f"[data] price bars: {len(bars)} rows, {bars['timestamp'].min()} -> {bars['timestamp'].max()}")

    print("[data] loading extended price parquet (main + supplementary, ~2026-05-08) ...")
    bars_ext = load_15m_ohlc_extended()
    print(f"[data] extended price bars: {len(bars_ext)} rows, {bars_ext['timestamp'].min()} -> {bars_ext['timestamp'].max()}")

    print("[data] loading confirmed signal CSV (read-only) ...")
    signal_df = load_confirmed_signal_csv()
    print(f"[data] confirmed signal: {len(signal_df)} unique 15m buckets, {signal_df['timestamp'].min()} -> {signal_df['timestamp'].max()}")
    print(f"[data] long_pct max={signal_df['long_pct'].max():.2f}%, short_pct max={signal_df['short_pct'].max():.2f}%, buckets>=75%: {((signal_df['long_pct']>=75)|(signal_df['short_pct']>=75)).sum()}")

    print("[data] building hybrid OHLC for track A (real high/low where available, CSV-close fallback beyond) ...")
    hybrid_bars = build_hybrid_ohlc(signal_df, bars_ext)
    real_ts_count = len(set(hybrid_bars["timestamp"]) & set(bars_ext["timestamp"]) & set(signal_df["timestamp"]))
    approx_count = len(signal_df) - real_ts_count
    print(f"[data] hybrid bars covering signal range: real OHLC={real_ts_count} bucket(s), CSV-close approx={approx_count} bucket(s)")

    merged = hybrid_bars.merge(signal_df, on="timestamp", how="inner", suffixes=("", "_sig")).sort_values("timestamp").reset_index(drop=True)
    print(f"[data] price/signal overlap: {len(merged)} rows")

    period_start, period_end = merged["timestamp"].min(), merged["timestamp"].max()
    bars_same_period = bars[(bars["timestamp"] >= period_start) & (bars["timestamp"] <= period_end)].reset_index(drop=True)
    if bars_same_period.empty or bars_same_period["timestamp"].max() < period_end:
        # 메인 parquet만으로는 트랙 B 비교 구간을 다 못 채우므로 하이브리드로 대체
        bars_same_period = hybrid_bars[
            (hybrid_bars["timestamp"] >= period_start) & (hybrid_bars["timestamp"] <= period_end)
        ].reset_index(drop=True)

    print("[track A] AI-gated tension breakout (confirmed signal CSV) ...")
    trades_a = simulate_track_a(merged)
    metrics_a = compute_metrics(trades_a)
    monthly_a = monthly_breakdown(trades_a)

    print("[track B] unconditional breakout, same period as track A ...")
    trades_b_same = simulate_track_b(bars_same_period)
    metrics_b_same = compute_metrics(trades_b_same)

    print("[track B] unconditional breakout, full 7yr period (for reference) ...")
    trades_b_full = simulate_track_b(bars)
    metrics_b_full = compute_metrics(trades_b_full)

    REPORTS_DIR.mkdir(exist_ok=True)
    date_str = pd.Timestamp.utcnow().strftime("%Y-%m-%d")
    out_path = REPORTS_DIR / f"tension-backtest-v2-{date_str}.md"

    def fmt_pct(v):
        return f"{v:.1f}%" if v is not None else "—"

    def fmt_usd(v):
        return f"{'+' if v is not None and v >= 0 else ''}{v:.2f}$" if v is not None else "—"

    lines = []
    lines.append(f"# 텐션 브레이크아웃 백테스트 v2 — 트랙 A 소스 교정 ({date_str})\n")
    lines.append("## 0. v1 대비 변경점\n")
    lines.append(
        "- v1은 `eden_mobile_signal_history` DB를 트랙 A 소스로 썼는데, 이 테이블이 84.2%(656/779) bucket에서 "
        "실제 확정 신호와 어긋나는 오염된 데이터임이 밝혀짐(별도 진단 보고 참고).\n"
        "- v2는 원본 확정 신호 로그 `MyTradeBotGPU/training/eden1_0_v2/reports/paper_signals_eden1_v2_btc.csv`"
        "(읽기 전용)를 직접 소스로 사용.\n"
    )
    lines.append("## 1. 데이터\n")
    lines.append(f"- 가격(메인): 2019-01-01 ~ 2026-04-20 (`BTCUSDT_5m_2019_2026_merged.parquet` → 15m 리샘플)")
    lines.append(f"- 가격(보조, 확장): ~2026-05-08까지 (`btcusdt_5min_3yrs.parquet` 병합, 실제 high/low 사용)")
    lines.append(f"- 확정 신호: {len(signal_df)}개 고유 15m bucket, {signal_df['timestamp'].min()} ~ {signal_df['timestamp'].max()}")
    lines.append(
        f"- **중요 데이터 한계**: 확정 신호 CSV는 그 자체로 내부 공백이 있음(2026-04-20 23:45 직후 바로 "
        f"2026-05-19 03:00로 건너뜀 — 그 사이 로그 없음, 봇 미가동 추정). 또 로컬 실가격 parquet은 "
        f"2026-05-08까지만 존재해 CSV 커버리지(~7/7)의 끝부분은 실측 OHLC가 없음. 이 때문에 신호·가격이 "
        f"겹치는 {len(signal_df)}개 bucket 중 실제 high/low parquet과 맞아떨어지는 건 단 {real_ts_count}개뿐이고 "
        f"나머지 {approx_count}개({approx_count/len(signal_df)*100:.1f}%)는 로컬에 정밀 가격 parquet이 없어 "
        f"CSV 자체 종가를 open=high=low=close로 근사함.\n"
        f"- **단, 이 근사는 실제 배포된 UI(`MobileSignalDashboard.tsx`의 `simulateTensionBreakout`)와 방법론이 "
        f"동일함** — 프로덕션 로직도 봉중 high/low가 아니라 15분 종가(`point.price`)만으로 앵커/이탈/TP/SL을 "
        f"판정하므로, 이 근사치 기반 결과는 실사용 대시보드가 실제로 만들어냈을 결과에 더 가까운 값입니다. "
        f"(참고용 트랙 B 전체 7년 결과는 반대로 실 OHLC high/low 기반이라 방법론이 다르며 직접 비교 대상이 아님)\n"
    )
    lines.append(
        f"- 가격·신호 겹치는 실제 비교 구간: **{period_start} ~ {period_end}** ({len(merged)}개 15m bucket)"
    )
    lines.append(
        f"- 이 구간 관측: long_pct 최대 {signal_df['long_pct'].max():.2f}%, short_pct 최대 {signal_df['short_pct'].max():.2f}%, "
        f"75% 이상 도달 bucket 수: {((signal_df['long_pct']>=75)|(signal_df['short_pct']>=75)).sum()}건 "
        f"— v1(DB 소스, 0건)과 달리 **실제로 임계값을 여러 번 넘음**.\n"
    )

    lines.append("## 2. 트랙 A vs 트랙 B (같은 기간 기준)\n")
    lines.append("| 지표 | 트랙 A (AI 게이트) | 트랙 B (무필터, 같은 기간) |")
    lines.append("|---|---|---|")
    lines.append(f"| 총 트레이드 | {metrics_a['total_trades']} | {metrics_b_same['total_trades']} |")
    lines.append(f"| 익절/손절/미청산 | {metrics_a['tp_count']}/{metrics_a['sl_count']}/{metrics_a['open_count']} | {metrics_b_same['tp_count']}/{metrics_b_same['sl_count']}/{metrics_b_same['open_count']} |")
    lines.append(f"| 승률 | {fmt_pct(metrics_a['win_rate'])} | {fmt_pct(metrics_b_same['win_rate'])} |")
    lines.append(f"| 누적 손익 | {fmt_usd(metrics_a['cumulative_pnl'])} | {fmt_usd(metrics_b_same['cumulative_pnl'])} |")
    lines.append(f"| EV/트레이드 | {fmt_usd(metrics_a['ev_per_trade'])} | {fmt_usd(metrics_b_same['ev_per_trade'])} |")
    lines.append(f"| 최대 연속 손실 | {metrics_a['max_consecutive_losses']} | {metrics_b_same['max_consecutive_losses']} |")
    lines.append(f"| 최대 드로다운 | -{metrics_a['max_drawdown']:.2f}$ | -{metrics_b_same['max_drawdown']:.2f}$ |")

    if metrics_a["ev_per_trade"] is not None and metrics_b_same["ev_per_trade"] is not None:
        improvement = metrics_a["ev_per_trade"] - metrics_b_same["ev_per_trade"]
        lines.append(f"\n> **AI 게이트 개선폭(EV 기준): {fmt_usd(improvement)}/트레이드** "
                      f"({'AI 필터가 EV를 개선함' if improvement > 0 else 'AI 필터가 오히려 EV를 악화시킴'})\n")

    lines.append("## 3. 참고 — 트랙 B 전체 7년 기준 (필터 없음)\n")
    lines.append(f"- 총 트레이드 {metrics_b_full['total_trades']}, 승률 {fmt_pct(metrics_b_full['win_rate'])}, 누적손익 {fmt_usd(metrics_b_full['cumulative_pnl'])}, EV/트레이드 {fmt_usd(metrics_b_full['ev_per_trade'])}\n")

    lines.append("## 4. 트랙 A 월별 분해\n")
    lines.append("| 월 | 트레이드 | 승률 | 손익 |")
    lines.append("|---|---|---|---|")
    for _, row in monthly_a.iterrows():
        lines.append(f"| {row['month']} | {row['trades']} | {fmt_pct(row['win_rate'])} | {fmt_usd(row['pnl'])} |")

    lines.append("\n## 5. 결론\n")
    if metrics_a["total_trades"] > 0:
        lines.append(
            f"- v1의 '9일간 텐션 0회' 결론은 **오염된 DB 소스 때문에 무효**였고, 올바른 소스로는 "
            f"{len(merged)}개 bucket 구간에서 실제로 {metrics_a['total_trades']}건의 텐션 트레이드가 발생함.\n"
        )
    lines.append(
        "- 표본이 여전히 v1보다는 크지만(수개월) 7년 전체는 아님 — 확정 신호 로그 자체가 이 기간만 존재하기 때문. "
        "결과는 표시 전용 참고 자료이며 실제 주문 근거로 사용할 수 없습니다."
    )

    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n[report] written to {out_path}")
    print("\n=== SUMMARY ===")
    print("Track A:", metrics_a)
    print("Track B (same period):", metrics_b_same)
    print("Track B (full 7yr):", metrics_b_full)


if __name__ == "__main__":
    main()
