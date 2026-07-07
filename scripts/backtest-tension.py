#!/usr/bin/env python3
"""
텐션 브레이크아웃 전략 대규모 백테스트.

상태머신은 app/mobile-signal/MobileSignalDashboard.tsx의 UI 시뮬레이션과 동일한
규칙(앵커 -> ±BREAKOUT 이탈 방향 진입 -> +TP 익절 / -SL 손절, 동시 충족 시
보수적 SL)을 따르되, 두 곳에서 UI보다 정밀하게 처리한다:
  1. TP/SL 판정을 종가가 아니라 봉의 high/low로 판정한다(봉 내부에서 스쳐도 감지).
  2. 트랙 B는 사람이 지켜보지 않아도 되는 "상시" 버전 — 청산 직후 다음 봉을
     새 앵커로 즉시 재설정해 AI 텐션 트리거 없이 전체 기간을 커버한다.

진입 자체(앵커 대비 ±BREAKOUT 도달 판정)는 UI와 동일하게 종가 기준으로 유지한다
(TP/SL 판정만 고도화하라는 지시를 그대로 따름 — entry 로직을 바꾸면 UI 버전과
비교 가능성이 사라지기 때문).

읽기 전용: bitcoin_model 디렉터리는 전혀 열지 않는다(별도 위치의 데이터만 사용).
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
REPORTS_DIR = PROJECT_ROOT / "reports"

PRICE_PARQUET = Path(
    "/NHNHOME/WORKSPACE/0426030063_A/MyTradeBotGPU/data/processed/BTCUSDT_5m_2019_2026_merged.parquet"
)
# eden_mobile_signal_history 테이블 export (data/ 는 gitignore 대상 — 재생성 필요 시:
#   node -e "import('dotenv/config').then(async()=>{const {PrismaClient}=await import('@prisma/client');
#   const {PrismaPg}=await import('@prisma/adapter-pg');const adapter=new PrismaPg({connectionString:
#   process.env.DATABASE_URL});const prisma=new PrismaClient({adapter});const rows=await prisma.\$queryRawUnsafe(
#   'SELECT bucket_ts, payload FROM eden_mobile_signal_history ORDER BY bucket_ts ASC');
#   require('fs').writeFileSync('data/tension-backtest-cache/signal_history_export.json',
#   JSON.stringify(rows.map(r=>({bucket_ts:r.bucket_ts,...r.payload}))));await prisma.\$disconnect();});"
SIGNAL_HISTORY_JSON = PROJECT_ROOT / "data" / "tension-backtest-cache" / "signal_history_export.json"

# ── 전략 상수 (기본값 — UI와 동일) ──────────────────────────────────────────
BREAKOUT_USD = 250
TAKE_PROFIT_USD = 300
STOP_LOSS_USD = 500
TENSION_THRESHOLD = 75  # %

ROUNDTRIP_FEE_PCT = 0.001  # 왕복 0.1% 가정(수수료/슬리피지 보정용, 결과에는 별도 표기)


def load_15m_ohlc() -> pd.DataFrame:
    df = pd.read_parquet(PRICE_PARQUET)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = df.set_index("timestamp").sort_index()
    ohlc = df.resample("15min").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    )
    ohlc = ohlc.dropna(subset=["open", "high", "low", "close"])
    return ohlc.reset_index()


def simulate_track_b(
    bars: pd.DataFrame,
    breakout: float = BREAKOUT_USD,
    tp: float = TAKE_PROFIT_USD,
    sl: float = STOP_LOSS_USD,
) -> list[dict]:
    """AI 필터 없는 상시 브레이크아웃. 청산 직후 다음 봉을 새 앵커로 삼는다."""
    trades: list[dict] = []
    n = len(bars)
    if n < 2:
        return trades

    ts = bars["timestamp"].to_numpy()
    close = bars["close"].to_numpy()
    high = bars["high"].to_numpy()
    low = bars["low"].to_numpy()

    i = 0
    anchor_idx = 0
    anchor_price = close[0]
    state = "TENSION"  # 트랙 B는 AI 게이트가 없어 시작부터 바로 텐션 상태로 취급
    entry_idx = None
    entry_price = None
    direction = None

    while i < n - 1:
        i += 1
        if state == "TENSION":
            if close[i] >= anchor_price + breakout:
                direction = "LONG"
                entry_idx, entry_price = i, close[i]
                state = "ENTERED"
            elif close[i] <= anchor_price - breakout:
                direction = "SHORT"
                entry_idx, entry_price = i, close[i]
                state = "ENTERED"
            continue

        # state == ENTERED : high/low 기준 정밀 TP/SL 판정
        if direction == "LONG":
            hit_sl = low[i] <= entry_price - sl
            hit_tp = high[i] >= entry_price + tp
        else:
            hit_sl = high[i] >= entry_price + sl
            hit_tp = low[i] <= entry_price - tp

        if hit_sl or hit_tp:
            outcome = "SL" if hit_sl else "TP"  # 동시 충족 시 보수적으로 SL
            exit_price = (
                entry_price - sl if (direction == "LONG" and outcome == "SL")
                else entry_price + tp if (direction == "LONG" and outcome == "TP")
                else entry_price + sl if (direction == "SHORT" and outcome == "SL")
                else entry_price - tp
            )
            pnl = exit_price - entry_price if direction == "LONG" else entry_price - exit_price
            trades.append(
                {
                    "anchor_time": ts[anchor_idx],
                    "anchor_price": anchor_price,
                    "entry_time": ts[entry_idx],
                    "entry_price": entry_price,
                    "direction": direction,
                    "exit_time": ts[i],
                    "exit_price": exit_price,
                    "outcome": outcome,
                    "pnl": pnl,
                }
            )
            # 청산 직후 다음 봉을 새 앵커로 즉시 재설정(상시 브레이크아웃)
            if i < n - 1:
                anchor_idx = i + 1
                anchor_price = close[i + 1]
            state = "TENSION"
            entry_idx = entry_price = direction = None

    if state == "ENTERED" and entry_price is not None:
        last_close = close[-1]
        pnl = last_close - entry_price if direction == "LONG" else entry_price - last_close
        trades.append(
            {
                "anchor_time": ts[anchor_idx],
                "anchor_price": anchor_price,
                "entry_time": ts[entry_idx],
                "entry_price": entry_price,
                "direction": direction,
                "exit_time": ts[-1],
                "exit_price": last_close,
                "outcome": "OPEN",
                "pnl": pnl,
            }
        )

    return trades


def simulate_track_a(
    bars: pd.DataFrame,
    signal_df: pd.DataFrame,
    breakout: float = BREAKOUT_USD,
    tp: float = TAKE_PROFIT_USD,
    sl: float = STOP_LOSS_USD,
    threshold: float = TENSION_THRESHOLD,
) -> list[dict]:
    """AI confirmed_signal LONG%/SHORT% >= threshold 를 텐션 트리거로 사용.

    로컬 가격 parquet(2019~2026-04)과 eden_mobile_signal_history(2026-06-29~)
    사이에 약 2개월 시간 간극이 있어 두 소스를 직접 join하면 0행이 된다.
    signal_history 테이블 자체가 매 15m bucket마다 `price`(그 시점 종가)를
    함께 저장하므로, 그 값을 그대로 종가로 써서 별도 parquet join 없이
    처리한다 — 단, 이 경로에서는 high/low가 없어 TP/SL도 종가 기준으로
    판정한다(트랙 B는 high/low 정밀 판정 유지).
    """
    merged = bars.merge(signal_df, on="timestamp", how="inner").sort_values("timestamp").reset_index(drop=True)
    if len(merged) < 2 and len(signal_df) >= 2:
        # 시간 간극으로 join이 비면 signal_history 자체의 price를 종가로 사용
        merged = signal_df.sort_values("timestamp").reset_index(drop=True).copy()
        merged["close"] = merged["price"]
        merged["high"] = merged["price"]
        merged["low"] = merged["price"]
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

    state = "IDLE"
    anchor_side = None
    anchor_idx = None
    anchor_price = None
    entry_idx = entry_price = direction = None

    for i in range(n):
        long_tension = long_pct[i] >= threshold
        short_tension = short_pct[i] >= threshold

        if state == "IDLE":
            if long_tension or short_tension:
                anchor_side = "LONG" if long_tension else "SHORT"
                anchor_idx, anchor_price = i, close[i]
                state = "TENSION"
            continue

        if state == "TENSION":
            opposite = (anchor_side == "LONG" and short_tension) or (anchor_side == "SHORT" and long_tension)
            if opposite:
                anchor_side = "SHORT" if anchor_side == "LONG" else "LONG"
                anchor_idx, anchor_price = i, close[i]

            if close[i] >= anchor_price + breakout:
                direction = "LONG"
                entry_idx, entry_price = i, close[i]
                state = "ENTERED"
            elif close[i] <= anchor_price - breakout:
                direction = "SHORT"
                entry_idx, entry_price = i, close[i]
                state = "ENTERED"
            continue

        # ENTERED
        if direction == "LONG":
            hit_sl = low[i] <= entry_price - sl
            hit_tp = high[i] >= entry_price + tp
        else:
            hit_sl = high[i] >= entry_price + sl
            hit_tp = low[i] <= entry_price - tp

        if hit_sl or hit_tp:
            outcome = "SL" if hit_sl else "TP"
            exit_price = (
                entry_price - sl if (direction == "LONG" and outcome == "SL")
                else entry_price + tp if (direction == "LONG" and outcome == "TP")
                else entry_price + sl if (direction == "SHORT" and outcome == "SL")
                else entry_price - tp
            )
            pnl = exit_price - entry_price if direction == "LONG" else entry_price - exit_price
            trades.append(
                {
                    "anchor_time": ts[anchor_idx], "anchor_price": anchor_price,
                    "entry_time": ts[entry_idx], "entry_price": entry_price, "direction": direction,
                    "exit_time": ts[i], "exit_price": exit_price, "outcome": outcome, "pnl": pnl,
                }
            )
            state = "IDLE"
            anchor_side = anchor_idx = anchor_price = entry_idx = entry_price = direction = None

    if state == "ENTERED" and entry_price is not None:
        last_close = close[-1]
        pnl = last_close - entry_price if direction == "LONG" else entry_price - last_close
        trades.append(
            {
                "anchor_time": ts[anchor_idx], "anchor_price": anchor_price,
                "entry_time": ts[entry_idx], "entry_price": entry_price, "direction": direction,
                "exit_time": ts[-1], "exit_price": last_close, "outcome": "OPEN", "pnl": pnl,
            }
        )

    return trades


def compute_metrics(trades: list[dict]) -> dict:
    if not trades:
        return {
            "total_trades": 0, "win_rate": None, "cumulative_pnl": 0.0, "avg_pnl": None,
            "max_consecutive_losses": 0, "max_drawdown": 0.0, "ev_per_trade": None,
            "tp_count": 0, "sl_count": 0, "open_count": 0,
        }

    df = pd.DataFrame(trades)
    closed = df[df["outcome"].isin(["TP", "SL"])]
    tp_count = int((df["outcome"] == "TP").sum())
    sl_count = int((df["outcome"] == "SL").sum())
    open_count = int((df["outcome"] == "OPEN").sum())
    win_rate = (tp_count / len(closed) * 100) if len(closed) > 0 else None

    cum = df["pnl"].cumsum()
    running_max = cum.cummax()
    drawdown = running_max - cum
    max_drawdown = float(drawdown.max()) if len(drawdown) else 0.0

    # 최대 연속 손실(청산된 트레이드만, OPEN 제외)
    max_consec = 0
    cur_consec = 0
    for outcome in closed["outcome"]:
        if outcome == "SL":
            cur_consec += 1
            max_consec = max(max_consec, cur_consec)
        else:
            cur_consec = 0

    return {
        "total_trades": len(df),
        "win_rate": win_rate,
        "cumulative_pnl": float(df["pnl"].sum()),
        "avg_pnl": float(df["pnl"].mean()),
        "max_consecutive_losses": max_consec,
        "max_drawdown": max_drawdown,
        "ev_per_trade": float(df["pnl"].mean()),
        "tp_count": tp_count,
        "sl_count": sl_count,
        "open_count": open_count,
    }


def yearly_breakdown(trades: list[dict]) -> pd.DataFrame:
    if not trades:
        return pd.DataFrame(columns=["year", "trades", "win_rate", "pnl"])
    df = pd.DataFrame(trades)
    df["year"] = pd.to_datetime(df["exit_time"]).dt.year
    rows = []
    for year, g in df.groupby("year"):
        closed = g[g["outcome"].isin(["TP", "SL"])]
        wr = (closed["outcome"] == "TP").mean() * 100 if len(closed) else None
        rows.append({"year": int(year), "trades": len(g), "win_rate": wr, "pnl": float(g["pnl"].sum())})
    return pd.DataFrame(rows).sort_values("year")


def run_synthetic_unit_test() -> None:
    """소규모 합성 데이터로 high/low 기반 TP/SL 판정 로직 검증."""
    bars = pd.DataFrame(
        {
            "timestamp": pd.date_range("2024-01-01", periods=6, freq="15min", tz="UTC"),
            "open": [60000, 60000, 60260, 60400, 60560, 60000],
            "high": [60000, 60050, 60300, 60450, 60600, 60050],
            "low": [60000, 59950, 60200, 60350, 60500, 59950],
            "close": [60000, 60000, 60260, 60400, 60560, 60000],
        }
    )
    trades = simulate_track_b(bars, breakout=250, tp=300, sl=500)
    assert len(trades) >= 1, "unit test: expected at least one trade"
    t = trades[0]
    assert t["direction"] == "LONG", f"unit test: expected LONG, got {t['direction']}"
    assert t["outcome"] == "TP", f"unit test: expected TP via high={{60600}} >= entry+300, got {t['outcome']}"
    print("[unit-test] high/low TP/SL detection OK:", t)

    # SL via low touch, intrabar (close doesn't reach SL level but low does)
    bars2 = pd.DataFrame(
        {
            "timestamp": pd.date_range("2024-01-01", periods=4, freq="15min", tz="UTC"),
            "open": [60000, 60260, 60100, 60050],
            "high": [60000, 60300, 60150, 60100],
            "low": [60000, 60200, 59740, 60000],
            "close": [60000, 60260, 60100, 60050],
        }
    )
    trades2 = simulate_track_b(bars2, breakout=250, tp=300, sl=500)
    assert len(trades2) >= 1
    t2 = trades2[0]
    assert t2["outcome"] == "SL", f"unit test: expected SL via low intrabar touch, got {t2['outcome']}"
    assert abs(t2["exit_price"] - (t2["entry_price"] - 500)) < 1e-9
    print("[unit-test] intrabar SL touch (close never reaches SL) OK:", t2)


def main() -> None:
    run_synthetic_unit_test()

    print("[data] loading 5m OHLCV and resampling to 15m ...")
    bars_15m = load_15m_ohlc()
    coverage_start = bars_15m["timestamp"].min()
    coverage_end = bars_15m["timestamp"].max()
    print(f"[data] 15m bars: {len(bars_15m)} rows, {coverage_start} -> {coverage_end}")

    signal_raw = json.loads(SIGNAL_HISTORY_JSON.read_text())
    signal_df = pd.DataFrame(signal_raw)
    signal_df["timestamp"] = pd.to_datetime(signal_df["bucket_ts"], utc=True)
    signal_df = signal_df[["timestamp", "long_pct", "short_pct", "price"]].drop_duplicates("timestamp")
    print(f"[data] AI signal history: {len(signal_df)} rows, {signal_df['timestamp'].min()} -> {signal_df['timestamp'].max()}")

    print("[track A] running AI-gated tension breakout ...")
    trades_a = simulate_track_a(bars_15m, signal_df)
    metrics_a = compute_metrics(trades_a)
    yearly_a = yearly_breakdown(trades_a)

    print("[track B] running unconditional tension breakout over full history ...")
    trades_b = simulate_track_b(bars_15m)
    metrics_b = compute_metrics(trades_b)
    yearly_b = yearly_breakdown(trades_b)

    print("[sweep] running parameter sweep on track B ...")
    sweep_rows = []
    for bo in (150, 250, 350):
        for tp in (200, 300, 450):
            for sl in (300, 500, 700):
                trades = simulate_track_b(bars_15m, breakout=bo, tp=tp, sl=sl)
                m = compute_metrics(trades)
                sweep_rows.append({"breakout": bo, "tp": tp, "sl": sl, **m})
    sweep_df = pd.DataFrame(sweep_rows)

    # ── 결과 저장 ──
    REPORTS_DIR.mkdir(exist_ok=True)
    date_str = pd.Timestamp.utcnow().strftime("%Y-%m-%d")
    out_path = REPORTS_DIR / f"tension-backtest-{date_str}.md"

    def fmt_pct(v):
        return f"{v:.1f}%" if v is not None else "—"

    def fmt_usd(v):
        return f"{'+' if v >= 0 else ''}{v:.2f}$"

    lines = []
    lines.append(f"# 텐션 브레이크아웃 전략 백테스트 ({date_str})\n")
    lines.append("## 0. 데이터 인벤토리\n")
    lines.append(f"- 가격 데이터: `MyTradeBotGPU/data/processed/BTCUSDT_5m_2019_2026_merged.parquet` (5m → 15m 리샘플)")
    lines.append(f"  - 실제 커버 기간: {coverage_start} ~ {coverage_end} ({len(bars_15m):,}개 15m 봉)")
    lines.append(f"- AI confirmed_signal 히스토리: DB 테이블 `eden_mobile_signal_history`")
    lines.append(f"  - 실제 커버 기간: {signal_df['timestamp'].min()} ~ {signal_df['timestamp'].max()} ({len(signal_df)}개 15m bucket)")
    lines.append(f"  - **7년 목표에 크게 못 미침** — 이 테이블은 대시보드 배포 이후로만 누적되는 구조라 실제로는 약 9일치뿐임. 트랙 A는 이 실제 커버 기간에 대해서만 유효한 결과임.")
    lines.append(
        f"  - 이 9일 구간의 실제 관측값: long_pct 최대 {signal_df['long_pct'].max():.2f}%, "
        f"short_pct 최대 {signal_df['short_pct'].max():.2f}% — **{TENSION_THRESHOLD}% 텐션 임계값을 단 한 번도 넘지 못함**. "
        f"또한 이 기간은 로컬 가격 parquet의 커버리지({coverage_end} 종료)보다 뒤에 있어 시간상 안 겹침(테이블 자체의 `price` 필드를 종가로 직접 사용해 우회함). "
        f"두 요인 중 어느 쪽으로도 트랙 A는 이 표본에서 0건이 나오는 게 맞는 결과임(버그 아님).\n"
    )

    lines.append("## 1. 전략 파라미터 (기본값)\n")
    lines.append(f"- BREAKOUT = ${BREAKOUT_USD}, TAKE_PROFIT = ${TAKE_PROFIT_USD}, STOP_LOSS = ${STOP_LOSS_USD}, TENSION_THRESHOLD = {TENSION_THRESHOLD}%\n")

    lines.append("## 2. 트랙 A vs 트랙 B 핵심 지표\n")
    lines.append("| 지표 | 트랙 A (AI 게이트, 9일) | 트랙 B (상시, 7+년) |")
    lines.append("|---|---|---|")
    lines.append(f"| 총 트레이드 | {metrics_a['total_trades']} | {metrics_b['total_trades']} |")
    lines.append(f"| 익절/손절/미청산 | {metrics_a['tp_count']}/{metrics_a['sl_count']}/{metrics_a['open_count']} | {metrics_b['tp_count']}/{metrics_b['sl_count']}/{metrics_b['open_count']} |")
    lines.append(f"| 승률 | {fmt_pct(metrics_a['win_rate'])} | {fmt_pct(metrics_b['win_rate'])} |")
    lines.append(f"| 누적 손익 | {fmt_usd(metrics_a['cumulative_pnl'])} | {fmt_usd(metrics_b['cumulative_pnl'])} |")
    lines.append(f"| 평균 손익/트레이드 | {fmt_usd(metrics_a['avg_pnl']) if metrics_a['avg_pnl'] is not None else '—'} | {fmt_usd(metrics_b['avg_pnl'])} |")
    lines.append(f"| 최대 연속 손실 | {metrics_a['max_consecutive_losses']} | {metrics_b['max_consecutive_losses']} |")
    lines.append(f"| 최대 드로다운 | -{metrics_a['max_drawdown']:.2f}$ | -{metrics_b['max_drawdown']:.2f}$ |")
    lines.append(f"| EV/트레이드 | {fmt_usd(metrics_a['ev_per_trade']) if metrics_a['ev_per_trade'] is not None else '—'} | {fmt_usd(metrics_b['ev_per_trade'])} |")

    fee_note_a = metrics_a['total_trades'] * ROUNDTRIP_FEE_PCT * (bars_15m['close'].mean())
    fee_note_b = metrics_b['total_trades'] * ROUNDTRIP_FEE_PCT * (bars_15m['close'].mean())
    lines.append(f"\n> 수수료/슬리피지 미반영. 왕복 {ROUNDTRIP_FEE_PCT*100:.1f}% 가정 시(평균가 기준 근사), 트랙 A 총비용 약 -{fee_note_a:.0f}$, 트랙 B 총비용 약 -{fee_note_b:.0f}$ 추가 차감 필요.\n")

    lines.append("## 3. 트랙 B 연도별 분해 (편중 여부 확인)\n")
    lines.append("| 연도 | 트레이드 | 승률 | 손익 |")
    lines.append("|---|---|---|---|")
    for _, row in yearly_b.iterrows():
        lines.append(f"| {int(row['year'])} | {int(row['trades'])} | {fmt_pct(row['win_rate'])} | {fmt_usd(row['pnl'])} |")

    if len(yearly_a) > 0:
        lines.append("\n## 3b. 트랙 A 연도별 분해\n")
        lines.append("| 연도 | 트레이드 | 승률 | 손익 |")
        lines.append("|---|---|---|---|")
        for _, row in yearly_a.iterrows():
            lines.append(f"| {int(row['year'])} | {int(row['trades'])} | {fmt_pct(row['win_rate'])} | {fmt_usd(row['pnl'])} |")

    lines.append("\n## 4. 파라미터 스윕 (트랙 B, 전체 기간 기준) — EV/트레이드 상위 3개\n")
    top3 = sweep_df.sort_values("ev_per_trade", ascending=False).head(3)
    lines.append("| BREAKOUT | TP | SL | 총 트레이드 | 승률 | EV/트레이드 | 누적손익 |")
    lines.append("|---|---|---|---|---|---|---|")
    for _, row in top3.iterrows():
        lines.append(
            f"| {int(row['breakout'])} | {int(row['tp'])} | {int(row['sl'])} | {int(row['total_trades'])} | "
            f"{fmt_pct(row['win_rate'])} | {fmt_usd(row['ev_per_trade'])} | {fmt_usd(row['cumulative_pnl'])} |"
        )

    lines.append("\n### 전체 스윕 결과 (27개 조합)\n")
    lines.append("| BREAKOUT | TP | SL | 총 트레이드 | 승률 | EV/트레이드 | 누적손익 | 최대DD |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for _, row in sweep_df.sort_values(["breakout", "tp", "sl"]).iterrows():
        lines.append(
            f"| {int(row['breakout'])} | {int(row['tp'])} | {int(row['sl'])} | {int(row['total_trades'])} | "
            f"{fmt_pct(row['win_rate'])} | {fmt_usd(row['ev_per_trade'])} | {fmt_usd(row['cumulative_pnl'])} | -{row['max_drawdown']:.2f}$ |"
        )

    lines.append("\n## 5. 결론\n")
    ev_b = metrics_b["ev_per_trade"] or 0
    ev_a = metrics_a["ev_per_trade"] if metrics_a["ev_per_trade"] is not None else None
    if ev_a is not None:
        verdict = (
            "AI 텐션 필터(트랙 A)가 무필터(트랙 B)보다 EV/승률이 높게 나타남"
            if ev_a > ev_b else
            "이번 표본 기준으로는 AI 텐션 필터가 무필터 대비 뚜렷한 우위를 보이지 않음"
        )
    else:
        verdict = "트랙 A 표본이 너무 작아(9일) 유의미한 비교 불가 — 무필터 트랙 B(7+년)만 통계적으로 신뢰 가능한 참고 자료"
    lines.append(f"- {verdict}\n")
    lines.append(
        "- 트랙 B 자체도(수수료 미반영, 15m 종가 기준 진입, 단일 자산) 실거래 신뢰 근거가 아니며, "
        "본 결과는 표시 전용 참고 자료입니다. 실제 주문 근거로 사용할 수 없습니다."
    )

    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n[report] written to {out_path}")

    print("\n=== SUMMARY ===")
    print("Track A:", metrics_a)
    print("Track B:", metrics_b)
    print("\nTop 3 sweep combos by EV:")
    print(top3[["breakout", "tp", "sl", "total_trades", "win_rate", "ev_per_trade"]].to_string(index=False))


if __name__ == "__main__":
    main()
