from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Any

from ai_common import PERFORMANCE_DB_PATH, AgentResult, TradeTask


def init_learning_db() -> None:
    PERFORMANCE_DB_PATH.parent.mkdir(exist_ok=True)
    conn = sqlite3.connect(PERFORMANCE_DB_PATH)
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS ai_runs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              created_at TEXT NOT NULL,
              scenario TEXT NOT NULL,
              message TEXT NOT NULL,
              winner TEXT,
              report_path TEXT,
              payload_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ai_agent_results (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              run_id INTEGER NOT NULL,
              agent TEXT NOT NULL,
              model TEXT NOT NULL,
              scenario TEXT NOT NULL,
              price REAL NOT NULL,
              platform TEXT,
              confidence REAL NOT NULL,
              fraud_risk REAL NOT NULL,
              latency_ms REAL NOT NULL,
              cost_usd REAL NOT NULL,
              total_score REAL NOT NULL,
              ok INTEGER NOT NULL,
              source TEXT NOT NULL,
              error TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY(run_id) REFERENCES ai_runs(id)
            );

            CREATE INDEX IF NOT EXISTS idx_ai_agent_results_agent
              ON ai_agent_results(agent, scenario);
            """
        )
        conn.commit()
    finally:
        conn.close()


def record_run(
    task: TradeTask,
    results: list[AgentResult],
    comparison: dict[str, Any],
    report_path: str,
) -> int:
    init_learning_db()
    conn = sqlite3.connect(PERFORMANCE_DB_PATH)
    created_at = datetime.now(timezone.utc).isoformat()
    try:
        cur = conn.execute(
            """
            INSERT INTO ai_runs(created_at, scenario, message, winner, report_path, payload_json)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                created_at,
                task.scenario,
                task.message,
                comparison.get("winner"),
                report_path,
                json.dumps(comparison, ensure_ascii=False),
            ),
        )
        run_id = int(cur.lastrowid)
        for result in results:
            conn.execute(
                """
                INSERT INTO ai_agent_results(
                  run_id, agent, model, scenario, price, platform, confidence,
                  fraud_risk, latency_ms, cost_usd, total_score, ok, source,
                  error, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    result.agent,
                    result.model,
                    result.scenario,
                    result.price,
                    result.platform,
                    result.confidence,
                    result.fraud_risk,
                    result.latency_ms,
                    result.cost_usd,
                    result.metrics.get("total", 0.0),
                    1 if result.ok else 0,
                    result.source,
                    result.error,
                    created_at,
                ),
            )
        conn.commit()
        return run_id
    finally:
        conn.close()


def agent_strengths(limit: int = 20) -> list[dict[str, Any]]:
    init_learning_db()
    conn = sqlite3.connect(PERFORMANCE_DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT agent, scenario,
                   COUNT(*) AS runs,
                   AVG(total_score) AS avg_score,
                   AVG(latency_ms) AS avg_latency_ms,
                   AVG(cost_usd) AS avg_cost_usd,
                   AVG(100 - fraud_risk) AS avg_fraud_avoidance
            FROM ai_agent_results
            GROUP BY agent, scenario
            ORDER BY avg_score DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def learning_bias_for(scenario: str) -> dict[str, float]:
    strengths = agent_strengths(100)
    bias: dict[str, float] = {}
    for row in strengths:
        if row["scenario"] == scenario and row["runs"] >= 3:
            bias[row["agent"]] = min(5.0, max(-5.0, (row["avg_score"] - 70.0) / 10.0))
    return bias
