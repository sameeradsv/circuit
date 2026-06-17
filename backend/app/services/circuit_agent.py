"""Circuit chat agent — Groq tool-calling (default) with Conduit-style fallbacks."""
from __future__ import annotations

import json
import os
import re
from typing import Any, AsyncIterator

from groq import AsyncGroq, APIStatusError
from sqlalchemy.orm import Session

_DEFAULT_MODEL = "llama-3.3-70b-versatile"

# Models known NOT to support function/tool calling; all others assumed capable.
_NO_TOOL_MODELS: set[str] = {"llama-3.2-1b-preview", "llama-3.2-3b-preview"}

# On 429, retry through this chain after the configured model.
_FALLBACK_CHAIN = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]

# Args group is optional — some calls emit no args at all.
_FUNC_RE = re.compile(r"<function=(\w+)[^{<]*(\{.*?\})?\s*(?:</function>)?", re.DOTALL)


def resolve_agent_provider() -> str | None:
    """Groq is the only supported agent provider."""
    if os.getenv("GROQ_API_KEY", "").strip():
        return "groq"
    return None


def agent_model() -> str:
    return os.getenv("CIRCUIT_AGENT_MODEL", _DEFAULT_MODEL).strip() or _DEFAULT_MODEL


def _client() -> AsyncGroq:
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set")
    return AsyncGroq(api_key=api_key)


def anthropic_tools_to_groq(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["input_schema"],
            },
        }
        for t in tools
    ]


def _parse_failed_generation(body: dict) -> list[dict]:
    fg = (body.get("error") or {}).get("failed_generation", "")
    calls = []
    for name, args_str in _FUNC_RE.findall(fg):
        try:
            args = json.loads(args_str) if args_str else {}
        except json.JSONDecodeError:
            continue
        calls.append({"name": name, "args": args})
    return calls


async def _create_with_fallback(
    client: AsyncGroq, chain: list[str], kwargs: dict
) -> tuple:
    """Try each model in chain on 429. Returns (response, model_used)."""
    last_exc: APIStatusError | None = None
    for model_id in chain:
        try:
            resp = await client.chat.completions.create(**{**kwargs, "model": model_id})
            return resp, model_id
        except APIStatusError as exc:
            if exc.status_code == 429:
                last_exc = exc
                continue
            raise
    raise last_exc  # type: ignore[misc]


async def stream_groq_agent(
    *,
    system: str,
    messages: list[dict[str, str]],
    tools: list[dict[str, Any]],
    execute_tool,
    db: Session,
    user_id: int,
) -> AsyncIterator[dict[str, Any]]:
    """Yield dict events: {status}, {delta}, or {error}."""
    client = _client()
    model = agent_model()
    chain = [model] + [m for m in _FALLBACK_CHAIN if m != model]
    groq_messages: list[dict[str, Any]] = [{"role": "system", "content": system}] + messages
    groq_tools = anthropic_tools_to_groq(tools)
    use_tools = model not in _NO_TOOL_MODELS

    create_kwargs: dict[str, Any] = {
        "model": model,
        "messages": groq_messages,
        "max_tokens": 1024,
        "temperature": 0.7,
        "stream": False,
    }
    if use_tools:
        create_kwargs["tools"] = groq_tools
        create_kwargs["tool_choice"] = "auto"

    try:
        response, model = await _create_with_fallback(client, chain, create_kwargs)
        choice = response.choices[0]
    except APIStatusError as exc:
        if exc.status_code == 429:
            yield {"error": "Rate limit reached on all available models. Try again later."}
            return
        if exc.status_code != 400:
            yield {"error": str(exc)}
            return
        body = exc.body if isinstance(exc.body, dict) else {}
        if (body.get("error") or {}).get("code") != "tool_use_failed":
            yield {"error": str(exc)}
            return
        parsed = _parse_failed_generation(body)
        if not parsed:
            yield {"error": str(exc)}
            return
        for tc in parsed:
            name, args = tc["name"], tc["args"]
            yield {"status": "calling_tool", "tool": name}
            result = execute_tool(name, args, db, user_id)
            groq_messages.append({
                "role": "tool",
                "tool_call_id": f"fallback_{name}",
                "content": json.dumps(result),
            })
        try:
            stream = await client.chat.completions.create(
                model=model, messages=groq_messages, max_tokens=1024, temperature=0.7, stream=True,
            )
        except APIStatusError as exc2:
            yield {"error": "Rate limit reached. Try again later." if exc2.status_code == 429 else str(exc2)}
            return
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield {"delta": delta}
        return

    if use_tools and choice.finish_reason == "tool_calls" and choice.message.tool_calls:
        tool_calls = choice.message.tool_calls
        groq_messages.append({
            "role": "assistant",
            "content": choice.message.content or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in tool_calls
            ],
        })
        for tc in tool_calls:
            yield {"status": "calling_tool", "tool": tc.function.name}
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            result = execute_tool(tc.function.name, args, db, user_id)
            groq_messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": json.dumps(result),
            })
        try:
            stream = await client.chat.completions.create(
                model=model, messages=groq_messages, max_tokens=1024, temperature=0.7, stream=True,
            )
        except APIStatusError as exc2:
            yield {"error": "Rate limit reached. Try again later." if exc2.status_code == 429 else str(exc2)}
            return
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield {"delta": delta}
        return

    content = choice.message.content or ""
    if content:
        chunk = 30
        for i in range(0, len(content), chunk):
            yield {"delta": content[i : i + chunk]}
