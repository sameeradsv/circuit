from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from app.config import settings
from app.services.icloud_calendar import icloud_setup_check

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _require_admin(authorization: Optional[str]) -> None:
    if not settings.cron_secret:
        raise HTTPException(status_code=503, detail="Admin setup checks are not configured")
    if authorization != f"Bearer {settings.cron_secret}":
        raise HTTPException(status_code=401, detail="Invalid admin token")


@router.get("/icloud-calendar/setup-check")
def icloud_calendar_setup_check(authorization: Optional[str] = Header(default=None)):
    _require_admin(authorization)
    return icloud_setup_check()
