from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR / 'circuit.db'}")
if DATABASE_URL.startswith("sqlite"):
    DATA_DIR.mkdir(parents=True, exist_ok=True)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
pool_kwargs = (
    {}
    if DATABASE_URL.startswith("sqlite")
    else {"pool_pre_ping": True, "pool_recycle": 280, "pool_size": 2, "max_overflow": 3}
)
engine = create_engine(DATABASE_URL, connect_args=connect_args, **pool_kwargs)
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


def _migrate_sleep_log() -> None:
    inspector = inspect(engine)
    existing_tables = inspector.get_table_names()
    if "sleep_logs" in existing_tables:
        return
    is_sqlite = DATABASE_URL.startswith("sqlite")
    with engine.connect() as conn:
        if is_sqlite:
            conn.execute(text(
                "CREATE TABLE IF NOT EXISTS sleep_logs ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "user_id INTEGER NOT NULL REFERENCES users(id), "
                "date VARCHAR(10) NOT NULL, "
                "bedtime_ms INTEGER, "
                "wake_ms INTEGER, "
                "quality REAL, "
                "disturbed BOOLEAN, "
                "notes TEXT, "
                "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
                "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
                "UNIQUE(user_id, date))"
            ))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_sleep_logs_user ON sleep_logs (user_id)"))
        else:
            conn.execute(text(
                "CREATE TABLE IF NOT EXISTS sleep_logs ("
                "id SERIAL PRIMARY KEY, "
                "user_id INTEGER NOT NULL REFERENCES users(id), "
                "date VARCHAR(10) NOT NULL, "
                "bedtime_ms BIGINT, "
                "wake_ms BIGINT, "
                "quality REAL, "
                "disturbed BOOLEAN, "
                "notes TEXT, "
                "created_at TIMESTAMP DEFAULT NOW(), "
                "updated_at TIMESTAMP DEFAULT NOW(), "
                "UNIQUE(user_id, date))"
            ))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_sleep_logs_user ON sleep_logs (user_id)"))
        conn.commit()


def _migrate_energy_eod() -> None:
    inspector = inspect(engine)
    existing_cols = {c["name"] for c in inspector.get_columns("user_state")}
    if "energy_eod" in existing_cols:
        return
    is_sqlite = DATABASE_URL.startswith("sqlite")
    with engine.connect() as conn:
        if is_sqlite:
            conn.execute(text("ALTER TABLE user_state ADD COLUMN energy_eod REAL"))
        else:
            conn.execute(text("ALTER TABLE user_state ADD COLUMN IF NOT EXISTS energy_eod REAL"))
        conn.commit()


def _migrate_energy_manual_override() -> None:
    inspector = inspect(engine)
    existing_cols = {c["name"] for c in inspector.get_columns("user_state")}
    is_sqlite = DATABASE_URL.startswith("sqlite")
    with engine.connect() as conn:
        if "energy_manual_override" not in existing_cols and is_sqlite:
            conn.execute(text("ALTER TABLE user_state ADD COLUMN energy_manual_override BOOLEAN DEFAULT 0"))
        elif "energy_manual_override" not in existing_cols:
            conn.execute(text(
                "ALTER TABLE user_state ADD COLUMN IF NOT EXISTS energy_manual_override BOOLEAN DEFAULT FALSE"
            ))
        if "energy_manual_override_date" not in existing_cols:
            if is_sqlite:
                conn.execute(text("ALTER TABLE user_state ADD COLUMN energy_manual_override_date VARCHAR(10)"))
            else:
                conn.execute(text(
                    "ALTER TABLE user_state ADD COLUMN IF NOT EXISTS energy_manual_override_date VARCHAR(10)"
                ))
        conn.commit()


def _migrate_energy_manual_override_date() -> None:
    inspector = inspect(engine)
    existing_cols = {c["name"] for c in inspector.get_columns("user_state")}
    if "energy_manual_override_date" in existing_cols:
        return
    is_sqlite = DATABASE_URL.startswith("sqlite")
    with engine.connect() as conn:
        if is_sqlite:
            conn.execute(text("ALTER TABLE user_state ADD COLUMN energy_manual_override_date VARCHAR(10)"))
        else:
            conn.execute(text(
                "ALTER TABLE user_state ADD COLUMN IF NOT EXISTS energy_manual_override_date VARCHAR(10)"
            ))
        conn.commit()


def _migrate_recurrence_anchor() -> None:
    inspector = inspect(engine)
    existing_cols = {c["name"] for c in inspector.get_columns("circuit_tasks")}
    is_sqlite = DATABASE_URL.startswith("sqlite")
    with engine.connect() as conn:
        col_def = "INTEGER" if is_sqlite else "BIGINT"
        if "recurrence_anchor_ms" not in existing_cols:
            if is_sqlite:
                conn.execute(text(f"ALTER TABLE circuit_tasks ADD COLUMN recurrence_anchor_ms {col_def}"))
            else:
                conn.execute(text(f"ALTER TABLE circuit_tasks ADD COLUMN IF NOT EXISTS recurrence_anchor_ms {col_def}"))
        conn.commit()


def _migrate_task_groups() -> None:
    inspector = inspect(engine)
    existing_cols = {c["name"] for c in inspector.get_columns("circuit_tasks")}
    is_sqlite = DATABASE_URL.startswith("sqlite")
    with engine.connect() as conn:
        for col_name, col_def in [
            ("group_id", "VARCHAR(100)"),
            ("day_time_overrides", "TEXT"),
            ("travel_buffer_before_mins", "INTEGER"),
            ("travel_buffer_after_mins", "INTEGER"),
        ]:
            if col_name not in existing_cols:
                if is_sqlite:
                    conn.execute(text(f"ALTER TABLE circuit_tasks ADD COLUMN {col_name} {col_def}"))
                else:
                    conn.execute(text(f"ALTER TABLE circuit_tasks ADD COLUMN IF NOT EXISTS {col_name} {col_def}"))
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


def _ensure_migrations_table() -> None:
    with engine.connect() as conn:
        conn.execute(text(
            "CREATE TABLE IF NOT EXISTS schema_migrations "
            "(name VARCHAR(100) PRIMARY KEY, "
            "applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
        ))
        conn.commit()


def _migration_done(name: str) -> bool:
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT 1 FROM schema_migrations WHERE name = :n"), {"n": name}
        ).fetchone() is not None


def _mark_done(name: str) -> None:
    with engine.connect() as conn:
        if DATABASE_URL.startswith("sqlite"):
            conn.execute(text("INSERT OR IGNORE INTO schema_migrations (name) VALUES (:n)"), {"n": name})
        else:
            conn.execute(text("INSERT INTO schema_migrations (name) VALUES (:n) ON CONFLICT DO NOTHING"), {"n": name})
        conn.commit()


def _migrate_import_review_pending() -> None:
    inspector = inspect(engine)
    existing_cols = {c["name"] for c in inspector.get_columns("circuit_tasks")}
    is_sqlite = DATABASE_URL.startswith("sqlite")
    col_def = "BOOLEAN DEFAULT 0" if is_sqlite else "BOOLEAN DEFAULT FALSE"
    with engine.connect() as conn:
        if "import_review_pending" not in existing_cols:
            if is_sqlite:
                conn.execute(text(f"ALTER TABLE circuit_tasks ADD COLUMN import_review_pending {col_def}"))
            else:
                conn.execute(text(
                    f"ALTER TABLE circuit_tasks ADD COLUMN IF NOT EXISTS import_review_pending {col_def}"
                ))
        conn.commit()


def _migrate_task_notifications() -> None:
    inspector = inspect(engine)
    existing_cols = {c["name"] for c in inspector.get_columns("circuit_tasks")}
    is_sqlite = DATABASE_URL.startswith("sqlite")
    with engine.connect() as conn:
        for col_name, col_def in [
            ("notifications_enabled", "BOOLEAN DEFAULT 1" if is_sqlite else "BOOLEAN DEFAULT TRUE"),
            ("notification_offset_1_mins", "INTEGER DEFAULT 10"),
            ("notification_offset_2_mins", "INTEGER"),
        ]:
            if col_name not in existing_cols:
                if is_sqlite:
                    conn.execute(text(f"ALTER TABLE circuit_tasks ADD COLUMN {col_name} {col_def}"))
                else:
                    conn.execute(text(f"ALTER TABLE circuit_tasks ADD COLUMN IF NOT EXISTS {col_name} {col_def}"))
        conn.commit()


def _migrate_virtual_recurrence_tables() -> None:
    inspector = inspect(engine)
    existing_tables = inspector.get_table_names()
    is_sqlite = DATABASE_URL.startswith("sqlite")
    with engine.connect() as conn:
        if "recurring_tasks" not in existing_tables:
            if is_sqlite:
                conn.execute(text(
                    "CREATE TABLE IF NOT EXISTS recurring_tasks ("
                    "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                    "user_id INTEGER NOT NULL REFERENCES users(id), "
                    "source_task_id INTEGER UNIQUE REFERENCES circuit_tasks(id) ON DELETE CASCADE, "
                    "title TEXT NOT NULL, "
                    "start_datetime_ms INTEGER NOT NULL, "
                    "duration INTEGER DEFAULT 30, "
                    "recurrence VARCHAR(50), "
                    "rrule TEXT, "
                    "rrule_dtstart_ms INTEGER, "
                    "recurrence_ends_at INTEGER, "
                    "metadata_json TEXT DEFAULT '{}', "
                    "active BOOLEAN DEFAULT 1, "
                    "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
                    "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
                ))
            else:
                conn.execute(text(
                    "CREATE TABLE IF NOT EXISTS recurring_tasks ("
                    "id SERIAL PRIMARY KEY, "
                    "user_id INTEGER NOT NULL REFERENCES users(id), "
                    "source_task_id INTEGER UNIQUE REFERENCES circuit_tasks(id) ON DELETE CASCADE, "
                    "title TEXT NOT NULL, "
                    "start_datetime_ms BIGINT NOT NULL, "
                    "duration INTEGER DEFAULT 30, "
                    "recurrence VARCHAR(50), "
                    "rrule TEXT, "
                    "rrule_dtstart_ms BIGINT, "
                    "recurrence_ends_at BIGINT, "
                    "metadata_json TEXT DEFAULT '{}', "
                    "active BOOLEAN DEFAULT TRUE, "
                    "created_at TIMESTAMP DEFAULT NOW(), "
                    "updated_at TIMESTAMP DEFAULT NOW())"
                ))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_recurring_tasks_user ON recurring_tasks (user_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_recurring_tasks_source_task ON recurring_tasks (source_task_id)"))

        if "occurrence_overrides" not in existing_tables:
            if is_sqlite:
                conn.execute(text(
                    "CREATE TABLE IF NOT EXISTS occurrence_overrides ("
                    "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                    "user_id INTEGER NOT NULL REFERENCES users(id), "
                    "recurring_task_id INTEGER NOT NULL REFERENCES recurring_tasks(id) ON DELETE CASCADE, "
                    "occurrence_start_ms INTEGER NOT NULL, "
                    "status VARCHAR(20) NOT NULL, "
                    "modified_start_ms INTEGER, "
                    "modified_duration INTEGER, "
                    "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
                    "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
                    "UNIQUE(recurring_task_id, occurrence_start_ms))"
                ))
            else:
                conn.execute(text(
                    "CREATE TABLE IF NOT EXISTS occurrence_overrides ("
                    "id SERIAL PRIMARY KEY, "
                    "user_id INTEGER NOT NULL REFERENCES users(id), "
                    "recurring_task_id INTEGER NOT NULL REFERENCES recurring_tasks(id) ON DELETE CASCADE, "
                    "occurrence_start_ms BIGINT NOT NULL, "
                    "status VARCHAR(20) NOT NULL, "
                    "modified_start_ms BIGINT, "
                    "modified_duration INTEGER, "
                    "created_at TIMESTAMP DEFAULT NOW(), "
                    "updated_at TIMESTAMP DEFAULT NOW(), "
                    "UNIQUE(recurring_task_id, occurrence_start_ms))"
                ))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_occurrence_overrides_user ON occurrence_overrides (user_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_occurrence_overrides_start ON occurrence_overrides (occurrence_start_ms)"))
        conn.commit()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create tables and run additive migrations once for the configured database."""
    from app import models  # noqa: F401 - register SQLAlchemy models with Base metadata

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
        ("recurrence_anchor_ms",   _migrate_recurrence_anchor),
        ("import_review_pending",  _migrate_import_review_pending),
        ("energy_manual_override", _migrate_energy_manual_override),
        ("energy_manual_override_date", _migrate_energy_manual_override_date),
        ("task_notifications",     _migrate_task_notifications),
        ("virtual_recurrence",     _migrate_virtual_recurrence_tables),
    ]:
        if not _migration_done(name):
            fn()
            _mark_done(name)


if __name__ == "__main__":
    init_db()
