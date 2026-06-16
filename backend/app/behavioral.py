"""Behavioral learning helpers (mirrors frontend behavioral-engine)."""
from __future__ import annotations

_DEFAULT_COMPLETION_RATE = 0.7


def record_completion_rate(current: float | None) -> float:
    """EMA toward 1.0 on each completion — same formula as recordCompletion() in TS."""
    rate = current if current is not None else _DEFAULT_COMPLETION_RATE
    return min(1.0, rate * 0.7 + 0.3)
