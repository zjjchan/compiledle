from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status
from firebase_admin import auth

from api.firebase_client import ensure_firebase_initialized, get_db


@dataclass(frozen=True)
class AuthenticatedUser:
    uid: str
    email: str
    auth_time: int = 0
    is_admin_claim: bool = False


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
        is_admin_claim=bool(decoded.get("admin") is True),
    )


def is_user_admin(user: AuthenticatedUser, user_doc_data: dict | None = None) -> bool:
    if user.is_admin_claim:
        return True
    if user_doc_data is not None:
        return bool(user_doc_data.get("isAdmin") is True)
    snap = get_db().collection("users").document(user.uid).get()
    if not snap.exists:
        return False
    return bool((snap.to_dict() or {}).get("isAdmin") is True)


def require_admin(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
    if not is_user_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )
    return user
