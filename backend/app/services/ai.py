from __future__ import annotations

import json
import logging
import os

log = logging.getLogger(__name__)

_URGENT_WORDS = {"urgent", "asap", "today", "now", "immediately", "critical", "deadline", "overdue", "emergency"}
_IMPORTANT_WORDS = {"important", "key", "essential", "must", "priority", "vital", "crucial", "critical"}
_WORK_WORDS = {"write", "code", "build", "design", "review", "report", "meeting", "email", "presentation", "project", "ticket", "deploy", "fix", "debug", "implement", "develop", "test", "research", "analyze"}
_SOCIAL_WORDS = {"call", "meet", "lunch", "dinner", "coffee", "friend", "family", "party", "visit", "chat", "talk", "catch"}
_LATER_WORDS = {"someday", "maybe", "eventually", "later", "backlog", "wishlist"}
_EASY_WORDS = {"quick", "simple", "easy", "brief", "small", "minor"}
_HARD_WORDS = {"complex", "difficult", "hard", "thorough", "comprehensive", "refactor", "redesign", "multiple", "several", "extensive"}


def classify_task(text: str, context: str | None = None) -> dict:
    groq_key = os.getenv("GROQ_API_KEY", "")
    if groq_key:
        try:
            return _classify_with_groq(text, context, groq_key)
        except Exception as exc:
            log.warning("Groq classify failed, falling back to heuristics: %s", exc)
    return _classify_heuristic(text, context)


def _classify_heuristic(text: str, context: str | None = None) -> dict:
    words = set(text.lower().split())
    full = (text + " " + (context or "")).lower()

    urgency = 0.8 if words & _URGENT_WORDS else 0.5
    if any(p in full for p in ("by tomorrow", "by today", "due today", "due tomorrow", "end of day", "eod")):
        urgency = max(urgency, 0.75)

    importance = 0.8 if words & _IMPORTANT_WORDS else 0.5

    if words & _SOCIAL_WORDS or "catch up" in full or "check in" in full:
        tag = "social"
    elif words & _WORK_WORDS or "follow up" in full:
        tag = "work"
    elif words & _LATER_WORDS:
        tag = "later"
    else:
        tag = "general"

    if words & _EASY_WORDS or any(p in full for p in ("5 min", "10 min", "quick check", "quick call")):
        effort = "low"
    elif words & _HARD_WORDS:
        effort = "high"
    else:
        effort = "medium"

    cognitive_load = {"low": 0.3, "medium": 0.5, "high": 0.7}[effort]
    if len(text.split()) > 15:
        cognitive_load = min(1.0, cognitive_load + 0.1)

    reasons: list[str] = []
    if urgency > 0.6:
        reasons.append("urgency markers found")
    if importance > 0.6:
        reasons.append("importance markers found")
    reasons.append(f"classified as {tag} ({effort} effort)")

    return {
        "urgency": round(urgency, 2),
        "importance": round(importance, 2),
        "cognitive_load": round(cognitive_load, 2),
        "effort": effort,
        "tag": tag,
        "reasoning": "; ".join(reasons),
    }


def _classify_with_groq(text: str, context: str | None, api_key: str) -> dict:
    from groq import Groq

    client = Groq(api_key=api_key)
    prompt = (
        f"Task: {text}\n"
        + (f"Context: {context}\n" if context else "")
        + "\nClassify this task. Respond with a JSON object containing these exact keys:\n"
        '{"urgency": 0-1, "importance": 0-1, "cognitive_load": 0-1, '
        '"effort": "low"|"medium"|"high", "tag": "general"|"work"|"social"|"later", "reasoning": "..."}'
    )
    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        max_tokens=200,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a task classification assistant. "
                    "Analyze tasks and return structured classification JSON only. "
                    "No other text."
                ),
            },
            {"role": "user", "content": prompt},
        ],
    )
    raw = response.choices[0].message.content.strip()
    # Extract JSON if wrapped in code block
    if "```" in raw:
        raw = raw.split("```")[1].lstrip("json").strip()
    data = json.loads(raw)
    return {
        "urgency": float(data.get("urgency", 0.5)),
        "importance": float(data.get("importance", 0.5)),
        "cognitive_load": float(data.get("cognitive_load", 0.5)),
        "effort": data.get("effort", "medium"),
        "tag": data.get("tag", "general"),
        "reasoning": str(data.get("reasoning", "")),
    }
