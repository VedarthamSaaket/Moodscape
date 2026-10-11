from typing import Optional

import requests

from config import (
    logger, GROQ_API_KEY, GROQ_MODELS, NVIDIA_API_KEY, QUIZ_LLM_BASE_URL, QUIZ_LLM_MODELS,
)

GROQ_BASE_URL = "https://api.groq.com/openai/v1"


def _providers() -> list:
    chain = []
    if GROQ_API_KEY:
        chain.extend(("groq", GROQ_BASE_URL, GROQ_API_KEY, m) for m in GROQ_MODELS)
    if NVIDIA_API_KEY:
        chain.extend(("nvidia", QUIZ_LLM_BASE_URL, NVIDIA_API_KEY, m) for m in QUIZ_LLM_MODELS)
    return chain


def available() -> bool:
    return bool(_providers())


def chat(messages: list, max_tokens: int = 600, temperature: float = 0.5,
         timeout: float = 10, accept=None, limit: Optional[int] = None,
         json_mode: bool = False):
    chain = _providers()
    for provider, base_url, key, model in (chain[:limit] if limit else chain):
        body = {
            "model": model, "messages": messages,
            "temperature": temperature, "max_tokens": max_tokens,
        }
        if "gpt-oss" in model:
            body["reasoning_effort"] = "low"
        if json_mode and provider == "groq":
            body["response_format"] = {"type": "json_object"}
        try:
            res = requests.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json=body,
                timeout=timeout,
            )
            if res.status_code == 400 and "response_format" in body:
                body.pop("response_format")
                res = requests.post(
                    f"{base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {key}"},
                    json=body,
                    timeout=timeout,
                )
        except Exception as exc:
            logger.warning(f"[LLM] {provider}:{model} request failed: {exc}")
            continue
        if res.status_code != 200:
            logger.warning(f"[LLM] {provider}:{model} HTTP {res.status_code}: {res.text[:120]}")
            continue
        try:
            content = res.json()["choices"][0]["message"]["content"] or ""
        except Exception:
            content = ""
        result = accept(content) if accept else content
        if result:
            return result, f"{provider}:{model}"
        logger.warning(f"[LLM] {provider}:{model} returned an unusable reply")
    return None, None
