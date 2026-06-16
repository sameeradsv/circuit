from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import (
    Base, engine,
    _migrate_sqlite, _migrate_postgres, _migrate_webauthn_tables,
    _migrate_blackout_and_rrule, _migrate_recurrence_extra,
    _migrate_sleep_log, _migrate_energy_eod, _migrate_task_groups,
    _ensure_migrations_table, _migration_done, _mark_done,
)
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

app = FastAPI(title="Circuit API", version="1.0.0")

origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,https://sameeradsv.github.io",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in origins],
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


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    _ensure_migrations_table()
    for name, fn in [
        ("sqlite_auth_sessions",   _migrate_sqlite),
        ("postgres_base_columns",  _migrate_postgres),
        ("webauthn_tables",        _migrate_webauthn_tables),
        ("blackout_and_rrule",     _migrate_blackout_and_rrule),
        ("recurrence_extra",       _migrate_recurrence_extra),
        ("sleep_log_table",        _migrate_sleep_log),
        ("energy_eod_column",      _migrate_energy_eod),
        ("task_groups_columns",    _migrate_task_groups),
    ]:
        if not _migration_done(name):
            fn()
            _mark_done(name)


@app.get("/health")
def health():
    return {"status": "ok", "service": "circuit-api"}
