"""Circuit chat agent — Groq tool-calling (default) with Conduit-style fallbacks."""
from __future__ import annotations

import json
import os
import re
from typing import Any, AsyncIterator

from groq import AsyncGroq, APIStatusError
from sqlalchemy.orm import Session

_DEFAULT_MODEL = "llama-3.3-70b-versatile"
_TOOL_MODELS = {
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "llama-3.1-70b-versatile",
}

_FUNC_RE = re.compile(r"<function=(\w+)[^{]*(\{.*?\})\s*(?:</function>)?", re.DOTALL)


def resolve_agent_provider() -> str | None:
    pref = os.getenv("CIRCUIT_AGENT_PROVIDER", "").strip().lower()
    has_groq = bool(os.getenv("GROQ_API_KEY", "").strip())
    has_anthropic = bool(os.getenv("ANTHROPIC_API_KEY", "").strip())
    if pref == "groq" and has_groq:
        return "groq"
    if pref == "anthropic" and has_anthropic:
        return "anthropic"
    if pref and pref not in ("groq", "anthropic"):
        return None
    if has_groq:
        return "groq"
    if has_anthropic:
        return "anthropic"
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
            args = json.loads(args_str)
        except json.JSONDecodeError:
            continue
        calls.append({"name": name, "args": args})
    return calls


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
    groq_messages: list[dict[str, Any]] = [{"role": "system", "content": system}] + messages
    groq_tools = anthropic_tools_to_groq(tools)
    use_tools = model in _TOOL_MODELS

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
        response = await client.chat.completions.create(**create_kwargs)
        choice = response.choices[0]
    except APIStatusError as exc:
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
        stream = await client.chat.completions.create(
            model=model,
            messages=groq_messages,
            max_tokens=1024,
            temperature=0.7,
            stream=True,
        )
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
        stream = await client.chat.completions.create(
            model=model,
            messages=groq_messages,
            max_tokens=1024,
            temperature=0.7,
            stream=True,
        )
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
