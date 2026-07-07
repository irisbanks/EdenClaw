#!/usr/bin/env python3
# CPU-only, single-shot factuality probe for the commerce LoRA at checkpoint-1100.
#
# Hard constraints (operator directive 2026-05-23):
#   - GPU에 단 1MB의 간섭도 주지 않는다 -> CUDA_VISIBLE_DEVICES="" 강제, .to("cuda") 금지.
#   - 외부 vLLM (port 8080, PID 1182003~6) 과 그 별칭 404 상태에 일체 영향 없음.
#   - MyTradeBotGPU/scripts 및 Track 5 프로세스에 무간섭 (스레드 수 16개로 제한).
#   - restart-vllm-lora-mode.sh 본문은 수정하지 않는다.
#   - LoRA 어댑터 경로는 checkpoint-1100 만 사용한다 (rejected list 상태 그대로 둠).
import os

# CPU 격리: torch import 이전에 환경 변수 고정.
os.environ["CUDA_VISIBLE_DEVICES"] = ""
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ.setdefault("HF_HOME", "/home/shinseohee/.cache/huggingface")
os.environ["OMP_NUM_THREADS"] = "16"
os.environ["MKL_NUM_THREADS"] = "16"
os.environ["OPENBLAS_NUM_THREADS"] = "16"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import json
import sys
import time
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

torch.set_num_threads(16)
torch.set_num_interop_threads(4)

BASE_MODEL = "google/gemma-2-27b-it"
LORA_PATH = "/NHNHOME/WORKSPACE/0426030063_A/edenclaw/outputs/gemma27b-commerce-lora/checkpoint-1100"
LOG_DIR = Path("/NHNHOME/WORKSPACE/0426030063_A/edenclaw/logs/probe-cpu-1100")
LOG_DIR.mkdir(parents=True, exist_ok=True)
RAW_PATH = LOG_DIR / "raw-response.json"
META_PATH = LOG_DIR / "verdict.json"

# 정확히 사용자가 지정한 '센서 A-100' 프로브, user 단일 롤.
USER_PROMPT = (
    "너는 에덴클로우 자율 상거래 에이전트다. "
    "상품: 센서 A-100 (원가 $2000), 상태: 희소성 9점, 환경: 가스비 폭등 3% 발생. "
    "상대방이 원가인 $2000을 제안했을 때, 이익 마진과 가스비를 방어하는 논리적 추론(Reasoning)과 "
    "최종 호가(COUNTER_OFFER)를 JSON으로 출력하라."
)


def stamp() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def main() -> int:
    if torch.cuda.is_available():
        # CUDA_VISIBLE_DEVICES="" 면 is_available()이 False여야 한다. 만일을 위해 차단.
        print(f"[{stamp()}] FATAL: CUDA still visible — CPU isolation broken", flush=True)
        return 2

    assert Path(LORA_PATH, "adapter_config.json").is_file(), f"LoRA missing: {LORA_PATH}"

    print(f"[{stamp()}] CPU-only probe start (threads=16, dtype=bf16)", flush=True)
    print(f"[{stamp()}] base={BASE_MODEL}", flush=True)
    print(f"[{stamp()}] lora={LORA_PATH}", flush=True)

    t0 = time.time()
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
    t1 = time.time()
    print(f"[{stamp()}] tokenizer loaded in {t1 - t0:.1f}s", flush=True)

    base = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        torch_dtype=torch.bfloat16,
        device_map="cpu",
        low_cpu_mem_usage=True,
    )
    t2 = time.time()
    print(f"[{stamp()}] base loaded in {t2 - t1:.1f}s (RAM only)", flush=True)

    model = PeftModel.from_pretrained(base, LORA_PATH, is_trainable=False)
    model.eval()
    t3 = time.time()
    print(f"[{stamp()}] LoRA attached in {t3 - t2:.1f}s", flush=True)

    messages = [{"role": "user", "content": USER_PROMPT}]
    prompt_text = tokenizer.apply_chat_template(
        messages,
        add_generation_prompt=True,
        tokenize=False,
    )
    enc = tokenizer(prompt_text, return_tensors="pt", add_special_tokens=False)
    input_ids = enc["input_ids"]
    print(f"[{stamp()}] generating (max_new_tokens=512, temperature=0.1)", flush=True)
    print(f"[{stamp()}] rendered prompt:\n{prompt_text}", flush=True)

    gen_start = time.time()
    with torch.inference_mode():
        out = model.generate(
            input_ids,
            max_new_tokens=512,
            do_sample=True,
            temperature=0.1,
            top_p=1.0,
            pad_token_id=tokenizer.eos_token_id,
        )
    gen_end = time.time()

    completion_ids = out[0, input_ids.shape[-1]:]
    completion_text = tokenizer.decode(completion_ids, skip_special_tokens=True)
    finish_reason = "length" if completion_ids.shape[-1] >= 512 else "stop"
    elapsed_gen = gen_end - gen_start
    tok_per_s = (completion_ids.shape[-1] / elapsed_gen) if elapsed_gen > 0 else 0.0

    raw = {
        "id": "probe-cpu-1100-" + time.strftime("%Y%m%dT%H%M%S"),
        "object": "chat.completion",
        "created": int(time.time()),
        "model": "commerce-lora-1100-probe@cpu+peft (no vLLM, no GPU)",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": completion_text},
                "finish_reason": finish_reason,
            }
        ],
        "usage": {
            "prompt_tokens": int(input_ids.shape[-1]),
            "completion_tokens": int(completion_ids.shape[-1]),
            "total_tokens": int(out.shape[-1]),
        },
        "_probe_meta": {
            "lora_path": LORA_PATH,
            "base_load_s": round(t2 - t1, 2),
            "lora_attach_s": round(t3 - t2, 2),
            "generation_s": round(elapsed_gen, 2),
            "tokens_per_s": round(tok_per_s, 3),
            "threads": 16,
        },
    }
    RAW_PATH.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[{stamp()}] raw response written -> {RAW_PATH}", flush=True)

    # 사실성 판정: 입력 팩트는 (센서 A-100, $2000 원가, 희소성 9점, 가스비 3%) 뿐.
    forbidden_tokens = [
        "나이키", "Nike", "스마트워치", "갤럭시", "애플", "맥북", "아이폰",
        "삼성", "샤오미", "샴푸", "전자제품",
        "300,000원", "300000원", "₩300", "300,000 ", "200,000원",
    ]
    required_tokens = ["센서 A-100", "9", "3%"]
    forbidden_hits = [w for w in forbidden_tokens if w in completion_text]
    missing_required = [w for w in required_tokens if w not in completion_text]
    has_counter_offer = "COUNTER_OFFER" in completion_text or "counter_offer" in completion_text

    verdict = "PASS" if (not forbidden_hits and not missing_required) else "FAIL"

    verdict_obj = {
        "verdict": verdict,
        "forbidden_hits": forbidden_hits,
        "missing_required": missing_required,
        "has_counter_offer_key": has_counter_offer,
        "completion_tokens": int(completion_ids.shape[-1]),
        "finish_reason": finish_reason,
        "raw_path": str(RAW_PATH),
        "lora_path": LORA_PATH,
        "model_route": "cpu+peft, no vLLM, no GPU, no external alias",
    }
    META_PATH.write_text(json.dumps(verdict_obj, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n========== RAW RESPONSE (assistant content) ==========", flush=True)
    print(completion_text, flush=True)
    print("========== /RAW RESPONSE ==========\n", flush=True)
    print("========== VERDICT ==========", flush=True)
    print(json.dumps(verdict_obj, ensure_ascii=False, indent=2), flush=True)
    print("========== /VERDICT ==========", flush=True)
    return 0 if verdict == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
