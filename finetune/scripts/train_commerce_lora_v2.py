#!/usr/bin/env python3
# Trainer for edenclaw-commerce-lora-v2 on the freshly generated B2B SFT.
# Invoked by run_clean_lora_training.sh; NOT executed automatically.
#
# Anti-overfit profile vs v1 (which produced the 1782/1750/1100 reject set):
#   r 32 -> 16, alpha 64 -> 32         lower LoRA capacity
#   lora_dropout 0.05 -> 0.10          regularize against entropy collapse
#   num_train_epochs 3 -> 2 (cap)      stop before the U-turn at epoch ~2.5
#   early_stopping_patience = 2        on eval_loss
#   weight_decay 0 -> 0.10             explicit L2
#   learning_rate 3e-5                 small step size, slow memorization
#   load_best_model_at_end = True      checkpoint with min eval_loss is shipped
import json
import os
from pathlib import Path

import torch
from datasets import Dataset, concatenate_datasets
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer, EarlyStoppingCallback
from trl import SFTConfig, SFTTrainer

BASE_MODEL   = "google/gemma-2-27b-it"
DATASETS_DIR = Path("/NHNHOME/WORKSPACE/0426030063_A/edenclaw/edenclaw-ai/finetune/datasets")
SFT_FILES    = ["product_intake_sft.jsonl", "listing_writer_sft.jsonl", "price_agent_sft.jsonl"]
OUTPUT_DIR   = Path("/NHNHOME/WORKSPACE/0426030063_A/edenclaw/outputs/gemma27b-commerce-lora-v2")
LOG_DIR      = Path("/NHNHOME/WORKSPACE/0426030063_A/edenclaw/logs/finetune/commerce-lora-v2")
SEED         = 42


def load_dataset() -> Dataset:
    pieces = []
    for fn in SFT_FILES:
        path = DATASETS_DIR / fn
        if not path.is_file():
            raise FileNotFoundError(f"missing SFT file: {path}. "
                                    f"Run generate_b2b_commerce_dataset.py first.")
        rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
        pieces.append(Dataset.from_list(rows))
    return concatenate_datasets(pieces)


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        torch_dtype=torch.bfloat16,
        device_map="auto",
        attn_implementation="eager",
    )
    model.gradient_checkpointing_enable()

    lora_cfg = LoraConfig(
        r=16,
        lora_alpha=32,
        lora_dropout=0.10,
        bias="none",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
        task_type="CAUSAL_LM",
    )

    raw = load_dataset()
    split = raw.train_test_split(test_size=0.15, seed=SEED)
    train_ds, eval_ds = split["train"], split["test"]
    print(f"train rows = {len(train_ds)}, eval rows = {len(eval_ds)}", flush=True)

    sft_cfg = SFTConfig(
        output_dir=str(OUTPUT_DIR),
        logging_dir=str(LOG_DIR),
        num_train_epochs=2,
        per_device_train_batch_size=1,
        per_device_eval_batch_size=1,
        gradient_accumulation_steps=16,
        learning_rate=3e-5,
        warmup_ratio=0.05,
        weight_decay=0.10,
        lr_scheduler_type="cosine",
        bf16=True,
        gradient_checkpointing=True,
        eval_strategy="steps",
        eval_steps=50,
        save_strategy="steps",
        save_steps=50,
        save_total_limit=4,
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        logging_steps=10,
        report_to=[],
        seed=SEED,
        max_seq_length=2048,
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        args=sft_cfg,
        train_dataset=train_ds,
        eval_dataset=eval_ds,
        peft_config=lora_cfg,
        callbacks=[EarlyStoppingCallback(early_stopping_patience=2)],
    )

    trainer.train()
    trainer.save_model(str(OUTPUT_DIR / "final"))
    print(f"done. checkpoint shipped to {OUTPUT_DIR / 'final'}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
