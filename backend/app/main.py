from __future__ import annotations

import logging
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy.exc import OperationalError

from app.config import settings
from app.limiter import limiter
from app.database import init_db
from app.routers.auth import router as auth_router
from app.routers.tasks import router as tasks_router
from app.routers import settings as settings_router
from app.routers import user as user_router
from app.routers import sync as sync_router
from app.routers import search as search_router
from app.routers import ai as ai_router
from app.routers import history as history_router
from app.routers.webauthn import router as webauthn_router
from app.routers.calendar import router as calendar_router
from app.routers.energy import router as energy_router
from app.routers.blackouts import router as blackouts_router
from app.routers.sleep import router as sleep_router
from app.routers.agent import router as agent_router
from app.routers.notifications import router as notifications_router
from app.routers.cron import router as cron_router
from app.routers.admin import router as admin_router
from app.routers.bootstrap import router as bootstrap_router

log = logging.getLogger(__name__)
_database_backoff_until = 0.0
_DATABASE_BACKOFF_SECONDS = 300

app = FastAPI(title="Circuit API", version="1.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


def _database_unavailable_response(retry_after: int = 60) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Database temporarily unavailable",
            "code": "database_unavailable",
        },
        headers={"Retry-After": str(retry_after)},
    )


def _is_transfer_quota_error(exc: OperationalError) -> bool:
    return "exceeded the data transfer quota" in str(exc).lower()


def _handle_database_operational_error(request: Request, exc: OperationalError) -> JSONResponse:
    global _database_backoff_until
    if _is_transfer_quota_error(exc):
        _database_backoff_until = max(_database_backoff_until, time.monotonic() + _DATABASE_BACKOFF_SECONDS)
        log.warning(
            "Database transfer quota exceeded for %s %s; backing off for %ss",
            request.method,
            request.url.path,
            _DATABASE_BACKOFF_SECONDS,
        )
        return _database_unavailable_response(_DATABASE_BACKOFF_SECONDS)

    log.exception("Database operation failed for %s %s", request.method, request.url.path)
    return _database_unavailable_response()


@app.exception_handler(OperationalError)
async def database_operational_error_handler(request: Request, exc: OperationalError):
    return _handle_database_operational_error(request, exc)

app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(tasks_router)
app.include_router(settings_router.router)
app.include_router(user_router.router)
app.include_router(sync_router.router)
app.include_router(search_router.router)
app.include_router(ai_router.router)
app.include_router(history_router.router)
app.include_router(webauthn_router)
app.include_router(calendar_router)
app.include_router(energy_router)
app.include_router(blackouts_router)
app.include_router(sleep_router)
app.include_router(agent_router)
app.include_router(notifications_router)
app.include_router(cron_router)
app.include_router(admin_router)
app.include_router(bootstrap_router)


@app.middleware("http")
async def add_cache_control(request: Request, call_next):
    if request.url.path not in ("/health", "/api/health") and time.monotonic() < _database_backoff_until:
        retry_after = max(1, int(_database_backoff_until - time.monotonic()))
        return _database_unavailable_response(retry_after)
    try:
        response = await call_next(request)
    except OperationalError as exc:
        return _handle_database_operational_error(request, exc)
    if (
        request.method == "GET"
        and response.status_code == 200
        and not request.url.path.startswith("/api/auth")
    ):
        response.headers["Cache-Control"] = "private, max-age=30"
    return response


@app.on_event("startup")
def on_startup():
    if settings.init_db_on_startup:
        init_db()


@app.get("/health")
def health():
    return {"status": "ok", "service": "circuit-api"}


@app.get("/api/health")
def api_health():
    return health()
