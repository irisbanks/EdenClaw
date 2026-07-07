#!/usr/bin/env bash
set -uo pipefail

export CUDA_VISIBLE_DEVICES=3

START_AGENT="${1:-1}"
END_AGENT="${2:-161}"
BASE_MODEL="${BASE_MODEL:-Qwen/Qwen2.5-72B-Instruct}"
PRIMARY_DATA_ROOT="${PRIMARY_DATA_ROOT:-data/finetune}"
FALLBACK_DATA_ROOT="${FALLBACK_DATA_ROOT:-finetune/adapters}"
OUTPUT_ROOT="${OUTPUT_ROOT:-models/lora_adapters}"
LOG_DIR="${LOG_DIR:-logs/finetune}"
MASTER_LOG="$LOG_DIR/master.log"
PYTHON_BIN="${PYTHON_BIN:-python}"

mkdir -p "$LOG_DIR" "$OUTPUT_ROOT"
touch "$MASTER_LOG"

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

log_marker() {
  local marker="$1"
  local agent="$2"
  local detail="${3:-}"
  if [[ -n "$detail" ]]; then
    printf '[%s] %s %s %s\n' "$(timestamp)" "$marker" "$agent" "$detail" | tee -a "$MASTER_LOG"
  else
    printf '[%s] %s %s\n' "$(timestamp)" "$marker" "$agent" | tee -a "$MASTER_LOG"
  fi
}

find_agent_dirs() {
  local idx="$1"
  local nnn
  printf -v nnn '%03d' "$idx"

  local matches=()
  shopt -s nullglob
  matches=("$PRIMARY_DATA_ROOT"/agent_"$nnn"_*/)
  shopt -u nullglob

  if (( ${#matches[@]} > 0 )); then
    printf '%s\n' "${matches[@]%/}"
    return 0
  fi

  if [[ -d "$FALLBACK_DATA_ROOT" ]]; then
    find "$FALLBACK_DATA_ROOT" -maxdepth 1 -mindepth 1 -type d | sort | sed -n "${idx}p"
  fi
}

train_agent() {
  local agent_dir="$1"
  local agent_name
  agent_name="$(basename "$agent_dir")"
  local output_dir="$OUTPUT_ROOT/$agent_name"
  local train_file="$agent_dir/train.jsonl"
  local train_log="$LOG_DIR/${agent_name}.log"

  if [[ ! -f "$train_file" ]]; then
    log_marker "SKIP" "$agent_name" "missing_train_jsonl"
    return 0
  fi

  if [[ -f "$output_dir/adapter_model.safetensors" ]]; then
    log_marker "SKIP" "$agent_name" "adapter_exists"
    return 0
  fi

  mkdir -p "$output_dir"
  log_marker "START" "$agent_name" "data_dir=$agent_dir output_dir=$output_dir"

  if "$PYTHON_BIN" scripts/train_one_lora.py \
    --data_dir "$agent_dir" \
    --output_dir "$output_dir" \
    --base_model "$BASE_MODEL" \
    --lora_r 16 \
    --lora_alpha 32 \
    --lora_dropout 0.05 \
    --lr 2e-4 \
    --epochs 3 \
    --batch_size 2 \
    --grad_accum 8 \
    --bf16 \
    2>&1 | tee "$train_log"; then
    if [[ -f "$output_dir/adapter_model.safetensors" ]]; then
      log_marker "DONE" "$agent_name" "output_dir=$output_dir"
    else
      log_marker "FAIL" "$agent_name" "adapter_model_missing see=$train_log"
    fi
  else
    log_marker "FAIL" "$agent_name" "see=$train_log"
  fi
}

for ((i = START_AGENT; i <= END_AGENT; i++)); do
  nnn="$(printf '%03d' "$i")"
  mapfile -t agent_dirs < <(find_agent_dirs "$i")

  if (( ${#agent_dirs[@]} == 0 )); then
    log_marker "SKIP" "agent_$nnn" "no_data"
    continue
  fi

  for agent_dir in "${agent_dirs[@]}"; do
    train_agent "$agent_dir"
  done
done
