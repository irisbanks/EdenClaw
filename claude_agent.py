from __future__ import annotations

import os

from ai_agent_base import BaseAIAgent, estimate_cost_usd, post_json, require_env


class ClaudeAgent(BaseAIAgent):
    name = "Claude"
    model = os.getenv("CLAUDE_MODEL", "claude-opus-4-5-20251101")

    async def call(self, prompt: str) -> tuple[str, float]:
        self.model = os.getenv("CLAUDE_MODEL", self.model)
        api_key = require_env("ANTHROPIC_API_KEY")
        payload = {
            "model": self.model,
            "max_tokens": 900,
            "temperature": 0.2,
            "messages": [{"role": "user", "content": prompt}],
        }
        data = await post_json(
            "https://api.anthropic.com/v1/messages",
            payload,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            timeout=35.0,
        )
        text = "".join(
            str(item.get("text") or "")
            for item in data.get("content", []) or []
            if isinstance(item, dict)
        )
        cost = estimate_cost_usd(prompt, text, 3.0, 15.0)
        return text.strip(), cost
