from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Integer, String, Text, Boolean, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    # Set when this user was created via a Cortex account login
    cortex_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, unique=True, index=True)


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class CircuitTask(Base):
    __tablename__ = "circuit_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # Identity
    client_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)  # localStorage id
    text: Mapped[str] = mapped_column(Text, nullable=False)
    tag: Mapped[str] = mapped_column(String(20), default="general")
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    tiny_step: Mapped[str] = mapped_column(Text, default="")

    # Scheduling
    effort: Mapped[str] = mapped_column(String(10), default="medium")
    duration: Mapped[int] = mapped_column(Integer, default=30)
    deadline_type: Mapped[str] = mapped_column(String(10), default="none")
    time_sensitivity: Mapped[float] = mapped_column(Float, default=0.5)
    scheduled_at: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    recurrence: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Cognitive
    cognitive_load: Mapped[float] = mapped_column(Float, default=0.5)
    emotional_resistance: Mapped[float] = mapped_column(Float, default=0.5)
    activation_energy: Mapped[float] = mapped_column(Float, default=0.5)
    recovery_cost: Mapped[float] = mapped_column(Float, default=0.3)
    focus_type: Mapped[str] = mapped_column(String(20), default="shallow")

    # Priority
    importance: Mapped[float] = mapped_column(Float, default=0.5)
    urgency: Mapped[float] = mapped_column(Float, default=0.5)
    consequence_of_delay: Mapped[float] = mapped_column(Float, default=0.3)
    momentum_value: Mapped[float] = mapped_column(Float, default=0.5)
    compound_benefit: Mapped[float] = mapped_column(Float, default=0.3)
    identity_alignment: Mapped[float] = mapped_column(Float, default=0.3)

    # Behavioral
    historical_completion_rate: Mapped[float] = mapped_column(Float, default=0.7)
    skipped_count: Mapped[int] = mapped_column(Integer, default=0)
    last_skipped_at: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    energy_to_reward_ratio: Mapped[float] = mapped_column(Float, default=0.5)
    task_decomposition_potential: Mapped[float] = mapped_column(Float, default=0.3)

    # JSON blobs
    required_resources: Mapped[str] = mapped_column(Text, default="[]")   # JSON array
    dependencies: Mapped[str] = mapped_column(Text, default="[]")          # JSON array
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")         # JSON object
    preferred_execution_window: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    delay_pattern: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    location_dependency: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Blackout skip flags
    blackout_skip_flags: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array: ["travelling", "period", "sickness"]

    # Lazy-load RRULE (calendar imports)
    rrule: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    rrule_dtstart_ms: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    is_recurring_template: Mapped[bool] = mapped_column(Boolean, default=False)

    # Recurrence end date (ms epoch) — no new occurrences created after this
    recurrence_ends_at: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    # How to handle tasks missed during a blackout:
    # "resume" | "catch_up" | "catch_up_once" | "catch_up_immediate"
    post_blackout_behavior: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    # For catch_up_once / catch_up_immediate: original pre-blackout scheduled_at;
    # completion computes the next occurrence from that anchor.
    recurrence_anchor_ms: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    # Task group: tasks sharing the same group_id shift together when rescheduled
    group_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    # Weekend time override: JSON {"SA": "10:00", "SU": "10:00"} — overrides the
    # default recurrence time on Sat/Sun (keys: SA, SU only)
    day_time_overrides: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Travel buffers: blocked time before/after this task for travel/transit
    travel_buffer_before_mins: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    travel_buffer_after_mins: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Timestamps
    client_created_at: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    client_updated_at: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None), onupdate=lambda: datetime.now(timezone.utc).replace(tzinfo=None))


class UserSettings(Base):
    __tablename__ = "user_settings"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_user_settings_user_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[str] = mapped_column(Text, default="{}")  # JSON-encoded value
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None), onupdate=lambda: datetime.now(timezone.utc).replace(tzinfo=None))


class UserState(Base):
    __tablename__ = "user_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, unique=True, index=True)
    energy_level: Mapped[float] = mapped_column(Float, default=0.7)
    stress_level: Mapped[float] = mapped_column(Float, default=0.3)
    time_available_minutes: Mapped[int] = mapped_column(Integer, default=480)
    focus_mode: Mapped[str] = mapped_column(String(20), default="normal")
    # Carry-over: running energy level at end of previous day (written by sync endpoint)
    energy_eod: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None), onupdate=lambda: datetime.now(timezone.utc).replace(tzinfo=None))


class TaskEvent(Base):
    __tablename__ = "task_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    task_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("circuit_tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")


class Blackout(Base):
    __tablename__ = "blackouts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    blackout_type: Mapped[str] = mapped_column(String(30), nullable=False)
    start_date_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    end_date_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))


class SleepLog(Base):
    """Daily sleep context — bedtime, wake time, quality, disturbances.
    Keyed by (user_id, date) where date is the IST calendar date the user woke up on."""
    __tablename__ = "sleep_logs"
    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_sleep_logs_user_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    date: Mapped[str] = mapped_column(String(10), nullable=False)          # "YYYY-MM-DD" IST (wake-up date)
    bedtime_ms: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)   # when they went to bed
    wake_ms: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)      # when they woke up
    quality: Mapped[Optional[float]] = mapped_column(Float, nullable=True)         # 0–10 user rating
    disturbed: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)      # fragmented/interrupted
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None), onupdate=lambda: datetime.now(timezone.utc).replace(tzinfo=None))


class WebAuthnCredential(Base):
    __tablename__ = "webauthn_credentials"

    credential_id: Mapped[str] = mapped_column(Text, primary_key=True)
    public_key: Mapped[str] = mapped_column(Text, nullable=False)
    sign_count: Mapped[int] = mapped_column(Integer, default=0)
    user_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))


class WebAuthnChallenge(Base):
    __tablename__ = "webauthn_challenges"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    challenge: Mapped[str] = mapped_column(String(128), nullable=False)
    user_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
