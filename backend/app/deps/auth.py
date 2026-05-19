from __future__ import annotations

from typing import Optional

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.auth_utils import get_user_for_token
from app.database import get_db
from app.models import User


def optional_user(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> Optional[User]:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    return get_user_for_token(db, token)


def require_user(user: Optional[User] = Depends(optional_user)) -> User:
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user
