from __future__ import annotations

import os

import httpx

from ai_agent_base import BaseAIAgent, estimate_cost_usd, post_json, require_env


class GPTAgent(BaseAIAgent):
    name = "GPT-5.5"
    model = os.getenv("OPENAI_MODEL", "gpt-5.5")

    async def call(self, prompt: str) -> tuple[str, float]:
        self.model = os.getenv("OPENAI_MODEL", self.model)
        api_key = require_env("OPENAI_API_KEY")
        fallback = os.getenv("OPENAI_FALLBACK_MODEL", "gpt-4o")
        tried: list[str] = []
        last_error = ""
        for model in dict.fromkeys([self.model, fallback]):
            tried.append(model)
            payload = {
                "model": model,
                "input": prompt,
                "text": {"format": {"type": "text"}},
            }
            if model.startswith("gpt-5"):
                payload["reasoning"] = {"effort": os.getenv("OPENAI_REASONING_EFFORT", "low")}
            try:
                data = await post_json(
                    "https://api.openai.com/v1/responses",
                    payload,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    timeout=35.0,
                )
                text = data.get("output_text") or extract_responses_text(data)
                self.model = model
                in_cost, out_cost = (1.75, 14.0) if model.startswith("gpt-5") else (2.5, 10.0)
                return text, estimate_cost_usd(prompt, text, in_cost, out_cost)
            except httpx.HTTPStatusError as exc:
                last_error = f"{model}: {exc.response.status_code} {exc.response.text[:300]}"
                if exc.response.status_code not in {400, 404}:
                    raise
        raise RuntimeError(f"OpenAI models failed ({', '.join(tried)}): {last_error}")


def extract_responses_text(data: dict) -> str:
    chunks: list[str] = []
    for item in data.get("output", []) or []:
        for content in item.get("content", []) or []:
            if isinstance(content, dict) and content.get("text"):
                chunks.append(str(content["text"]))
    return "\n".join(chunks).strip()
