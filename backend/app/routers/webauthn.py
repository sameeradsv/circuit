from __future__ import annotations

import base64
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

import webauthn
from webauthn.helpers import options_to_json
from webauthn.helpers.cose import COSEAlgorithmIdentifier
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.auth_utils import create_session
from app.database import get_db
from app.deps.auth import require_user
from app.models import User, WebAuthnChallenge, WebAuthnCredential

router = APIRouter(prefix="/api/auth/webauthn", tags=["webauthn"])

RP_ID = os.getenv("WEBAUTHN_RP_ID")
RP_NAME = os.getenv("WEBAUTHN_RP_NAME", "circuit")
ORIGIN = (os.getenv("WEBAUTHN_ORIGIN") or "").rstrip("/")
_TTL = 120


def _webauthn_config() -> tuple[str, str]:
    if not RP_ID or not ORIGIN:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Passkey sign-in is not configured. Set WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN.",
        )
    return RP_ID, ORIGIN


def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _store(db: Session, challenge: bytes, user_id=None) -> str:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db.query(WebAuthnChallenge).filter(WebAuthnChallenge.expires_at < now).delete()
    entry = WebAuthnChallenge(
        id=secrets.token_hex(32),
        challenge=_b64u(challenge),
        user_id=str(user_id) if user_id is not None else None,
        expires_at=now + timedelta(seconds=_TTL),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry.id


def _pop(db: Session, cid: str) -> bytes:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    e = db.get(WebAuthnChallenge, cid)
    if not e or e.expires_at < now:
        db.query(WebAuthnChallenge).filter(WebAuthnChallenge.expires_at < now).delete()
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Challenge expired or not found")
    challenge = _unb64u(e.challenge)
    db.delete(e)
    db.commit()
    return challenge


class _RegComplete(BaseModel):
    challenge_id: str
    credential: Dict[str, Any]


class _AuthComplete(BaseModel):
    challenge_id: str
    credential: Dict[str, Any]


@router.post("/register/begin")
def register_begin(user: User = Depends(require_user), db: Session = Depends(get_db)):
    rp_id, _ = _webauthn_config()
    opts = webauthn.generate_registration_options(
        rp_id=rp_id,
        rp_name=RP_NAME,
        user_id=str(user.id).encode(),
        user_name=user.username,
        user_display_name=user.username,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
        supported_pub_key_algs=[
            COSEAlgorithmIdentifier.ECDSA_SHA_256,
            COSEAlgorithmIdentifier.RSASSA_PKCS1_v1_5_SHA_256,
        ],
    )
    cid = _store(db, opts.challenge, user_id=user.id)
    return {"challenge_id": cid, "options": json.loads(options_to_json(opts))}


@router.post("/register/complete")
def register_complete(
    body: _RegComplete,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    rp_id, origin = _webauthn_config()
    challenge = _pop(db, body.challenge_id)
    try:
        v = webauthn.verify_registration_response(
            credential=body.credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id,
            expected_origin=origin,
            require_user_verification=False,
        )
    except Exception as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Registration failed: {exc}")

    cred_id = _b64u(v.credential_id)
    existing = db.get(WebAuthnCredential, cred_id)
    if existing:
        existing.public_key = base64.b64encode(v.credential_public_key).decode()
        existing.sign_count = v.sign_count
    else:
        db.add(WebAuthnCredential(
            credential_id=cred_id,
            public_key=base64.b64encode(v.credential_public_key).decode(),
            sign_count=v.sign_count,
            user_id=str(user.id),
        ))
    db.commit()
    return {"ok": True}


@router.post("/login/begin")
def login_begin(db: Session = Depends(get_db)):
    rp_id, _ = _webauthn_config()
    opts = webauthn.generate_authentication_options(
        rp_id=rp_id,
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    cid = _store(db, opts.challenge)
    return {"challenge_id": cid, "options": json.loads(options_to_json(opts))}


@router.post("/login/complete")
def login_complete(body: _AuthComplete, db: Session = Depends(get_db)):
    rp_id, origin = _webauthn_config()
    challenge = _pop(db, body.challenge_id)
    cred_id = body.credential.get("id", "")
    cred = db.get(WebAuthnCredential, cred_id)
    if not cred:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Passkey not recognised")
    try:
        v = webauthn.verify_authentication_response(
            credential=body.credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id,
            expected_origin=origin,
            credential_public_key=base64.b64decode(cred.public_key),
            credential_current_sign_count=cred.sign_count,
            require_user_verification=False,
        )
    except Exception as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Authentication failed: {exc}")

    cred.sign_count = v.new_sign_count
    db.commit()
    user = db.get(User, int(cred.user_id))
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    session = create_session(db, user)
    return {"token": session.token, "user": {"id": user.id, "username": user.username}}
