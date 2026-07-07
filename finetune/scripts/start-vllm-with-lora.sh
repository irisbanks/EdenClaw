#!/usr/bin/env bash
set -euo pipefail

MODEL_NAME="${MODEL_NAME:-Qwen/Qwen2.5-72B-Instruct}"
PORT="${PORT:-8000}"

python -m vllm.entrypoints.openai.api_server \
  --model "${MODEL_NAME}" \
  --host 0.0.0.0 \
  --port "${PORT}" \
  --tensor-parallel-size 4 \
  --dtype auto \
  --max-model-len 32768 \
  --enable-lora \
  --max-loras 8 \
  --lora-modules \
    seller_agent=finetune/adapters/seller-agent \
    listing_writer=finetune/adapters/listing-writer \
    safety_agent=finetune/adapters/safety-agent
