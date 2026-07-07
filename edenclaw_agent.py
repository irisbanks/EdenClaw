from __future__ import annotations

import os

from ai_agent_base import BaseAIAgent, estimate_cost_usd, post_json


class EdenclawAgent(BaseAIAgent):
    name = "Edenclaw AI"
    model = os.getenv("EDENCLAW_MODEL", os.getenv("LOCAL_AI_MODEL", "Qwen/Qwen2.5-72B-Instruct"))

    async def call(self, prompt: str) -> tuple[str, float]:
        self.model = os.getenv("EDENCLAW_MODEL", os.getenv("LOCAL_AI_MODEL", self.model))
        base = os.getenv("EDENCLAW_VLLM_URL", os.getenv("LOCAL_AI_BASE_URL", "http://localhost:8000/v1"))
        url = base.rstrip("/")
        if not url.endswith("/chat/completions"):
            url = f"{url}/chat/completions"
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": "You are Edenclaw AI. Return compact JSON only.",
                },
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.2,
            "max_tokens": 900,
        }
        data = await post_json(url, payload, timeout=35.0)
        text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        return str(text).strip(), estimate_cost_usd(prompt, str(text), 0.0, 0.0)
