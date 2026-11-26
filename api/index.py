from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
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
from google.api_core.exceptions import NotFound
from pydantic import BaseModel, Field

from api.auth import AuthenticatedUser, get_current_user, is_user_admin, require_admin
from api.catalog import (
    add_game_to_catalog,
    canonicalize_game_url,
    get_catalog_games,
    normalize_category,
    remove_game_from_catalog,
    update_game_in_catalog,
)
from api.firebase_client import get_db
from api.inspector import inspect_daily_url
from api.notifier import (
    compute_slots_for_user_data,
    dispatch_due_notifications,
    local_today_str,
    sync_user_utc_notify_slots,
    validate_notify_time,
    validate_timezone,
)

app = FastAPI(title="Compiledle API", version="2.1.0")

RECENT_AUTH_WINDOW_SECONDS = 300
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DAILY_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{4,64}$")


class CreateDailyRequest(BaseModel):
    catalogId: str = Field(..., min_length=1, max_length=64)
    customNotifyTime: str | None = None


class UpdateDailyRequest(BaseModel):
    title: str | None = Field(default=None, max_length=80)
    customNotifyTime: str | None = None
    clearCustomNotifyTime: bool = False
    playedToday: bool | None = None
    localDate: str | None = None


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


def _is_compiledle_self_url(raw_url: str, request_host: str = "") -> bool:
    try:
        _, canonical_key, _ = canonicalize_game_url(raw_url)
    except ValueError:
        return False
    host = canonical_key.split("/", 1)[0].split("?", 1)[0].split(":", 1)[0].lower()
    blocked_hosts = {"compiledle.vercel.app"}
    req_host = request_host.split(",")[0].strip().split(":", 1)[0].lower()
    if req_host.startswith("www."):
        req_host = req_host[4:]
    if req_host and req_host not in ("localhost", "127.0.0.1"):
        blocked_hosts.add(req_host)
    return host in blocked_hosts


def _ensure_user_doc(
    uid: str,
    email: str,
    detected_tz: str | None = None,
) -> tuple[firestore.DocumentReference, dict[str, Any]]:
    """
    Loads (or initializes) `users/{uid}` in 1 single read. If a legacy user doc does not
    yet have the embedded `dailies` map, performs a one-time migration from the old
    `users/{uid}/dailies` subcollection into `users/{uid}.dailies` and deletes the old
    subcollection docs so future requests cost only 1 read total.
    """
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

        # One-time automatic migration from legacy `dailies` subcollection -> embedded map
        if "dailies" not in data:
            legacy_docs = list(user_ref.collection("dailies").stream())
            embedded: dict[str, dict[str, Any]] = {}
            for d_doc in legacy_docs:
                embedded[d_doc.id] = d_doc.to_dict() or {}
            data["dailies"] = embedded
            updates["dailies"] = embedded
            if legacy_docs:
                batch = db.batch()
                for d_doc in legacy_docs:
                    batch.delete(d_doc.reference)
                batch.commit()

        if "utcNotifySlots" not in data or "dailies" in updates:
            slots = compute_slots_for_user_data(data)
            data["utcNotifySlots"] = slots
            updates["utcNotifySlots"] = slots

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
        "dailies": {},
        "utcNotifySlots": [],
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
    _user_ref, user_data = _ensure_user_doc(user.uid, user.email, detected_tz=tz)
    user_tz = user_data.get("timezone") or "UTC"
    today_str = local_today_str(user_tz)
    catalog = get_catalog_games()

    dailies_map: dict[str, dict[str, Any]] = user_data.get("dailies") or {}
    raw_docs = [(did, d or {}) for did, d in dailies_map.items()]
    raw_docs.sort(key=_daily_sort_key)

    if "utcNotifySlots" not in user_data:
        sync_user_utc_notify_slots(user_ref, user_data, [d for _, d in raw_docs])

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
        user_data.update(updates)
        updates["utcNotifySlots"] = compute_slots_for_user_data(user_data)
        user_ref.update(updates)

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
    try:
        user_ref.update({"email": new_email})
    except NotFound:
        pass

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

    dailies_map: dict[str, dict[str, Any]] = dict(user_data.get("dailies") or {})
    for existing in dailies_map.values():
        if _resolve_catalog_id_for_daily(existing or {}, catalog) == body.catalogId:
            raise HTTPException(
                status_code=400,
                detail=f"{game['title']} is already in your dailies.",
            )

    numeric_orders = [
        int(d["order"]) for d in dailies_map.values() if isinstance((d or {}).get("order"), (int, float))
    ]
    next_order = (max(numeric_orders) + 1) if numeric_orders else len(dailies_map)

    daily_id = secrets.token_hex(10)
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

    dailies_map[daily_id] = doc_data
    user_data["dailies"] = dailies_map
    new_slots = compute_slots_for_user_data(user_data)

    user_ref.update(
        {
            f"dailies.{daily_id}": doc_data,
            "utcNotifySlots": new_slots,
        }
    )

    today_str = local_today_str(user_data.get("timezone") or "UTC")
    return _serialize_daily(
        daily_id,
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
    user_ref, user_data = _ensure_user_doc(user.uid, user.email)
    dailies_map: dict[str, dict[str, Any]] = user_data.get("dailies") or {}

    updates: dict[str, Any] = {}
    for idx, daily_id in enumerate(body.orderedIds):
        if daily_id in dailies_map:
            updates[f"dailies.{daily_id}.order"] = idx

    if updates:
        user_ref.update(updates)

    return {"status": "ok"}


@app.patch("/api/dailies/{daily_id}")
def update_daily(
    daily_id: str,
    body: UpdateDailyRequest,
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    if not DAILY_ID_PATTERN.match(daily_id):
        raise HTTPException(status_code=400, detail="Invalid daily identifier.")

    # Fast 0-read path for "Played Today" toggles (the most frequent write in the app)
    is_played_only = (
        body.playedToday is not None
        and body.title is None
        and body.customNotifyTime is None
        and not body.clearCustomNotifyTime
        and body.localDate is not None
        and bool(DATE_PATTERN.match(body.localDate))
    )
    if is_played_only:
        user_ref = get_db().collection("users").document(user.uid)
        next_date = body.localDate if body.playedToday else None
        try:
            user_ref.update({f"dailies.{daily_id}.lastPlayedDate": next_date})
        except NotFound as exc:
            raise HTTPException(status_code=404, detail="Daily not found.") from exc
        return {
            "id": daily_id,
            "playedToday": bool(body.playedToday),
            "lastPlayedDate": next_date,
        }

    user_ref, user_data = _ensure_user_doc(user.uid, user.email)
    dailies_map: dict[str, dict[str, Any]] = dict(user_data.get("dailies") or {})
    if daily_id not in dailies_map:
        raise HTTPException(status_code=404, detail="Daily not found.")

    current = dict(dailies_map[daily_id] or {})
    today_str = local_today_str(user_data.get("timezone") or "UTC")
    updates: dict[str, Any] = {}
    schedule_changed = False

    if body.title is not None:
        cleaned_title = body.title.strip()
        if not cleaned_title:
            raise HTTPException(status_code=400, detail="Title cannot be empty.")
        current["title"] = cleaned_title
        updates[f"dailies.{daily_id}.title"] = cleaned_title

    if body.clearCustomNotifyTime:
        current["customNotifyTime"] = None
        current["lastNotifiedDate"] = None
        updates[f"dailies.{daily_id}.customNotifyTime"] = None
        updates[f"dailies.{daily_id}.lastNotifiedDate"] = None
        schedule_changed = True
    elif body.customNotifyTime is not None:
        try:
            valid_time = validate_notify_time(body.customNotifyTime)
            if valid_time != current.get("customNotifyTime"):
                current["lastNotifiedDate"] = None
                updates[f"dailies.{daily_id}.lastNotifiedDate"] = None
            current["customNotifyTime"] = valid_time
            updates[f"dailies.{daily_id}.customNotifyTime"] = valid_time
            schedule_changed = True
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    if body.playedToday is not None:
        next_played_date = today_str if body.playedToday else None
        current["lastPlayedDate"] = next_played_date
        updates[f"dailies.{daily_id}.lastPlayedDate"] = next_played_date

    if updates:
        dailies_map[daily_id] = current
        user_data["dailies"] = dailies_map
        if schedule_changed:
            updates["utcNotifySlots"] = compute_slots_for_user_data(user_data)
        user_ref.update(updates)

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
    if not DAILY_ID_PATTERN.match(daily_id):
        raise HTTPException(status_code=400, detail="Invalid daily identifier.")
    user_ref, user_data = _ensure_user_doc(user.uid, user.email)
    dailies_map: dict[str, dict[str, Any]] = dict(user_data.get("dailies") or {})
    if daily_id not in dailies_map:
        raise HTTPException(status_code=404, detail="Daily not found.")

    dailies_map.pop(daily_id, None)
    user_data["dailies"] = dailies_map
    new_slots = compute_slots_for_user_data(user_data)

    user_ref.update(
        {
            f"dailies.{daily_id}": firestore.DELETE_FIELD,
            "utcNotifySlots": new_slots,
        }
    )
    return {"status": "deleted", "id": daily_id}


@app.post("/api/requests", status_code=status.HTTP_201_CREATED)
async def submit_game_request(
    request: Request,
    body: GameSubmissionRequest,
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    req_host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    if _is_compiledle_self_url(body.url, req_host):
        raise HTTPException(
            status_code=400,
            detail="Sorry, you can't suggest adding Compiledle to Compiledle!",
        )

    try:
        info = await inspect_daily_url(body.url, require_reachable=True)
        norm_url, canonical_key, url_id = canonicalize_game_url(info.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if _is_compiledle_self_url(norm_url, req_host):
        raise HTTPException(
            status_code=400,
            detail="Sorry, you can't suggest adding Compiledle to Compiledle!",
        )

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

    req_ref = get_db().collection("game_requests").document(added["id"])
    if req_ref.get().exists:
        req_ref.delete()

    return {"game": added}


@app.patch("/api/admin/catalog/{game_id}")
def admin_update_catalog_game(
    game_id: str,
    body: AcceptGameRequestBody,
    _admin: AuthenticatedUser = Depends(require_admin),
) -> dict[str, Any]:
    try:
        updated = update_game_in_catalog(
            game_id=game_id,
            title=body.title,
            category=body.category,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not updated:
        raise HTTPException(status_code=404, detail="Catalog game not found.")
    return {"game": updated}


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
    tokens = dict(user_data.get("fcmTokens") or {})
    tokens[token_hash] = entry
    user_data["fcmTokens"] = tokens
    user_data["notificationsEnabled"] = True
    new_slots = compute_slots_for_user_data(user_data)

    user_ref.update(
        {
            f"fcmTokens.{token_hash}": entry,
            "notificationsEnabled": True,
            "utcNotifySlots": new_slots,
        }
    )
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
    user_ref, user_data = _ensure_user_doc(user.uid, user.email)
    tokens = dict(user_data.get("fcmTokens") or {})
    tokens.pop(token_hash, None)
    user_data["fcmTokens"] = tokens
    new_slots = compute_slots_for_user_data(user_data)

    user_ref.update(
        {
            f"fcmTokens.{token_hash}": firestore.DELETE_FIELD,
            "utcNotifySlots": new_slots,
        }
    )
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
