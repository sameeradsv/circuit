from __future__ import annotations

import json
import logging
from typing import Any

from app.config import settings
from app.models import PushSubscription

logger = logging.getLogger(__name__)


class PushConfigError(RuntimeError):
    pass


class PushGoneError(RuntimeError):
    pass


def _subscription_info(sub: PushSubscription) -> dict[str, Any]:
    return {
        "endpoint": sub.endpoint,
        "keys": {
            "p256dh": sub.p256dh,
            "auth": sub.auth,
        },
    }


def send_web_push(sub: PushSubscription, payload: dict[str, Any]) -> None:
    if not settings.vapid_public_key or not settings.vapid_private_key:
        raise PushConfigError("VAPID keys are not configured")

    try:
        from pywebpush import WebPushException, webpush
    except Exception as exc:  # pragma: no cover - import failure is environment-specific
        raise PushConfigError("pywebpush is not installed") from exc

    try:
        webpush(
            subscription_info=_subscription_info(sub),
            data=json.dumps(payload),
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
            ttl=3600,
        )
    except WebPushException as exc:
        status_code = getattr(getattr(exc, "response", None), "status_code", None)
        if status_code in (404, 410):
            raise PushGoneError("Subscription is no longer valid") from exc
        logger.warning("Web push delivery failed", extra={"status_code": status_code})
        raise
