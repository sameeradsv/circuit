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
        # Widen timestamp columns from INTEGER (32-bit) to BIGINT (64-bit)
        # so they can hold JavaScript ms-epoch values (~1.75 trillion).
        for col in ("scheduled_at", "last_skipped_at", "client_created_at", "client_updated_at"):
            row = conn.execute(text(
                "SELECT data_type FROM information_schema.columns "
                "WHERE table_name = 'circuit_tasks' AND column_name = :col"
            ), {"col": col}).fetchone()
            if row and row[0] == "integer":
                conn.execute(text(f"ALTER TABLE circuit_tasks ALTER COLUMN {col} TYPE BIGINT"))
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


def _migrate_blackout_and_rrule() -> None:
    inspector = inspect(engine)
    existing_cols = {c["name"] for c in inspector.get_columns("circuit_tasks")}
    existing_tables = inspector.get_table_names()
    is_sqlite = DATABASE_URL.startswith("sqlite")

    with engine.connect() as conn:
        new_cols = [
            ("rrule", "TEXT"),
            ("rrule_dtstart_ms", "INTEGER" if is_sqlite else "BIGINT"),
            ("is_recurring_template", "BOOLEAN DEFAULT 0" if is_sqlite else "BOOLEAN DEFAULT FALSE"),
            ("blackout_skip_flags", "TEXT"),
        ]
        for col_name, col_def in new_cols:
            if col_name not in existing_cols:
                if is_sqlite:
                    conn.execute(text(f"ALTER TABLE circuit_tasks ADD COLUMN {col_name} {col_def}"))
                else:
                    conn.execute(text(f"ALTER TABLE circuit_tasks ADD COLUMN IF NOT EXISTS {col_name} {col_def}"))

        if "blackouts" not in existing_tables:
            if is_sqlite:
                conn.execute(text(
                    "CREATE TABLE IF NOT EXISTS blackouts ("
                    "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                    "user_id INTEGER NOT NULL REFERENCES users(id), "
                    "blackout_type VARCHAR(30) NOT NULL, "
                    "start_date_ms INTEGER NOT NULL, "
                    "end_date_ms INTEGER NOT NULL, "
                    "created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
                ))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_blackouts_user ON blackouts (user_id)"))
            else:
                conn.execute(text(
                    "CREATE TABLE IF NOT EXISTS blackouts ("
                    "id SERIAL PRIMARY KEY, "
                    "user_id INTEGER NOT NULL REFERENCES users(id), "
                    "blackout_type VARCHAR(30) NOT NULL, "
                    "start_date_ms BIGINT NOT NULL, "
                    "end_date_ms BIGINT NOT NULL, "
                    "created_at TIMESTAMP DEFAULT NOW())"
                ))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_blackouts_user ON blackouts (user_id)"))

        conn.commit()


def _migrate_recurrence_extra() -> None:
    inspector = inspect(engine)
    existing_cols = {c["name"] for c in inspector.get_columns("circuit_tasks")}
    is_sqlite = DATABASE_URL.startswith("sqlite")
    with engine.connect() as conn:
        new_cols = [
            ("recurrence_ends_at", "INTEGER" if is_sqlite else "BIGINT"),
            ("post_blackout_behavior", "VARCHAR(20)"),
        ]
        for col_name, col_def in new_cols:
            if col_name not in existing_cols:
                if is_sqlite:
                    conn.execute(text(f"ALTER TABLE circuit_tasks ADD COLUMN {col_name} {col_def}"))
                else:
                    conn.execute(text(f"ALTER TABLE circuit_tasks ADD COLUMN IF NOT EXISTS {col_name} {col_def}"))
        conn.commit()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
