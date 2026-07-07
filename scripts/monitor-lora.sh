#!/usr/bin/env bash
set -uo pipefail

MASTER_LOG="${MASTER_LOG:-logs/finetune/master.log}"
PROGRESS_LOG="${PROGRESS_LOG:-logs/lora-progress.log}"

mkdir -p "$(dirname "$MASTER_LOG")" "$(dirname "$PROGRESS_LOG")"
touch "$MASTER_LOG" "$PROGRESS_LOG"

while true; do
  sleep 300

  done_count="$(grep -c ' DONE ' "$MASTER_LOG" 2>/dev/null || true)"
  fail_count="$(grep -c ' FAIL ' "$MASTER_LOG" 2>/dev/null || true)"
  skip_count="$(grep -c ' SKIP ' "$MASTER_LOG" 2>/dev/null || true)"
  gpu_line="$(nvidia-smi -i 3 --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null || echo 'unknown,unknown,unknown')"
  http_code="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/v1/models 2>/dev/null || echo '000')"

  printf '[%s] DONE=%s FAIL=%s SKIP=%s GPU3=%s HTTP=%s\n' \
    "$(date '+%Y-%m-%d %H:%M:%S')" \
    "$done_count" \
    "$fail_count" \
    "$skip_count" \
    "$gpu_line" \
    "$http_code" >> "$PROGRESS_LOG"
done
