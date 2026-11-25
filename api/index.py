from __future__ import annotations

import hashlib
import hmac
import os
import sys
import time
from datetime import datetime, timezone
from typing import Any

# Ensure root package imports resolve cleanly in both local uvicorn and Vercel runtime
_ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT_DIR not in sys.path:
    sys.path.insert(0, _ROOT_DIR)

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from firebase_admin import auth as firebase_auth
from firebase_admin import firestore
from pydantic import BaseModel, Field

from api.auth import AuthenticatedUser, get_current_user
from api.firebase_client import get_db
from api.inspector import inspect_daily_url, normalize_and_validate_url
from api.notifier import (
    dispatch_due_notifications,
    local_today_str,
    send_push_to_tokens,
    validate_notify_time,
    validate_timezone,
)

app = FastAPI(title="Compiledle API", version="1.1.0")

RECENT_AUTH_WINDOW_SECONDS = 300


class InspectUrlRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)


class CreateDailyRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)
    title: str | None = Field(default=None, max_length=80)
    iconUrl: str | None = Field(default=None, max_length=2048)
    embeddable: bool | None = None
    embedReason: str | None = Field(default=None, max_length=240)
    customNotifyTime: str | None = None


class UpdateDailyRequest(BaseModel):
    title: str | None = Field(default=None, max_length=80)
    embeddable: bool | None = None
    customNotifyTime: str | None = None
    clearCustomNotifyTime: bool = False
    playedToday: bool | None = None


class ReorderDailiesRequest(BaseModel):
    orderedIds: list[str] = Field(..., min_length=1, max_length=200)


class UpdateSettingsRequest(BaseModel):
    timezone: str | None = None
    defaultNotifyTime: str | None = None
    notificationsEnabled: bool | None = None


class UpdateAccountEmailRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=320)


class RegisterDeviceRequest(BaseModel):
    token: str = Field(..., min_length=16, max_length=4096)
    userAgent: str = Field(default="", max_length=512)


def _daily_sort_key(item: tuple[str, dict[str, Any]]) -> tuple[float, str]:
    _, data = item
    raw_order = data.get("order")
    order_val = float(raw_order) if isinstance(raw_order, (int, float)) else 10_000_000.0
    return (order_val, str(data.get("createdAt") or ""))


def _serialize_daily(
    doc_id: str, data: dict[str, Any], today_str: str, fallback_order: int = 0
) -> dict[str, Any]:
    last_played = data.get("lastPlayedDate")
    raw_order = data.get("order")
    order_val = int(raw_order) if isinstance(raw_order, (int, float)) else fallback_order
    return {
        "id": doc_id,
        "title": data.get("title") or "Daily Game",
        "url": data.get("url") or "",
        "iconUrl": data.get("iconUrl") or "",
        "embeddable": bool(data.get("embeddable", True)),
        "embedReason": data.get("embedReason") or "",
        "customNotifyTime": data.get("customNotifyTime"),
        "playedToday": last_played == today_str,
        "lastPlayedDate": last_played,
        "order": order_val,
        "createdAt": data.get("createdAt") or "",
    }


def _public_base_url(request: Request) -> str:
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    host = host.split(",")[0].strip()
    if not host or host.startswith(("localhost", "127.0.0.1")):
        return f"http://{host}" if host else ""
    return f"https://{host}"


def _require_recent_auth(user: AuthenticatedUser) -> None:
    if not user.auth_time or (time.time() - user.auth_time) > RECENT_AUTH_WINDOW_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="RECENT_LOGIN_REQUIRED",
        )


def _ensure_user_doc(
    uid: str,
    email: str,
    detected_tz: str | None = None,
) -> tuple[firestore.DocumentReference, dict[str, Any]]:
    db = get_db()
    user_ref = db.collection("users").document(uid)
    snap = user_ref.get()
    if snap.exists:
        data = snap.to_dict() or {}
        updates: dict[str, Any] = {}
        if detected_tz and not data.get("timezone"):
            try:
                valid_tz = validate_timezone(detected_tz)
                updates["timezone"] = valid_tz
                data["timezone"] = valid_tz
            except ValueError:
                pass
        if email and data.get("email") != email:
            updates["email"] = email
            data["email"] = email
        if updates:
            user_ref.update(updates)
        return user_ref, data

    tz_to_save = "UTC"
    if detected_tz:
        try:
            tz_to_save = validate_timezone(detected_tz)
        except ValueError:
            tz_to_save = "UTC"

    initial_data: dict[str, Any] = {
        "email": email,
        "timezone": tz_to_save,
        "defaultNotifyTime": "00:00",
        "notificationsEnabled": False,
        "lastGeneralNotifiedDate": None,
        "fcmTokens": {},
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    user_ref.set(initial_data)
    return user_ref, initial_data


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/me")
def get_me(
    tz: str | None = Query(default=None),
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    user_ref, user_data = _ensure_user_doc(user.uid, user.email, detected_tz=tz)
    user_tz = user_data.get("timezone") or "UTC"
    today_str = local_today_str(user_tz)

    raw_docs = [(doc.id, doc.to_dict() or {}) for doc in user_ref.collection("dailies").stream()]
    raw_docs.sort(key=_daily_sort_key)
    dailies = [
        _serialize_daily(doc_id, doc_data, today_str, fallback_order=idx)
        for idx, (doc_id, doc_data) in enumerate(raw_docs)
    ]

    fcm_tokens = user_data.get("fcmTokens") or {}
    return {
        "settings": {
            "email": user_data.get("email") or user.email,
            "timezone": user_tz,
            "defaultNotifyTime": user_data.get("defaultNotifyTime") or "00:00",
            "notificationsEnabled": bool(user_data.get("notificationsEnabled", False)),
            "deviceCount": len(fcm_tokens),
            "localToday": today_str,
        },
        "dailies": dailies,
    }


@app.patch("/api/settings")
def update_settings(
    body: UpdateSettingsRequest,
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    user_ref, user_data = _ensure_user_doc(user.uid, user.email)
    updates: dict[str, Any] = {}

    if body.timezone is not None:
        try:
            updates["timezone"] = validate_timezone(body.timezone)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    if body.defaultNotifyTime is not None:
        try:
            new_time = validate_notify_time(body.defaultNotifyTime)
            updates["defaultNotifyTime"] = new_time
            if new_time != user_data.get("defaultNotifyTime"):
                updates["lastGeneralNotifiedDate"] = None
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    if body.notificationsEnabled is not None:
        updates["notificationsEnabled"] = body.notificationsEnabled

    if updates:
        user_ref.update(updates)
        user_data.update(updates)

    user_tz = user_data.get("timezone") or "UTC"
    return {
        "email": user_data.get("email") or user.email,
        "timezone": user_tz,
        "defaultNotifyTime": user_data.get("defaultNotifyTime") or "00:00",
        "notificationsEnabled": bool(user_data.get("notificationsEnabled", False)),
        "deviceCount": len(user_data.get("fcmTokens") or {}),
        "localToday": local_today_str(user_tz),
    }


@app.patch("/api/account/email")
def update_account_email(
    body: UpdateAccountEmailRequest,
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, str]:
    _require_recent_auth(user)
    new_email = body.email.strip().lower()
    if "@" not in new_email or "." not in new_email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")

    try:
        fb_user = firebase_auth.get_user(user.uid)
        provider_ids = {p.provider_id for p in (fb_user.provider_data or [])}
        if "password" not in provider_ids:
            raise HTTPException(
                status_code=400,
                detail="Email is managed by your linked Google account and cannot be edited.",
            )
        firebase_auth.update_user(user.uid, email=new_email)
    except HTTPException:
        raise
    except firebase_auth.EmailAlreadyExistsError as exc:
        raise HTTPException(
            status_code=400, detail="An account with that email address already exists."
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail=f"Could not update email: {exc}"
        ) from exc

    db = get_db()
    user_ref = db.collection("users").document(user.uid)
    if user_ref.get().exists:
        user_ref.update({"email": new_email})

    return {"email": new_email}


@app.delete("/api/account")
def delete_account(
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, str]:
    _require_recent_auth(user)
    db = get_db()
    user_ref = db.collection("users").document(user.uid)

    # Delete all daily subcollection documents first, then the user document
    batch = db.batch()
    ops = 0
    for daily_doc in user_ref.collection("dailies").stream():
        batch.delete(daily_doc.reference)
        ops += 1
        if ops >= 450:
            batch.commit()
            batch = db.batch()
            ops = 0
    batch.delete(user_ref)
    batch.commit()

    try:
        firebase_auth.delete_user(user.uid)
    except firebase_auth.UserNotFoundError:
        pass
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to remove authentication record: {exc}"
        ) from exc

    return {"status": "deleted"}


@app.post("/api/dailies/inspect")
async def inspect_daily(
    body: InspectUrlRequest,
    _user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        info = await inspect_daily_url(body.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "url": info.url,
        "title": info.title,
        "iconUrl": info.icon_url,
        "embeddable": info.embeddable,
        "embedReason": info.embed_reason,
    }


@app.post("/api/dailies", status_code=status.HTTP_201_CREATED)
async def create_daily(
    body: CreateDailyRequest,
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    user_ref, user_data = _ensure_user_doc(user.uid, user.email)

    custom_time: str | None = None
    if body.customNotifyTime:
        try:
            custom_time = validate_notify_time(body.customNotifyTime)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        if body.title and body.embeddable is not None and body.iconUrl:
            normalized_url = normalize_and_validate_url(body.url)
            title = body.title.strip()
            icon_url = body.iconUrl.strip()
            embeddable = body.embeddable
            embed_reason = body.embedReason or ""
        else:
            info = await inspect_daily_url(body.url)
            normalized_url = info.url
            title = (body.title or info.title).strip()
            icon_url = (body.iconUrl or info.icon_url).strip()
            embeddable = info.embeddable if body.embeddable is None else body.embeddable
            embed_reason = body.embedReason if body.embedReason is not None else info.embed_reason
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    existing_orders = [
        d.to_dict().get("order")
        for d in user_ref.collection("dailies").stream()
        if d.exists
    ]
    numeric_orders = [int(o) for o in existing_orders if isinstance(o, (int, float))]
    next_order = (max(numeric_orders) + 1) if numeric_orders else len(existing_orders)

    now_iso = datetime.now(timezone.utc).isoformat()
    doc_data: dict[str, Any] = {
        "title": title or "Daily Game",
        "url": normalized_url,
        "iconUrl": icon_url,
        "embeddable": embeddable,
        "embedReason": embed_reason,
        "customNotifyTime": custom_time,
        "lastNotifiedDate": None,
        "lastPlayedDate": None,
        "order": next_order,
        "createdAt": now_iso,
    }
    _, doc_ref = user_ref.collection("dailies").add(doc_data)
    today_str = local_today_str(user_data.get("timezone") or "UTC")
    return _serialize_daily(doc_ref.id, doc_data, today_str, fallback_order=next_order)


@app.put("/api/dailies/reorder")
def reorder_dailies(
    body: ReorderDailiesRequest,
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, str]:
    db = get_db()
    user_ref, _ = _ensure_user_doc(user.uid, user.email)
    dailies_col = user_ref.collection("dailies")

    existing_ids = {doc.id for doc in dailies_col.stream()}
    batch = db.batch()
    updated = 0
    for idx, daily_id in enumerate(body.orderedIds):
        if daily_id in existing_ids:
            batch.update(dailies_col.document(daily_id), {"order": idx})
            updated += 1

    if updated > 0:
        batch.commit()

    return {"status": "ok"}


@app.patch("/api/dailies/{daily_id}")
def update_daily(
    daily_id: str,
    body: UpdateDailyRequest,
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    user_ref, user_data = _ensure_user_doc(user.uid, user.email)
    daily_ref = user_ref.collection("dailies").document(daily_id)
    snap = daily_ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Daily not found.")

    current = snap.to_dict() or {}
    today_str = local_today_str(user_data.get("timezone") or "UTC")
    updates: dict[str, Any] = {}

    if body.title is not None:
        cleaned_title = body.title.strip()
        if not cleaned_title:
            raise HTTPException(status_code=400, detail="Title cannot be empty.")
        updates["title"] = cleaned_title

    if body.embeddable is not None:
        updates["embeddable"] = body.embeddable

    if body.clearCustomNotifyTime:
        updates["customNotifyTime"] = None
        updates["lastNotifiedDate"] = None
    elif body.customNotifyTime is not None:
        try:
            valid_time = validate_notify_time(body.customNotifyTime)
            updates["customNotifyTime"] = valid_time
            if valid_time != current.get("customNotifyTime"):
                updates["lastNotifiedDate"] = None
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    if body.playedToday is not None:
        updates["lastPlayedDate"] = today_str if body.playedToday else None

    if updates:
        daily_ref.update(updates)
        current.update(updates)

    return _serialize_daily(daily_id, current, today_str)


@app.delete("/api/dailies/{daily_id}")
def delete_daily(
    daily_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, str]:
    user_ref, _ = _ensure_user_doc(user.uid, user.email)
    daily_ref = user_ref.collection("dailies").document(daily_id)
    if not daily_ref.get().exists:
        raise HTTPException(status_code=404, detail="Daily not found.")
    daily_ref.delete()
    return {"status": "deleted", "id": daily_id}


@app.post("/api/devices")
def register_device(
    body: RegisterDeviceRequest,
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    user_ref, user_data = _ensure_user_doc(user.uid, user.email)
    token_hash = hashlib.sha256(body.token.encode("utf-8")).hexdigest()[:24]
    now_iso = datetime.now(timezone.utc).isoformat()

    entry = {
        "token": body.token,
        "userAgent": body.userAgent,
        "updatedAt": now_iso,
    }
    user_ref.update(
        {
            f"fcmTokens.{token_hash}": entry,
            "notificationsEnabled": True,
        }
    )
    tokens = dict(user_data.get("fcmTokens") or {})
    tokens[token_hash] = entry
    return {
        "tokenHash": token_hash,
        "deviceCount": len(tokens),
        "notificationsEnabled": True,
    }


@app.delete("/api/devices/{token_hash}")
def unregister_device(
    token_hash: str,
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, str]:
    if not token_hash.isalnum():
        raise HTTPException(status_code=400, detail="Invalid device identifier.")
    user_ref, _ = _ensure_user_doc(user.uid, user.email)
    user_ref.update({f"fcmTokens.{token_hash}": firestore.DELETE_FIELD})
    return {"status": "removed"}


@app.post("/api/notifications/test")
def send_test_notification(
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    user_ref, user_data = _ensure_user_doc(user.uid, user.email)
    fcm_tokens = user_data.get("fcmTokens") or {}
    if not fcm_tokens:
        raise HTTPException(
            status_code=400,
            detail="No push-enabled devices registered yet. Enable push notifications on this device first.",
        )

    sent, stale, errors = send_push_to_tokens(
        fcm_tokens=fcm_tokens,
        title="Compiledle — Test Alert",
        body="Push notifications are working! You'll be notified at your scheduled times.",
        url="/",
        base_url=_public_base_url(request),
    )
    if stale:
        user_ref.update({f"fcmTokens.{h}": firestore.DELETE_FIELD for h in stale})

    if sent == 0:
        detail = (
            f"Push delivery failed: {errors[0]}"
            if errors
            else "Registered push token expired. Please click 'Enable on This Device' again."
        )
        raise HTTPException(status_code=400, detail=detail)
    return {"sent": sent}


@app.api_route("/api/cron/notify", methods=["GET", "POST"])
def cron_notify(
    request: Request, authorization: str | None = Header(default=None)
) -> dict[str, Any]:
    expected_secret = os.environ.get("CRON_SECRET", "").strip()
    if not expected_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="CRON_SECRET is not configured on the server.",
        )

    provided = ""
    if authorization and authorization.lower().startswith("bearer "):
        provided = authorization.split(" ", 1)[1].strip()

    if not provided or not hmac.compare_digest(provided, expected_secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid cron authorization secret.",
        )

    summary = dispatch_due_notifications(base_url=_public_base_url(request))
    return {"status": "ok", **summary}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api.index:app", host="127.0.0.1", port=8000, reload=True)
