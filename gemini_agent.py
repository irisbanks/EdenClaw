from __future__ import annotations

import asyncio
import os
from urllib.parse import quote

import httpx

from ai_agent_base import BaseAIAgent, estimate_cost_usd, post_json, require_env


class GeminiAgent(BaseAIAgent):
    name = "Gemini"
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-pro")

    async def call(self, prompt: str) -> tuple[str, float]:
        self.model = os.getenv("GEMINI_MODEL", self.model)
        api_key = require_env("GEMINI_API_KEY")
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{quote(self.model, safe='')}:generateContent?key={api_key}"
        )
        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 4096,
                "responseMimeType": "application/json",
            },
        }
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                data = await post_json(url, payload, timeout=45.0)
                break
            except httpx.HTTPStatusError as exc:
                last_error = exc
                if exc.response.status_code not in {429, 500, 502, 503, 504} or attempt == 2:
                    raise
                await asyncio.sleep(1.5 * (attempt + 1))
        else:
            raise last_error or RuntimeError("Gemini request failed")
        text = ""
        for candidate in data.get("candidates", []) or []:
            for part in candidate.get("content", {}).get("parts", []) or []:
                text += str(part.get("text") or "")
        cost = estimate_cost_usd(prompt, text, 1.25, 10.0)
        return text.strip(), cost
