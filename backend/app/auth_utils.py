from __future__ import annotations

import hashlib
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuthSession, User

PBKDF2_ITERATIONS = 100_000
SESSION_DAYS = 30

log = logging.getLogger(__name__)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ITERATIONS)
    return f"{salt}${PBKDF2_ITERATIONS}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, iterations, digest_hex = stored.split("$")
        iterations = int(iterations)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)
    return secrets.compare_digest(digest.hex(), digest_hex)


def create_session(db: Session, user: User) -> AuthSession:
    token = secrets.token_urlsafe(32)
    session = AuthSession(
        token=token,
        user_id=user.id,
        expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=SESSION_DAYS),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_user_for_token(db: Session, token: str | None) -> User | None:
    if not token:
        return None
    # 1. Check local sessions first
    session = db.scalar(
        select(AuthSession).where(
            AuthSession.token == token,
            AuthSession.expires_at > datetime.now(timezone.utc).replace(tzinfo=None),
        )
    )
    if session:
        return db.get(User, session.user_id)

    # 2. Fall back to Cortex Auth Server if configured
    return _validate_cortex_token(db, token)


def _validate_cortex_token(db: Session, token: str) -> User | None:
    cortex_url = os.getenv("CORTEX_AUTH_URL", "").rstrip("/")
    if not cortex_url:
        return None
    try:
        resp = httpx.get(
            f"{cortex_url}/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=5,
        )
        if not resp.is_success:
            return None
        data = resp.json()
        cortex_id: int = data["id"]
        username: str = data["username"]
    except Exception:
        log.warning("Cortex Auth Server unreachable during token validation")
        return None

    # Upsert local shadow user for this Cortex account
    user = db.scalar(select(User).where(User.cortex_user_id == cortex_id))
    if not user:
        base = username
        candidate = base
        suffix = 2
        while db.scalar(select(User).where(User.username == candidate)):
            candidate = f"{base}-cx{suffix}"
            suffix += 1
        user = User(username=candidate, hashed_password="", cortex_user_id=cortex_id)
        db.add(user)
        db.commit()
        db.refresh(user)

    # Cache the Cortex token locally
    existing = db.scalar(select(AuthSession).where(AuthSession.token == token))
    if not existing:
        local_session = AuthSession(
            token=token,
            user_id=user.id,
            expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=SESSION_DAYS),
        )
        db.add(local_session)
        db.commit()

    return user
