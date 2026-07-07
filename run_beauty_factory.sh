#!/bin/bash
python3 core_scripts/train_multilora_model.py \
    --domain "cosmetics" \
    --data_path "../finetune/datasets/beauty_patent_sft_v1.jsonl" \
    --output_dir "./adapters/cosmetics/outputs/gemma27b-beauty-lora-v1"
