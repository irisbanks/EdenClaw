import argparse
import json

import torch
from datasets import Dataset
from peft import LoraConfig, get_peft_model
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    DataCollatorForLanguageModeling,
    Trainer,
    TrainingArguments,
)


def parse_args():
    parser = argparse.ArgumentParser(description="Fine-tune one Edenclaw agent LoRA adapter.")
    parser.add_argument("--data_dir", required=True)
    parser.add_argument("--output_dir", required=True)
    parser.add_argument("--base_model", default="Qwen/Qwen2.5-72B-Instruct")
    parser.add_argument("--lora_r", type=int, default=16)
    parser.add_argument("--lora_alpha", type=int, default=32)
    parser.add_argument("--lora_dropout", type=float, default=0.05)
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--epochs", type=float, default=3)
    parser.add_argument("--batch_size", type=int, default=2)
    parser.add_argument("--grad_accum", type=int, default=8)
    parser.add_argument("--bf16", action="store_true")
    return parser.parse_args()


def load_messages(data_dir):
    train_path = data_dir.rstrip("/") + "/train.jsonl"
    rows = []
    with open(train_path, "r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            messages = record.get("messages")
            if not messages:
                raise ValueError(f"{train_path}:{line_no} missing non-empty messages field")
            rows.append({"messages": messages})
    if not rows:
        raise ValueError(f"{train_path} contains no training rows")
    return rows


def main():
    args = parse_args()

    tokenizer = AutoTokenizer.from_pretrained(
        args.base_model,
        trust_remote_code=True,
        use_fast=True,
    )
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    rows = load_messages(args.data_dir)
    dataset = Dataset.from_list(rows)

    def tokenize(example):
        text = tokenizer.apply_chat_template(
            example["messages"],
            tokenize=False,
            add_generation_prompt=False,
        )
        return tokenizer(
            text,
            max_length=2048,
            truncation=True,
            padding=False,
        )

    tokenized = dataset.map(
        tokenize,
        remove_columns=dataset.column_names,
        desc="Tokenizing chat samples",
    )

    model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        device_map={"": 0},
        torch_dtype=torch.bfloat16,
        trust_remote_code=True,
    )
    model.config.use_cache = False
    model.gradient_checkpointing_enable()
    model.enable_input_require_grads()

    lora_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        target_modules=[
            "q_proj",
            "k_proj",
            "v_proj",
            "o_proj",
            "gate_proj",
            "up_proj",
            "down_proj",
        ],
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    training_args = TrainingArguments(
        output_dir=args.output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        bf16=args.bf16,
        save_strategy="epoch",
        save_total_limit=1,
        warmup_ratio=0.03,
        lr_scheduler_type="cosine",
        optim="adamw_torch",
        gradient_checkpointing=True,
        logging_steps=10,
        report_to="none",
        remove_unused_columns=False,
    )

    data_collator = DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False)
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized,
        data_collator=data_collator,
    )

    trainer.train()
    model.save_pretrained(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)
    print("DONE")


if __name__ == "__main__":
    main()
