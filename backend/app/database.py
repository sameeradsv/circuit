from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR / 'circuit.db'}")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def _migrate_sqlite() -> None:
    if not DATABASE_URL.startswith("sqlite"):
        return
    inspector = inspect(engine)
    with engine.connect() as conn:
        if "auth_sessions" not in inspector.get_table_names():
            conn.execute(text(
                "CREATE TABLE auth_sessions ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "token VARCHAR(64) NOT NULL UNIQUE, "
                "user_id INTEGER NOT NULL REFERENCES users(id), "
                "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
                "expires_at DATETIME NOT NULL)"
            ))
            conn.execute(text("CREATE INDEX ix_auth_sessions_token ON auth_sessions (token)"))
            conn.commit()


def _migrate_postgres() -> None:
    if DATABASE_URL.startswith("sqlite"):
        return
    with engine.connect() as conn:
        # Add columns introduced after initial schema — safe to run repeatedly
        conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
            "cortex_user_id INTEGER UNIQUE"
        ))
        conn.commit()


def _migrate_webauthn_tables() -> None:
    inspector = inspect(engine)
    existing_tables = inspector.get_table_names()
    with engine.connect() as conn:
        if "webauthn_credentials" not in existing_tables:
            if DATABASE_URL.startswith("sqlite"):
                conn.execute(text(
                    "CREATE TABLE IF NOT EXISTS webauthn_credentials ("
                    "credential_id TEXT PRIMARY KEY, "
                    "public_key TEXT NOT NULL, "
                    "sign_count INTEGER DEFAULT 0, "
                    "user_id TEXT NOT NULL, "
                    "created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
                ))
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_webauthn_cred_user "
                    "ON webauthn_credentials (user_id)"
                ))
            else:
                conn.execute(text(
                    "CREATE TABLE IF NOT EXISTS webauthn_credentials ("
                    "credential_id TEXT PRIMARY KEY, "
                    "public_key TEXT NOT NULL, "
                    "sign_count INTEGER DEFAULT 0, "
                    "user_id TEXT NOT NULL, "
                    "created_at TIMESTAMP DEFAULT NOW())"
                ))
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_webauthn_cred_user "
                    "ON webauthn_credentials (user_id)"
                ))
            conn.commit()
        if "webauthn_challenges" not in existing_tables:
            if DATABASE_URL.startswith("sqlite"):
                conn.execute(text(
                    "CREATE TABLE IF NOT EXISTS webauthn_challenges ("
                    "id VARCHAR(64) PRIMARY KEY, "
                    "challenge VARCHAR(128) NOT NULL, "
                    "user_id TEXT, "
                    "expires_at DATETIME NOT NULL, "
                    "created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
                ))
            else:
                conn.execute(text(
                    "CREATE TABLE IF NOT EXISTS webauthn_challenges ("
                    "id VARCHAR(64) PRIMARY KEY, "
                    "challenge VARCHAR(128) NOT NULL, "
                    "user_id TEXT, "
                    "expires_at TIMESTAMP NOT NULL, "
                    "created_at TIMESTAMP DEFAULT NOW())"
                ))
            conn.commit()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
