from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # Set when this user was created via a Cortex account login
    cortex_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, unique=True, index=True)


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
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
    scheduled_at: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
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
    last_skipped_at: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    energy_to_reward_ratio: Mapped[float] = mapped_column(Float, default=0.5)
    task_decomposition_potential: Mapped[float] = mapped_column(Float, default=0.3)

    # JSON blobs
    required_resources: Mapped[str] = mapped_column(Text, default="[]")   # JSON array
    dependencies: Mapped[str] = mapped_column(Text, default="[]")          # JSON array
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")         # JSON object
    preferred_execution_window: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    delay_pattern: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    location_dependency: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Timestamps
    client_created_at: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    client_updated_at: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
