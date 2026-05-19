from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth_utils import create_session, hash_password, verify_password
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
