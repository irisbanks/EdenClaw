#!/bin/bash
# run_pipeline_loop.sh
# 현재 크롤링 완료 후 자동으로 확장 키워드로 이어서 실행
# 이미 수집된 키워드는 자동 스킵 → 중복 없이 누적

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG="$PROJECT_DIR/logs/pipeline_loop.log"
PID_FILE="$PROJECT_DIR/logs/pipeline_pid.txt"

echo "======================================" | tee -a "$LOG"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 루프 시작" | tee -a "$LOG"

# ── 1. 현재 실행 중인 파이프라인이 끝날 때까지 대기 ──────────────────────
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 기존 PID $OLD_PID 완료 대기 중..." | tee -a "$LOG"
        wait "$OLD_PID" 2>/dev/null
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 기존 프로세스 완료" | tee -a "$LOG"
    fi
fi

# ── 2. 확장 키워드로 계속 실행 (완료된 키워드 자동 스킵) ─────────────────
cd "$PROJECT_DIR"
ROUND=1
while true; do
    echo "" | tee -a "$LOG"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] === 라운드 $ROUND 시작 ===" | tee -a "$LOG"

    # DB에서 아직 안 한 키워드 수 확인
    REMAINING=$(python3 - << 'PYEOF'
import sqlite3, os, ast, re

db = 'data/shop_products.db'
if not os.path.exists(db):
    print(999)
else:
    with open('scripts/crawl_embed_pipeline.py') as f:
        src = f.read()
    m = re.search(r'CATEGORIES = (\{.*?\n\})', src, re.DOTALL)
    cats = ast.literal_eval(m.group(1))
    all_kw = [kw for kws in cats.values() for kw in kws]

    conn = sqlite3.connect(db)
    done = set(row[0] for row in conn.execute('SELECT DISTINCT keyword FROM products').fetchall())
    conn.close()
    print(len([k for k in all_kw if k not in done]))
PYEOF
)

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 남은 키워드: ${REMAINING}개" | tee -a "$LOG"

    if [ "$REMAINING" -eq "0" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ 모든 키워드 완료!" | tee -a "$LOG"
        break
    fi

    # 파이프라인 실행 (크롤링 + 임베딩)
    python3 scripts/crawl_embed_pipeline.py --pages 5 --gpu 2 2>&1 | tee -a "$LOG"
    EXIT_CODE=${PIPESTATUS[0]}

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 라운드 $ROUND 종료 (exit=$EXIT_CODE)" | tee -a "$LOG"

    # DB 현황 출력
    python3 - << 'PYEOF' | tee -a "$LOG"
import sqlite3
conn = sqlite3.connect('data/shop_products.db')
total = conn.execute('SELECT COUNT(*) FROM products').fetchone()[0]
cats  = conn.execute('SELECT category, COUNT(*) c FROM products GROUP BY category ORDER BY c DESC').fetchall()
print(f'\n  현재 DB 총합: {total:,}개')
for c,n in cats:
    print(f'  {c:<12} {n:,}개')
conn.close()
PYEOF

    ROUND=$((ROUND + 1))
    # 오류가 났어도 잠깐 쉬었다가 재시도
    if [ "$EXIT_CODE" -ne "0" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ 오류 발생, 30초 후 재시도..." | tee -a "$LOG"
        sleep 30
    fi
done

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 루프 종료" | tee -a "$LOG"
