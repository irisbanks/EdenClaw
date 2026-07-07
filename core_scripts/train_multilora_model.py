import os
import torch
from datasets import load_dataset
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import LoraConfig, get_peft_model
from trl import SFTConfig, SFTTrainer

BASE_MODEL = "google/gemma-2-27b-it"
DATASET_PATH = "edenclaw_dataset.jsonl"
OUTPUT_DIR = "./edenclaw_beauty_brain_31b"

print("🎨 [Gemma-2-27b] 베이스 모델 4비트 양자화 로드 및 VRAM 최적화 세팅 개시...")
tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
tokenizer.pad_token = tokenizer.eos_token

bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16
)

model = AutoModelForCausalLM.from_pretrained(
    BASE_MODEL,
    quantization_config=bnb_config,
    device_map="auto"
)

print("🧠 싱거레 지식 보호를 위한 화장품 독립 LoRA 레이어 라인...")
peft_config = LoraConfig(
    r=64,
    lora_alpha=128,
    target_modules=["q_proj", "o_proj", "k_proj", "v_proj", "gate_proj", "up_proj", "down_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM"
)
model = get_peft_model(model, peft_config)

print("📊 특허 정형화 SFT 데이터셋 로드...")
dataset = load_dataset("json", data_files=DATASET_PATH, split="train")

# 최신 TRL 라이브러리 스펙 준수 (dataset_text_field 및 max_length를 내부로 통합)
training_args = SFTConfig(
    output_dir=OUTPUT_DIR,
    per_device_train_batch_size=2,
    gradient_accumulation_steps=4,
    learning_rate=2e-4,
    logging_steps=10,
    max_steps=100,
    bf16=True,
    optim="paged_adamw_8bit",
    dataset_text_field="output",
    max_length=1024
)

print("🚀 에덴클로우 뷰티 어댑터 팩토리 엔진 최종 점화!")
trainer = SFTTrainer(
    model=model,
    train_dataset=dataset,
    args=training_args
)

trainer.train()
print("✅ 멀티 LoRA 주입 완료!")
