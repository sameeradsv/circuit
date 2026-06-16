from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth_utils import create_session, hash_password, verify_password
from app.config import settings
from app.database import get_db
from app.deps.auth import require_user
from app.models import AuthSession, User

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=50)
    password: str = Field(..., min_length=4)


class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    created_at: str

    model_config = {"from_attributes": True}

    def model_post_init(self, __context) -> None:
        pass


class AuthResponse(BaseModel):
    token: str
    user: dict


@router.post("/register", status_code=201)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == payload.username.lower()).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")
    user = User(username=payload.username.lower(), hashed_password=hash_password(payload.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    session = create_session(db, user)
    return {"token": session.token, "user": {"id": user.id, "username": user.username, "created_at": user.created_at.isoformat()}}


@router.post("/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username.lower()).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    session = create_session(db, user)
    return {"token": session.token, "user": {"id": user.id, "username": user.username, "created_at": user.created_at.isoformat()}}


@router.delete("/logout", status_code=204)
def logout(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)):
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        db.query(AuthSession).filter(AuthSession.token == token).delete()
        db.commit()


@router.get("/me")
def me(user: User = Depends(require_user)):
    return {"id": user.id, "username": user.username, "created_at": user.created_at.isoformat()}


@router.get("/status")
def auth_status(db: Session = Depends(get_db)):
    has_users = db.query(User).first() is not None
    return {"has_users": has_users, "sync_ready": True}


@router.get("/debug")
def debug_auth(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)):
    """Diagnose why a bearer token is being rejected. Never use in prod — remove once fixed."""
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()

    if not token:
        return {"error": "no bearer token in Authorization header"}

    # 1. Local session check
    session = db.scalar(
        select(AuthSession).where(
            AuthSession.token == token,
            AuthSession.expires_at > datetime.now(timezone.utc).replace(tzinfo=None),
        )
    )
    if session:
        user = db.get(User, session.user_id)
        return {"source": "local_session", "user_id": user.id if user else None, "username": user.username if user else None}

    # 2. Cortex probe — run the HTTP call manually and return raw details
    cortex_url = settings.cortex_auth_url.rstrip("/")
    if not cortex_url:
        return {"error": "CORTEX_AUTH_URL is not set", "local_session": False}

    target = f"{cortex_url}/auth/me"
    try:
        resp = httpx.get(target, headers={"Authorization": f"Bearer {token}"}, timeout=5)
        return {
            "local_session": False,
            "cortex_url": cortex_url,
            "cortex_endpoint": target,
            "cortex_status": resp.status_code,
            "cortex_body": resp.json() if resp.headers.get("content-type", "").startswith("application/json") else resp.text[:300],
        }
    except httpx.ConnectError as e:
        return {"local_session": False, "cortex_url": cortex_url, "error": f"ConnectError: {e}"}
    except Exception as e:
        return {"local_session": False, "cortex_url": cortex_url, "error": str(e)}
