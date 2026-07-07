#!/usr/bin/env bash
# EDENCLAW vLLM emergency quarantine restart
#
# Starts the Gemma base through vLLM while failed commerce LoRAs are quarantined.
# Default target: 4x B200, tensor parallel size 4, OpenAI-compatible API on 8080.

set -euo pipefail

VENV="${VENV:-/NHNHOME/WORKSPACE/0426030063_B/.venv}"
PYTHON="${PYTHON:-${VENV}/bin/python}"

# Emergency quarantine mode: no archived commerce LoRA passed the factuality
# gate. final is byte-identical to checkpoint-1782; checkpoint-1100 and
# checkpoint-1750 also failed live validation. Serve the base model only so
# the rejected aliases fail closed instead of returning fabricated commerce data.
readonly MODEL="google/gemma-2-27b-it"
readonly BASE_SERVED_MODEL_NAME="gemma-2-27b-base"
readonly LORA_NAME="edenclaw-commerce-lora"
readonly LEGACY_LORA_NAME="gemma-4-31b"
readonly BLOCKED_LORA_ADAPTER="/NHNHOME/WORKSPACE/0426030063_A/edenclaw/outputs/gemma27b-commerce-lora/final"
readonly -a REJECTED_LORA_ADAPTERS=(
  "${BLOCKED_LORA_ADAPTER}"
  "/NHNHOME/WORKSPACE/0426030063_A/edenclaw/outputs/gemma27b-commerce-lora/checkpoint-1782"
  "/NHNHOME/WORKSPACE/0426030063_A/edenclaw/outputs/gemma27b-commerce-lora/checkpoint-1100"
  "/NHNHOME/WORKSPACE/0426030063_A/edenclaw/outputs/gemma27b-commerce-lora/checkpoint-1750"
)
readonly CHAT_TEMPLATE="/NHNHOME/WORKSPACE/0426030063_A/edenclaw/edenclaw-ai/scripts/gemma2-system-fold-chat-template.jinja"

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8080}"
readonly TENSOR_PARALLEL="4"
readonly CUDA_VISIBLE_DEVICES="0,1,2,3"
MAX_MODEL_LEN="${MAX_MODEL_LEN:-8192}"
GPU_MEMORY_UTILIZATION="${GPU_MEMORY_UTILIZATION:-0.90}"
DTYPE="${DTYPE:-bfloat16}"
MAX_LORAS="${MAX_LORAS:-2}"
MAX_CPU_LORAS="${MAX_CPU_LORAS:-2}"
MAX_LORA_RANK="${MAX_LORA_RANK:-32}"
ENFORCE_EAGER="${ENFORCE_EAGER:-1}"
DISABLE_CUSTOM_ALL_REDUCE="${DISABLE_CUSTOM_ALL_REDUCE:-1}"

ROOT_DIR="/NHNHOME/WORKSPACE/0426030063_A/edenclaw"
RUNTIME_DIR="${RUNTIME_DIR:-${ROOT_DIR}/tmp/vllm-runtime}"
TMPDIR="${TMPDIR:-${RUNTIME_DIR}/tmp}"
XDG_CACHE_HOME="${XDG_CACHE_HOME:-${RUNTIME_DIR}/xdg-cache}"
TRITON_CACHE_DIR="${TRITON_CACHE_DIR:-${RUNTIME_DIR}/triton-cache}"
TORCHINDUCTOR_CACHE_DIR="${TORCHINDUCTOR_CACHE_DIR:-${RUNTIME_DIR}/torchinductor-cache}"
HF_HOME="${HF_HOME:-/home/shinseohee/.cache/huggingface}"
HF_HUB_CACHE="${HF_HUB_CACHE:-${HF_HOME}/hub}"
HUGGINGFACE_HUB_CACHE="${HUGGINGFACE_HUB_CACHE:-${HF_HUB_CACHE}}"
TRANSFORMERS_CACHE="${TRANSFORMERS_CACHE:-${HF_HUB_CACHE}}"
HF_HUB_OFFLINE="${HF_HUB_OFFLINE:-1}"
TRANSFORMERS_OFFLINE="${TRANSFORMERS_OFFLINE:-1}"
LOG_DIR="${LOG_DIR:-${ROOT_DIR}/logs/vllm}"
LOG_FILE="${LOG_FILE:-${LOG_DIR}/vllm-lora-31b.log}"
PID_FILE="${PID_FILE:-${ROOT_DIR}/vllm-lora.pid}"
RUNNER_FILE="${RUNNER_FILE:-${LOG_DIR}/run-vllm-lora-31b.sh}"
MODELS_FILE="${MODELS_FILE:-${LOG_DIR}/models-current.json}"
SMOKE_REQUEST_FILE="${SMOKE_REQUEST_FILE:-${LOG_DIR}/smoke-request-current.json}"
SMOKE_RESPONSE_FILE="${SMOKE_RESPONSE_FILE:-${LOG_DIR}/smoke-response-current.json}"
READY_TIMEOUT_SEC="${READY_TIMEOUT_SEC:-600}"
SMOKE_TIMEOUT_SEC="${SMOKE_TIMEOUT_SEC:-600}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

if [[ "${1:-}" != "--confirm" ]]; then
  cat <<EOF
SAFETY: This script restarts the local model server on port ${PORT}.
It will stop any process currently listening on that port.

Model        : ${MODEL}
Mode         : BASE-ONLY QUARANTINE
Base name    : ${BASE_SERVED_MODEL_NAME}
Blocked alias: ${LORA_NAME}, ${LEGACY_LORA_NAME} (not served)
Blocked final: ${BLOCKED_LORA_ADAPTER}
Chat template: ${CHAT_TEMPLATE}
TP / GPUs    : ${TENSOR_PARALLEL} / CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES}
Runtime flags: ENFORCE_EAGER=${ENFORCE_EAGER}, DISABLE_CUSTOM_ALL_REDUCE=${DISABLE_CUSTOM_ALL_REDUCE}
Runtime cache: ${RUNTIME_DIR}
HF cache     : ${HF_HUB_CACHE}

To proceed: $0 --confirm
EOF
  exit 1
fi

[[ -x "${PYTHON}" ]] || { echo "ERROR: Python not found: ${PYTHON}" >&2; exit 1; }
[[ -f "${CHAT_TEMPLATE}" ]] || { echo "ERROR: chat template missing: ${CHAT_TEMPLATE}" >&2; exit 1; }

mkdir -p "${LOG_DIR}" "${TMPDIR}" "${XDG_CACHE_HOME}" "${TRITON_CACHE_DIR}" "${TORCHINDUCTOR_CACHE_DIR}" "${HF_HOME}" "${HF_HUB_CACHE}"

is_vllm_server_pid() {
  local pid="$1"
  [[ -r "/proc/${pid}/cmdline" ]] &&
    tr '\0' ' ' < "/proc/${pid}/cmdline" | grep -q 'vllm.entrypoints.openai.api_server'
}

log "Stopping existing server on port ${PORT}..."
mapfile -t PORT_PIDS < <(lsof -t -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | sort -u || true)
if [[ -f "${PID_FILE}" ]]; then
  OLD_PID="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if [[ -n "${OLD_PID}" ]] && kill -0 "${OLD_PID}" 2>/dev/null; then
    PORT_PIDS+=("${OLD_PID}")
  fi
fi

if (( ${#PORT_PIDS[@]} > 0 )); then
  mapfile -t UNIQUE_PIDS < <(printf '%s\n' "${PORT_PIDS[@]}" | awk 'NF && !seen[$0]++')
  for pid in "${UNIQUE_PIDS[@]}"; do
    if ! is_vllm_server_pid "${pid}"; then
      log "ERROR: refusing to terminate non-vLLM PID ${pid} while preserving Track 5 services."
      exit 1
    fi
    log "  TERM PID ${pid}"
    kill -TERM "${pid}" 2>/dev/null || true
  done
  sleep 5
  for pid in "${UNIQUE_PIDS[@]}"; do
    if kill -0 "${pid}" 2>/dev/null; then
      log "  KILL PID ${pid}"
      kill -KILL "${pid}" 2>/dev/null || true
    fi
  done
else
  log "  No listener found on port ${PORT}."
fi

CMD=(
  "${PYTHON}" -m vllm.entrypoints.openai.api_server
  --model "${MODEL}"
  --served-model-name "${BASE_SERVED_MODEL_NAME}"
  --tensor-parallel-size "${TENSOR_PARALLEL}"
  --host "${HOST}"
  --port "${PORT}"
  --max-model-len "${MAX_MODEL_LEN}"
  --chat-template "${CHAT_TEMPLATE}"
  --dtype "${DTYPE}"
  --gpu-memory-utilization "${GPU_MEMORY_UTILIZATION}"
)

if [[ "${ENFORCE_EAGER}" != "0" ]]; then
  CMD+=(--enforce-eager)
fi

if [[ "${DISABLE_CUSTOM_ALL_REDUCE}" != "0" ]]; then
  CMD+=(--disable-custom-all-reduce)
fi

log "Starting vLLM base-only quarantine mode..."
log "  Command:"
printf '  %q' CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES}" OMP_NUM_THREADS=1 PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True "${CMD[@]}"
printf '\n'
log "  Cache: TMPDIR=${TMPDIR}, TRITON_CACHE_DIR=${TRITON_CACHE_DIR}, TORCHINDUCTOR_CACHE_DIR=${TORCHINDUCTOR_CACHE_DIR}"
log "  HF cache: HF_HOME=${HF_HOME}, HF_HUB_CACHE=${HF_HUB_CACHE}, HF_HUB_OFFLINE=${HF_HUB_OFFLINE}"
log "  Log: ${LOG_FILE}"

{
  printf '#!/usr/bin/env bash\n'
  printf 'set -euo pipefail\n'
  printf 'export CUDA_VISIBLE_DEVICES=%q\n' "${CUDA_VISIBLE_DEVICES}"
  printf 'export OMP_NUM_THREADS=%q\n' "1"
  printf 'export PYTORCH_CUDA_ALLOC_CONF=%q\n' "expandable_segments:True"
  printf 'export TMPDIR=%q\n' "${TMPDIR}"
  printf 'export XDG_CACHE_HOME=%q\n' "${XDG_CACHE_HOME}"
  printf 'export TRITON_CACHE_DIR=%q\n' "${TRITON_CACHE_DIR}"
  printf 'export TORCHINDUCTOR_CACHE_DIR=%q\n' "${TORCHINDUCTOR_CACHE_DIR}"
  printf 'export HF_HOME=%q\n' "${HF_HOME}"
  printf 'export HF_HUB_CACHE=%q\n' "${HF_HUB_CACHE}"
  printf 'export HUGGINGFACE_HUB_CACHE=%q\n' "${HUGGINGFACE_HUB_CACHE}"
  printf 'export TRANSFORMERS_CACHE=%q\n' "${TRANSFORMERS_CACHE}"
  printf 'export HF_HUB_OFFLINE=%q\n' "${HF_HUB_OFFLINE}"
  printf 'export TRANSFORMERS_OFFLINE=%q\n' "${TRANSFORMERS_OFFLINE}"
  printf 'exec'
  printf ' %q' "${CMD[@]}"
  printf '\n'
} > "${RUNNER_FILE}"
chmod +x "${RUNNER_FILE}"

setsid -f bash -c 'echo "$$" > "$1"; exec "$2"' _ "${PID_FILE}" "${RUNNER_FILE}" > "${LOG_FILE}" 2>&1
sleep 1

NEW_PID="$(cat "${PID_FILE}")"
log "vLLM base-only quarantine mode started. PID: ${NEW_PID}"
log "PID saved to ${PID_FILE}"
log "Models endpoint: http://localhost:${PORT}/v1/models"

log "Waiting for vLLM readiness and LoRA registry..."
ready=0
for ((elapsed=0; elapsed<READY_TIMEOUT_SEC; elapsed+=2)); do
  if curl -fsS --max-time 5 "http://localhost:${PORT}/v1/models" > "${MODELS_FILE}.tmp" 2>/dev/null; then
    mv "${MODELS_FILE}.tmp" "${MODELS_FILE}"
    ready=1
    break
  fi
  if ! kill -0 "${NEW_PID}" 2>/dev/null; then
    log "ERROR: vLLM exited before becoming ready. Inspect ${LOG_FILE}."
    exit 1
  fi
  sleep 2
done
if [[ "${ready}" != "1" ]]; then
  log "ERROR: vLLM did not become ready within ${READY_TIMEOUT_SEC}s."
  exit 1
fi

"${PYTHON}" - "${MODELS_FILE}" "${BASE_SERVED_MODEL_NAME}" "${LORA_NAME}" "${LEGACY_LORA_NAME}" <<'PY'
import json
import sys

models_file, base_name, primary_name, legacy_name = sys.argv[1:]
with open(models_file, encoding="utf-8") as f:
    models = {item["id"]: item for item in json.load(f)["data"]}

base = models.get(base_name)
if base is None or base.get("root") != "google/gemma-2-27b-it":
    raise SystemExit(f"Base model missing or unexpected: {base}")
for name in (primary_name, legacy_name):
    if name in models:
        raise SystemExit(f"Rejected LoRA alias is still being served: {name}")

print(f"Validated quarantine: {primary_name}, {legacy_name} absent; serving {base_name} only")
PY

cat > "${SMOKE_REQUEST_FILE}" <<JSON
{
  "model": "${BASE_SERVED_MODEL_NAME}",
  "messages": [
    {
      "role": "user",
      "content": "역할: 제공된 사실만 사용하는 상거래 검증 에이전트입니다.\n컨텍스트: 상품명=센서 A-100, 재고=3개, 가격=12,000원.\n규칙: 입력에 없는 배송 정보는 확인 불가라고 답하세요.\n질문: 상품명, 재고, 가격, 배송을 한 줄씩 답하세요."
    }
  ],
  "max_tokens": 2048,
  "temperature": 0.1
}
JSON
curl -fsS --max-time "${SMOKE_TIMEOUT_SEC}" -X POST "http://localhost:${PORT}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  --data-binary "@${SMOKE_REQUEST_FILE}" > "${SMOKE_RESPONSE_FILE}"
"${PYTHON}" - "${SMOKE_RESPONSE_FILE}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    response = json.load(f)
choice = response["choices"][0]
content = choice["message"]["content"].strip()
if not content:
    raise SystemExit("Empty smoke-test completion")
if choice.get("finish_reason") == "length":
    raise SystemExit("Smoke-test completion was truncated")
required = ("센서 A-100", "3개", "12,000원", "확인 불가")
missing = [value for value in required if value not in content]
forbidden = [
    value
    for value in (
        "샴푸",
        "$100",
        "전자제품",
        "새상품",
        "상품명=3개",
        "상품명: 3개",
        "가격=전자",
        "가격: 전자",
    )
    if value in content
]
if missing or forbidden:
    raise SystemExit(
        f"Smoke-test factuality failure: missing={missing}, forbidden={forbidden}, content={content!r}"
    )
print(f"Smoke test finish_reason={choice.get('finish_reason')}; content={content[:160]!r}")
PY
log "Base-only quarantine and user-only Gemma chat smoke test passed."
