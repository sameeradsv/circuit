from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, _migrate_sqlite, _migrate_postgres, engine
from app.routers.auth import router as auth_router
from app.routers.tasks import router as tasks_router

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


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    _migrate_sqlite()
    _migrate_postgres()


@app.get("/health")
def health():
    return {"status": "ok", "service": "circuit-api"}
