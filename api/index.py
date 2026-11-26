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

from api.auth import AuthenticatedUser, get_current_user, is_user_admin, require_admin
from api.catalog import (
    add_game_to_catalog,
    canonicalize_game_url,
    get_catalog_games,
    normalize_category,
    remove_game_from_catalog,
)
from api.firebase_client import get_db
from api.inspector import inspect_daily_url
from api.notifier import (
    dispatch_due_notifications,
    local_today_str,
    validate_notify_time,
    validate_timezone,
)

app = FastAPI(title="Compiledle API", version="2.0.0")

RECENT_AUTH_WINDOW_SECONDS = 300


class CreateDailyRequest(BaseModel):
    catalogId: str = Field(..., min_length=1, max_length=64)
    customNotifyTime: str | None = None


class UpdateDailyRequest(BaseModel):
    title: str | None = Field(default=None, max_length=80)
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


class GameSubmissionRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)
    title: str | None = Field(default=None, max_length=80)
    category: str | None = Field(default=None, max_length=40)


class AcceptGameRequestBody(BaseModel):
    title: str | None = Field(default=None, max_length=80)
    category: str | None = Field(default=None, max_length=40)


def _daily_sort_key(item: tuple[str, dict[str, Any]]) -> tuple[float, str]:
    _, data = item
    raw_order = data.get("order")
    order_val = float(raw_order) if isinstance(raw_order, (int, float)) else 10_000_000.0
    return (order_val, str(data.get("createdAt") or ""))


def _request_sort_key(item: dict[str, Any]) -> tuple[int, str]:
    return (-int(item.get("requestCount") or 0), str(item.get("title") or "").lower())


def _resolve_catalog_id_for_daily(
    data: dict[str, Any], catalog: dict[str, dict[str, Any]]
) -> str | None:
    explicit_id = data.get("catalogId")
    if explicit_id and explicit_id in catalog:
        return str(explicit_id)
    raw_url = data.get("url") or ""
    if not raw_url:
        return None
    try:
        _, _, derived_id = canonicalize_game_url(raw_url)
        if derived_id in catalog:
            return derived_id
    except ValueError:
        return None
    return None


def _serialize_daily(
    doc_id: str,
    data: dict[str, Any],
    today_str: str,
    catalog_id: str,
    fallback_order: int = 0,
) -> dict[str, Any]:
    last_played = data.get("lastPlayedDate")
    raw_order = data.get("order")
    order_val = int(raw_order) if isinstance(raw_order, (int, float)) else fallback_order
    return {
        "id": doc_id,
        "catalogId": catalog_id,
        "title": data.get("title") or "Daily Game",
        "url": data.get("url") or "",
        "iconUrl": data.get("iconUrl") or "",
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
        "isAdmin": False,
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
    catalog = get_catalog_games()

    raw_docs = [(doc.id, doc.to_dict() or {}) for doc in user_ref.collection("dailies").stream()]
    raw_docs.sort(key=_daily_sort_key)

    dailies: list[dict[str, Any]] = []
    for idx, (doc_id, doc_data) in enumerate(raw_docs):
        matched_catalog_id = _resolve_catalog_id_for_daily(doc_data, catalog)
        if not matched_catalog_id:
            continue
        dailies.append(
            _serialize_daily(
                doc_id,
                doc_data,
                today_str,
                catalog_id=matched_catalog_id,
                fallback_order=idx,
            )
        )

    fcm_tokens = user_data.get("fcmTokens") or {}
    return {
        "settings": {
            "email": user_data.get("email") or user.email,
            "timezone": user_tz,
            "defaultNotifyTime": user_data.get("defaultNotifyTime") or "00:00",
            "notificationsEnabled": bool(user_data.get("notificationsEnabled", False)),
            "deviceCount": len(fcm_tokens),
            "localToday": today_str,
            "isAdmin": is_user_admin(user, user_data),
        },
        "dailies": dailies,
    }


@app.get("/api/catalog")
def list_catalog(
    _user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    games_map = get_catalog_games()
    games_list = sorted(games_map.values(), key=lambda g: str(g.get("title") or "").lower())
    return {"games": games_list}


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
        "isAdmin": is_user_admin(user, user_data),
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


@app.post("/api/dailies", status_code=status.HTTP_201_CREATED)
def create_daily(
    body: CreateDailyRequest,
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    user_ref, user_data = _ensure_user_doc(user.uid, user.email)
    catalog = get_catalog_games()
    game = catalog.get(body.catalogId)
    if not game:
        raise HTTPException(
            status_code=400,
            detail="Selected game is not in Compiledle's catalog.",
        )

    custom_time: str | None = None
    if body.customNotifyTime:
        try:
            custom_time = validate_notify_time(body.customNotifyTime)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    existing_docs = [d.to_dict() or {} for d in user_ref.collection("dailies").stream()]
    for existing in existing_docs:
        if _resolve_catalog_id_for_daily(existing, catalog) == body.catalogId:
            raise HTTPException(
                status_code=400,
                detail=f"{game['title']} is already in your dailies.",
            )

    numeric_orders = [
        int(d["order"]) for d in existing_docs if isinstance(d.get("order"), (int, float))
    ]
    next_order = (max(numeric_orders) + 1) if numeric_orders else len(existing_docs)

    now_iso = datetime.now(timezone.utc).isoformat()
    doc_data: dict[str, Any] = {
        "catalogId": body.catalogId,
        "title": game["title"],
        "url": game["url"],
        "iconUrl": game["iconUrl"],
        "customNotifyTime": custom_time,
        "lastNotifiedDate": None,
        "lastPlayedDate": None,
        "order": next_order,
        "createdAt": now_iso,
    }
    _, doc_ref = user_ref.collection("dailies").add(doc_data)
    today_str = local_today_str(user_data.get("timezone") or "UTC")
    return _serialize_daily(
        doc_ref.id,
        doc_data,
        today_str,
        catalog_id=body.catalogId,
        fallback_order=next_order,
    )


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

    catalog = get_catalog_games()
    matched_id = _resolve_catalog_id_for_daily(current, catalog) or str(
        current.get("catalogId") or ""
    )
    return _serialize_daily(daily_id, current, today_str, catalog_id=matched_id)


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


@app.post("/api/requests", status_code=status.HTTP_201_CREATED)
async def submit_game_request(
    body: GameSubmissionRequest,
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        info = await inspect_daily_url(body.url, require_reachable=True)
        norm_url, canonical_key, url_id = canonicalize_game_url(info.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    catalog = get_catalog_games()
    if url_id in catalog:
        raise HTTPException(
            status_code=400,
            detail=f"{catalog[url_id]['title']} is already in Compiledle's catalog!",
        )

    db = get_db()
    req_ref = db.collection("game_requests").document(url_id)
    snap = req_ref.get()
    now_iso = datetime.now(timezone.utc).isoformat()

    if snap.exists:
        data = snap.to_dict() or {}
        requesters = dict(data.get("requesters") or {})
        if user.uid in requesters:
            raise HTTPException(
                status_code=400,
                detail="You have already requested this game.",
            )
        requesters[user.uid] = now_iso
        new_count = len(requesters)
        req_ref.update(
            {
                f"requesters.{user.uid}": now_iso,
                "requestCount": new_count,
                "updatedAt": now_iso,
            }
        )
        return {
            "id": url_id,
            "title": data.get("title") or info.title,
            "url": data.get("url") or norm_url,
            "requestCount": new_count,
        }

    final_title = (body.title or "").strip()[:80] or info.title
    entry = {
        "id": url_id,
        "title": final_title,
        "url": norm_url,
        "canonicalKey": canonical_key,
        "category": normalize_category(body.category),
        "iconUrl": info.icon_url,
        "requesters": {user.uid: now_iso},
        "requestCount": 1,
        "createdAt": now_iso,
        "updatedAt": now_iso,
    }
    req_ref.set(entry)
    return {
        "id": url_id,
        "title": final_title,
        "url": norm_url,
        "requestCount": 1,
    }


@app.get("/api/admin/requests")
def admin_list_requests(
    _admin: AuthenticatedUser = Depends(require_admin),
) -> dict[str, Any]:
    db = get_db()
    items: list[dict[str, Any]] = []
    for doc in db.collection("game_requests").stream():
        data = doc.to_dict() or {}
        requesters = data.get("requesters") or {}
        count = int(data.get("requestCount") or len(requesters))
        items.append(
            {
                "id": doc.id,
                "title": data.get("title") or "Daily Game",
                "url": data.get("url") or "",
                "category": normalize_category(data.get("category")),
                "iconUrl": data.get("iconUrl") or "",
                "requestCount": count,
                "createdAt": data.get("createdAt") or "",
            }
        )
    items.sort(key=_request_sort_key)
    return {"requests": items}


@app.post("/api/admin/requests/{request_id}/accept")
def admin_accept_request(
    request_id: str,
    body: AcceptGameRequestBody | None = None,
    _admin: AuthenticatedUser = Depends(require_admin),
) -> dict[str, Any]:
    db = get_db()
    req_ref = db.collection("game_requests").document(request_id)
    snap = req_ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Game request not found.")

    data = snap.to_dict() or {}
    title = ((body.title if body else None) or data.get("title") or "Daily Game").strip()
    category = (body.category if body and body.category else data.get("category")) or "Other"

    try:
        added = add_game_to_catalog(
            url=data.get("url") or "",
            title=title,
            category=category,
            icon_url=data.get("iconUrl"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    req_ref.delete()
    return {"game": added}


@app.delete("/api/admin/requests/{request_id}")
def admin_reject_request(
    request_id: str,
    _admin: AuthenticatedUser = Depends(require_admin),
) -> dict[str, str]:
    db = get_db()
    req_ref = db.collection("game_requests").document(request_id)
    if not req_ref.get().exists:
        raise HTTPException(status_code=404, detail="Game request not found.")
    req_ref.delete()
    return {"status": "rejected", "id": request_id}


@app.post("/api/admin/catalog", status_code=status.HTTP_201_CREATED)
async def admin_add_catalog_game(
    body: GameSubmissionRequest,
    _admin: AuthenticatedUser = Depends(require_admin),
) -> dict[str, Any]:
    try:
        info = await inspect_daily_url(body.url, require_reachable=True)
        title = (body.title or "").strip()[:80] or info.title
        added = add_game_to_catalog(
            url=info.url,
            title=title,
            category=body.category,
            icon_url=info.icon_url,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Clean up any matching pending request for the same URL
    req_ref = get_db().collection("game_requests").document(added["id"])
    if req_ref.get().exists:
        req_ref.delete()

    return {"game": added}


@app.delete("/api/admin/catalog/{game_id}")
def admin_remove_catalog_game(
    game_id: str,
    _admin: AuthenticatedUser = Depends(require_admin),
) -> dict[str, str]:
    removed = remove_game_from_catalog(game_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Catalog game not found.")
    return {"status": "removed", "id": game_id}


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
