#!/usr/bin/env bash
# edenclaw-commerce-lora-v2 training launcher (setup only).
#
# Operator directive 2026-05-24:
#   - DO NOT execute while Track 5 / vLLM occupy GPUs 0..3. Maintenance window only.
#   - Requires --confirm to actually start. Without it, prints the plan + safety checks.
#   - Pre-flight: refuses to start if vLLM quarantine PIDs are alive OR any
#     /home/shinseohee/trading_bot/venv/bin/python processes are present.

set -euo pipefail

VENV="${VENV:-/NHNHOME/WORKSPACE/0426030063_A/edenclaw/venv}"
PYTHON="${PYTHON:-${VENV}/bin/python}"

readonly TRAIN_SCRIPT="/NHNHOME/WORKSPACE/0426030063_A/edenclaw/edenclaw-ai/finetune/scripts/train_commerce_lora_v2.py"
readonly SANITIZE_SCRIPT="/NHNHOME/WORKSPACE/0426030063_A/edenclaw/edenclaw-ai/finetune/scripts/sanitize_commerce_dataset.py"
readonly GENERATOR_SCRIPT="/NHNHOME/WORKSPACE/0426030063_A/edenclaw/edenclaw-ai/finetune/scripts/generate_b2b_commerce_dataset.py"
readonly OUTPUT_DIR="/NHNHOME/WORKSPACE/0426030063_A/edenclaw/outputs/gemma27b-commerce-lora-v2"
readonly LOG_DIR="/NHNHOME/WORKSPACE/0426030063_A/edenclaw/logs/finetune/commerce-lora-v2"
readonly DATASETS_DIR="/NHNHOME/WORKSPACE/0426030063_A/edenclaw/edenclaw-ai/finetune/datasets"

readonly QUARANTINE_VLLM_PIDS=(1182003 1182004 1182005 1182006)
readonly TRACK5_PYTHON_PREFIX="/home/shinseohee/trading_bot/venv/bin/python"

if [[ "${1:-}" != "--confirm" ]]; then
  cat <<EOF
SAFETY: edenclaw-commerce-lora-v2 training is a 4× B200 job.
DO NOT run while:
  - vLLM base-only quarantine on port 8080 (PID ${QUARANTINE_VLLM_PIDS[*]}) is alive.
  - Track 5 trading_bot processes occupy GPUs 0..3.
This is a maintenance-window job.

Trainer        : ${TRAIN_SCRIPT}
Generator      : ${GENERATOR_SCRIPT}
Sanitize check : ${SANITIZE_SCRIPT}
Output         : ${OUTPUT_DIR}
Logs           : ${LOG_DIR}
Datasets       : ${DATASETS_DIR}/{product_intake,listing_writer,price_agent}_sft.jsonl

Hyperparameters (anti-overfit profile vs v1):
  base                            = google/gemma-2-27b-it
  LoRA r / alpha / dropout        = 16 / 32 / 0.10        (v1: 32 / 64 / 0.05)
  num_train_epochs (cap)          = 2.0                   (v1: 3.0)
  early_stopping_patience         = 2 on eval_loss
  learning_rate                   = 3e-5
  warmup_ratio                    = 0.05
  weight_decay                    = 0.10                  (v1: 0.0)
  lr_scheduler_type               = cosine
  gradient_accumulation_steps     = 16
  per_device_train_batch_size     = 1
  bf16 / gradient_checkpointing   = True / True
  eval_strategy / eval_steps      = steps / 50
  save_strategy / save_steps      = steps / 50
  save_total_limit                = 4
  load_best_model_at_end          = True (metric=eval_loss, lower=better)
  max_seq_length                  = 2048
  seed                            = 42
  target_modules                  = q_proj, k_proj, v_proj, o_proj
  output_canonical_fields         = cost, scarcity, gas_effect, counter_offer, reasoning

To proceed during the next maintenance window:
  $0 --confirm
EOF
  exit 1
fi

echo "[preflight] verifying vLLM quarantine PIDs are NOT alive..."
for pid in "${QUARANTINE_VLLM_PIDS[@]}"; do
  if kill -0 "$pid" 2>/dev/null; then
    echo "[preflight] ABORT: vLLM quarantine PID $pid is alive. Stop it first via the quarantine script."
    exit 1
  fi
done

echo "[preflight] verifying no Track 5 trading_bot python processes..."
if pgrep -fa "${TRACK5_PYTHON_PREFIX}" >/dev/null 2>&1; then
  echo "[preflight] ABORT: Track 5 trading_bot python processes detected. Pause them first:"
  pgrep -fa "${TRACK5_PYTHON_PREFIX}" | head -10
  exit 1
fi

echo "[preflight] verifying SFT inputs exist..."
for f in product_intake_sft.jsonl listing_writer_sft.jsonl price_agent_sft.jsonl; do
  if [[ ! -f "${DATASETS_DIR}/$f" ]]; then
    echo "[preflight] ABORT: missing ${DATASETS_DIR}/$f. Run generate_b2b_commerce_dataset.py first."
    exit 1
  fi
done

mkdir -p "${OUTPUT_DIR}" "${LOG_DIR}"

export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0,1,2,3}"
export OMP_NUM_THREADS=8
export TOKENIZERS_PARALLELISM=false
export HF_HOME="${HF_HOME:-/home/shinseohee/.cache/huggingface}"
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1

echo "[launch] CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES}"
echo "[launch] python=${PYTHON}"
echo "[launch] trainer=${TRAIN_SCRIPT}"
exec "${PYTHON}" "${TRAIN_SCRIPT}" 2>&1 | tee -a "${LOG_DIR}/train.log"
