from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuthSession, User

PBKDF2_ITERATIONS = 260_000
SESSION_DAYS = 30


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
        expires_at=datetime.utcnow() + timedelta(days=SESSION_DAYS),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_user_for_token(db: Session, token: str | None) -> User | None:
    if not token:
        return None
    session = db.scalar(
        select(AuthSession).where(
            AuthSession.token == token,
            AuthSession.expires_at > datetime.utcnow(),
        )
    )
    if not session:
        return None
    return db.get(User, session.user_id)
