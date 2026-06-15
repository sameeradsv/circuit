from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, _migrate_sqlite, _migrate_postgres, _migrate_webauthn_tables, _migrate_blackout_and_rrule, _migrate_recurrence_extra, engine
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


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    _migrate_sqlite()
    _migrate_postgres()
    _migrate_webauthn_tables()
    _migrate_blackout_and_rrule()
    _migrate_recurrence_extra()


@app.get("/health")
def health():
    return {"status": "ok", "service": "circuit-api"}
