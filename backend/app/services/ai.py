from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)

_IST = ZoneInfo("Asia/Kolkata")

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


def suggest_task_defaults(text: str, context: str | None = None) -> dict:
    groq_key = os.getenv("GROQ_API_KEY", "")
    if groq_key:
        try:
            return _suggest_with_groq(text, context, groq_key)
        except Exception as exc:
            log.warning("Groq task suggestion failed, falling back to heuristics: %s", exc)
    return _suggest_heuristic(text, context)


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


def _clamp01(value: Any, fallback: float) -> float:
    try:
        return round(max(0.0, min(1.0, float(value))), 2)
    except (TypeError, ValueError):
        return fallback


def _int_range(value: Any, fallback: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(value)))
    except (TypeError, ValueError):
        return fallback


def _valid_choice(value: Any, allowed: set[str], fallback: str) -> str:
    if isinstance(value, str) and value in allowed:
        return value
    return fallback


def _first_tiny_step(text: str) -> str:
    lower = text.lower()
    if any(w in lower for w in ("reply", "email", "message", "dm")):
        return "Open the thread and write the first sentence."
    if any(w in lower for w in ("call", "phone")):
        return "Find the contact and start the call."
    if any(w in lower for w in ("write", "draft", "doc", "deck")):
        return "Open the document and add a rough heading."
    if any(w in lower for w in ("code", "build", "fix", "debug", "implement", "test")):
        return "Open the relevant file and reproduce the current state."
    if any(w in lower for w in ("buy", "pick up", "groceries", "errand")):
        return "Check what you need before leaving."
    return "Do the first visible two-minute step."


def _suggest_heuristic(text: str, context: str | None = None) -> dict:
    classified = _classify_heuristic(text, context)
    full = f"{text} {context or ''}".lower()
    effort = classified["effort"]
    healthy = any(w in full for w in ("health", "workout", "exercise", "walk", "run", "stretch", "sleep", "meditat"))
    blocks = any(w in full for w in ("block", "unblock", "dependency", "launch", "release", "client", "deadline"))
    dread = any(w in full for w in ("dread", "avoid", "anxious", "scary", "awkward", "hard to start"))
    easy = effort == "low" or any(w in full for w in ("quick", "simple", "easy", "tiny", "small", "5 min", "10 min"))
    deep = any(w in full for w in ("deep", "focus", "write", "code", "design", "research", "analyze", "analyse", "strategy"))
    admin = effort == "low" or any(w in full for w in ("admin", "email", "reply", "schedule", "book", "pay", "file"))
    focus_type = (
        "shallow" if classified["tag"] == "social"
        else "deep" if deep and effort == "high"
        else "admin" if admin
        else "shallow"
    )
    return {
        **classified,
        "duration": 15 if effort == "low" else 90 if effort == "high" and focus_type == "deep" else 30,
        "deadline_type": "hard" if classified["urgency"] >= 0.75 or "deadline" in full else "none",
        "time_sensitivity": classified["urgency"],
        "scheduled_at": None,
        "recurrence": None,
        "recurrence_ends_at": None,
        "post_blackout_behavior": "resume",
        "emotional_resistance": _clamp01(0.75 if dread else 0.25 if healthy else 0.45, 0.45),
        "activation_energy": _clamp01(0.25 if easy else 0.7 if effort == "high" else 0.5, 0.5),
        "recovery_cost": _clamp01(0.55 if effort == "high" else 0.2 if effort == "low" else 0.35, 0.35),
        "focus_type": focus_type,
        "consequence_of_delay": _clamp01(0.75 if classified["urgency"] > 0.7 or blocks else 0.35, 0.35),
        "momentum_value": _clamp01(0.85 if blocks else 0.65 if classified["urgency"] > 0.7 else 0.5, 0.5),
        "compound_benefit": _clamp01(0.7 if blocks or healthy else 0.35, 0.35),
        "identity_alignment": _clamp01(0.85 if healthy else 0.4, 0.4),
        "energy_to_reward_ratio": _clamp01(0.75 if healthy else 0.45 if effort == "high" else 0.6, 0.6),
        "task_decomposition_potential": _clamp01(0.7 if effort == "high" else 0.3, 0.3),
        "tiny_step": _first_tiny_step(text),
        "preferred_execution_window": "morning" if focus_type == "deep" else None,
        "location_dependency": "away" if any(w in full for w in ("errand", "buy", "pick up", "store", "shop")) else None,
        "required_resources": [],
        "dependencies": [],
        "blackout_skip_flags": [],
        "travel_buffer_before_mins": None,
        "travel_buffer_after_mins": None,
        "notifications_enabled": True,
        "notification_offset_1_mins": 10,
        "notification_offset_2_mins": None,
    }


def _normalize_suggestion(raw: dict[str, Any], text: str, context: str | None) -> dict:
    fallback = _suggest_heuristic(text, context)
    tag = _valid_choice(raw.get("tag"), {"general", "work", "social", "later", "errand", "shopping", "travel"}, fallback["tag"])
    effort = _valid_choice(raw.get("effort"), {"low", "medium", "high"}, fallback["effort"])
    focus_type = _valid_choice(raw.get("focus_type"), {"shallow", "deep", "admin", "creative"}, fallback["focus_type"])
    post_blackout = _valid_choice(
        raw.get("post_blackout_behavior"),
        {"resume", "catch_up", "catch_up_once", "catch_up_immediate", "catch_up_imm_shift"},
        "resume",
    )
    scheduled_at = raw.get("scheduled_at")
    if scheduled_at is not None:
        try:
            scheduled_at = int(scheduled_at)
        except (TypeError, ValueError):
            scheduled_at = None
    def string_list(name: str) -> list[str]:
        value = raw.get(name)
        return [str(v) for v in value if isinstance(v, str)] if isinstance(value, list) else []
    return {
        "tag": tag,
        "urgency": _clamp01(raw.get("urgency"), fallback["urgency"]),
        "importance": _clamp01(raw.get("importance"), fallback["importance"]),
        "cognitive_load": _clamp01(raw.get("cognitive_load"), fallback["cognitive_load"]),
        "effort": effort,
        "duration": _int_range(raw.get("duration"), fallback["duration"], 5, 720),
        "deadline_type": _valid_choice(raw.get("deadline_type"), {"none", "soft", "hard"}, fallback["deadline_type"]),
        "time_sensitivity": _clamp01(raw.get("time_sensitivity"), fallback["time_sensitivity"]),
        "scheduled_at": scheduled_at,
        "recurrence": raw.get("recurrence") if isinstance(raw.get("recurrence"), str) else None,
        "recurrence_ends_at": raw.get("recurrence_ends_at") if isinstance(raw.get("recurrence_ends_at"), int) else None,
        "post_blackout_behavior": post_blackout,
        "emotional_resistance": _clamp01(raw.get("emotional_resistance"), fallback["emotional_resistance"]),
        "activation_energy": _clamp01(raw.get("activation_energy"), fallback["activation_energy"]),
        "recovery_cost": _clamp01(raw.get("recovery_cost"), fallback["recovery_cost"]),
        "focus_type": focus_type,
        "consequence_of_delay": _clamp01(raw.get("consequence_of_delay"), fallback["consequence_of_delay"]),
        "momentum_value": _clamp01(raw.get("momentum_value"), fallback["momentum_value"]),
        "compound_benefit": _clamp01(raw.get("compound_benefit"), fallback["compound_benefit"]),
        "identity_alignment": _clamp01(raw.get("identity_alignment"), fallback["identity_alignment"]),
        "energy_to_reward_ratio": _clamp01(raw.get("energy_to_reward_ratio"), fallback["energy_to_reward_ratio"]),
        "task_decomposition_potential": _clamp01(raw.get("task_decomposition_potential"), fallback["task_decomposition_potential"]),
        "tiny_step": str(raw.get("tiny_step") or fallback["tiny_step"])[:500],
        "preferred_execution_window": raw.get("preferred_execution_window") if isinstance(raw.get("preferred_execution_window"), str) else fallback["preferred_execution_window"],
        "location_dependency": raw.get("location_dependency") if isinstance(raw.get("location_dependency"), str) else fallback["location_dependency"],
        "required_resources": string_list("required_resources"),
        "dependencies": string_list("dependencies"),
        "blackout_skip_flags": [v for v in string_list("blackout_skip_flags") if v in {"travelling", "period", "sickness", "leave", "wfh"}],
        "travel_buffer_before_mins": raw.get("travel_buffer_before_mins") if isinstance(raw.get("travel_buffer_before_mins"), int) else None,
        "travel_buffer_after_mins": raw.get("travel_buffer_after_mins") if isinstance(raw.get("travel_buffer_after_mins"), int) else None,
        "notifications_enabled": bool(raw.get("notifications_enabled", fallback["notifications_enabled"])),
        "notification_offset_1_mins": raw.get("notification_offset_1_mins") if isinstance(raw.get("notification_offset_1_mins"), int) else 10,
        "notification_offset_2_mins": raw.get("notification_offset_2_mins") if isinstance(raw.get("notification_offset_2_mins"), int) else None,
        "reasoning": str(raw.get("reasoning") or fallback["reasoning"])[:1000],
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


def _suggest_with_groq(text: str, context: str | None, api_key: str) -> dict:
    from groq import Groq

    client = Groq(api_key=api_key)
    now = datetime.now(_IST).isoformat(timespec="minutes")
    prompt = (
        f"Current time in Asia/Kolkata: {now}\n"
        f"Task/event name: {text}\n"
        + (f"Context: {context}\n" if context else "")
        + "\nInfer practical defaults for a new Circuit task. "
        "Use null when a date/time is not clearly implied. "
        "scheduled_at and recurrence_ends_at must be Unix epoch milliseconds or null. "
        "Respond with JSON only using these exact keys:\n"
        '{"tag":"general|work|social|later|errand|shopping|travel",'
        '"urgency":0-1,"importance":0-1,"cognitive_load":0-1,'
        '"effort":"low|medium|high","duration":minutes,'
        '"deadline_type":"none|soft|hard","time_sensitivity":0-1,'
        '"scheduled_at":null,"recurrence":null,"recurrence_ends_at":null,'
        '"post_blackout_behavior":"resume|catch_up|catch_up_once|catch_up_immediate|catch_up_imm_shift",'
        '"emotional_resistance":0-1,"activation_energy":0-1,"recovery_cost":0-1,'
        '"focus_type":"shallow|deep|admin|creative",'
        '"consequence_of_delay":0-1,"momentum_value":0-1,"compound_benefit":0-1,'
        '"identity_alignment":0-1,"energy_to_reward_ratio":0-1,'
        '"task_decomposition_potential":0-1,"tiny_step":"...",'
        '"preferred_execution_window":null,"location_dependency":null,'
        '"required_resources":[],"dependencies":[],"blackout_skip_flags":[],'
        '"travel_buffer_before_mins":null,"travel_buffer_after_mins":null,'
        '"notifications_enabled":true,"notification_offset_1_mins":10,'
        '"notification_offset_2_mins":null,"reasoning":"..."}'
    )
    response = client.chat.completions.create(
        model=os.getenv("CIRCUIT_TASK_SUGGEST_MODEL", "llama-3.1-8b-instant"),
        max_tokens=700,
        temperature=0.2,
        messages=[
            {
                "role": "system",
                "content": (
                    "You choose deterministic defaults for a personal task planner. "
                    "Prefer conservative values and concise JSON. No markdown."
                ),
            },
            {"role": "user", "content": prompt},
        ],
    )
    raw = response.choices[0].message.content.strip()
    if "```" in raw:
        raw = raw.split("```")[1].lstrip("json").strip()
    return _normalize_suggestion(json.loads(raw), text, context)
