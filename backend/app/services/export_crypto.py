from __future__ import annotations

import base64
import hashlib
import json
import secrets
from datetime import datetime, timezone

EXPORT_FORMAT = "circuit-encrypted-export"
EXPORT_VERSION = 1
PBKDF2_ITERATIONS = 390_000


def _derive_key(passphrase: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac(
        "sha256",
        passphrase.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
        dklen=32,
    )


def _encrypt(plaintext: bytes, key: bytes) -> tuple[bytes, bytes]:
    from Crypto.Cipher import AES
    iv = secrets.token_bytes(12)
    cipher = AES.new(key, AES.MODE_GCM, nonce=iv)
    ciphertext, tag = cipher.encrypt_and_digest(plaintext)
    return iv, ciphertext + tag


def _decrypt(blob: dict, passphrase: str) -> dict:
    from Crypto.Cipher import AES
    salt = base64.b64decode(blob["salt"])
    key = _derive_key(passphrase, salt)
    iv = base64.b64decode(blob["iv"])
    raw = base64.b64decode(blob["ciphertext"])
    ciphertext, tag = raw[:-16], raw[-16:]
    try:
        cipher = AES.new(key, AES.MODE_GCM, nonce=iv)
        plaintext = cipher.decrypt_and_verify(ciphertext, tag)
    except (ValueError, KeyError) as exc:
        raise ValueError("Export integrity check failed") from exc
    return json.loads(plaintext.decode("utf-8"))


def encrypt_export(payload: dict, passphrase: str) -> dict:
    salt = secrets.token_bytes(16)
    key = _derive_key(passphrase, salt)
    inner = {
        "exported_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z",
        "format": EXPORT_FORMAT,
        "version": EXPORT_VERSION,
        **payload,
    }
    plaintext = json.dumps(inner, default=str).encode("utf-8")
    iv, ciphertext = _encrypt(plaintext, key)
    return {
        "format": EXPORT_FORMAT,
        "version": EXPORT_VERSION,
        "cipher": "aes-gcm-256",
        "kdf": "pbkdf2-sha256",
        "iterations": PBKDF2_ITERATIONS,
        "salt": base64.b64encode(salt).decode("ascii"),
        "iv": base64.b64encode(iv).decode("ascii"),
        "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
    }


def decrypt_export(blob: dict, passphrase: str) -> dict:
    if blob.get("format") != EXPORT_FORMAT:
        raise ValueError("Unrecognized export format")
    return _decrypt(blob, passphrase)
