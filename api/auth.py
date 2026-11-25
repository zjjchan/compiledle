from __future__ import annotations

from dataclasses import dataclass

from fastapi import Header, HTTPException, status
from firebase_admin import auth

from api.firebase_client import ensure_firebase_initialized


@dataclass(frozen=True)
class AuthenticatedUser:
    uid: str
    email: str
    auth_time: int = 0


def get_current_user(authorization: str | None = Header(default=None)) -> AuthenticatedUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Bearer authentication token.",
        )

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Empty authentication token.",
        )

    ensure_firebase_initialized()
    try:
        decoded = auth.verify_id_token(token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token.",
        ) from exc

    uid = decoded.get("uid")
    if not uid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload.",
        )

    return AuthenticatedUser(
        uid=uid,
        email=decoded.get("email") or "",
        auth_time=int(decoded.get("auth_time") or 0),
    )
