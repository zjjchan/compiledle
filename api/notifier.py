from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from firebase_admin import firestore, messaging

from api.firebase_client import get_db

TIME_PATTERN = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def validate_notify_time(value: str) -> str:
    cleaned = value.strip()
    if not TIME_PATTERN.match(cleaned):
        raise ValueError("Time must be in 24-hour HH:MM format (e.g. '00:00' or '08:30').")
    return cleaned


def validate_timezone(tz_name: str) -> str:
    cleaned = tz_name.strip()
    try:
        ZoneInfo(cleaned)
    except (ZoneInfoNotFoundError, KeyError, ValueError) as exc:
        raise ValueError(f"Unsupported IANA timezone: '{tz_name}'.") from exc
    return cleaned


def local_now_for_timezone(tz_name: str, now_utc: datetime | None = None) -> datetime:
    ref_utc = now_utc or datetime.now(timezone.utc)
    if ref_utc.tzinfo is None:
        ref_utc = ref_utc.replace(tzinfo=timezone.utc)
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("UTC")
    return ref_utc.astimezone(tz)


def local_today_str(tz_name: str, now_utc: datetime | None = None) -> str:
    return local_now_for_timezone(tz_name, now_utc).strftime("%Y-%m-%d")


def is_time_due(notify_time: str, local_dt: datetime, window_minutes: int = 30) -> bool:
    """
    Returns True if `local_dt` falls at or within `window_minutes` after `notify_time`
    on the current local calendar day. Paired with `lastNotifiedDate != today_str`,
    this handles cron jitter gracefully without ever double-sending or firing hours late.
    """
    match = TIME_PATTERN.match(notify_time.strip())
    if not match:
        return False
    sched_mins = int(match.group(1)) * 60 + int(match.group(2))
    now_mins = local_dt.hour * 60 + local_dt.minute
    diff = now_mins - sched_mins
    return 0 <= diff < window_minutes


def absolute_https_url(base_url: str | None, path: str) -> str | None:
    """FCM requires an absolute HTTPS click link; returns None for local http origins."""
    if not base_url or not base_url.startswith("https://"):
        return None
    return base_url.rstrip("/") + path


def send_push_to_tokens(
    fcm_tokens: dict[str, dict[str, Any]],
    title: str,
    body: str,
    url: str = "/",
    base_url: str | None = None,
) -> tuple[int, list[str], list[str]]:
    """
    Dispatches a Web Push notification to all registered device tokens for a user.
    Returns (sent_count, stale_token_hashes_to_delete, error_messages).
    """
    sent = 0
    stale_hashes: list[str] = []
    errors: list[str] = []

    link = absolute_https_url(base_url, url)
    icon = absolute_https_url(base_url, "/icons/icon-192.png") or "/icons/icon-192.png"
    badge = absolute_https_url(base_url, "/icons/badge-96.png") or "/icons/badge-96.png"

    for token_hash, entry in fcm_tokens.items():
        token = (entry or {}).get("token")
        if not token:
            stale_hashes.append(token_hash)
            continue

        msg = messaging.Message(
            data={"title": title, "body": body, "url": url},
            webpush=messaging.WebpushConfig(
                notification=messaging.WebpushNotification(
                    title=title,
                    body=body,
                    icon=icon,
                    badge=badge,
                ),
                fcm_options=messaging.WebpushFCMOptions(link=link) if link else None,
            ),
            token=token,
        )
        try:
            messaging.send(msg)
            sent += 1
        except (messaging.UnregisteredError, messaging.SenderIdMismatchError):
            stale_hashes.append(token_hash)
        except Exception as exc:
            err_text = str(exc)
            lowered = err_text.lower()
            if "not a valid fcm registration token" in lowered or "unregistered" in lowered:
                stale_hashes.append(token_hash)
            else:
                print(f"FCM send failed: {type(exc).__name__}: {err_text}")
                errors.append(err_text)

    return sent, stale_hashes, errors


def format_general_notification_body(titles: list[str]) -> str:
    if len(titles) == 1:
        return f"Ready to play: {titles[0]}"
    if len(titles) <= 3:
        return "Ready to play: " + ", ".join(titles)
    shown = ", ".join(titles[:2])
    remaining = len(titles) - 2
    return f"Ready to play: {shown} (+{remaining} more)"


def dispatch_due_notifications(
    now_utc: datetime | None = None, base_url: str | None = None
) -> dict[str, int]:
    """
    Evaluates all opted-in users in their respective local timezones and dispatches:
    1) One consolidated general notification at `defaultNotifyTime` (default 00:00)
       for unplayed dailies that do NOT specify a custom time.
    2) Dedicated notifications for each unplayed daily with a `customNotifyTime`.
    """
    db = get_db()
    ref_utc = now_utc or datetime.now(timezone.utc)

    users_checked = 0
    notifications_sent = 0
    stale_tokens_pruned = 0

    users_query = db.collection("users").where(
        filter=firestore.FieldFilter("notificationsEnabled", "==", True)
    )

    for user_doc in users_query.stream():
        users_checked += 1
        user_data = user_doc.to_dict() or {}
        fcm_tokens: dict[str, dict[str, Any]] = user_data.get("fcmTokens") or {}
        if not fcm_tokens:
            continue

        tz_name = user_data.get("timezone") or "UTC"
        local_dt = local_now_for_timezone(tz_name, ref_utc)
        today_str = local_dt.strftime("%Y-%m-%d")

        default_time = user_data.get("defaultNotifyTime") or "00:00"
        last_general_date = user_data.get("lastGeneralNotifiedDate")

        dailies_ref = user_doc.reference.collection("dailies")
        daily_docs = list(dailies_ref.stream())
        if not daily_docs:
            continue

        general_due_titles: list[str] = []
        general_time_matched = (
            last_general_date != today_str and is_time_due(default_time, local_dt)
        )

        all_stale_hashes: set[str] = set()

        for d_doc in daily_docs:
            d_data = d_doc.to_dict() or {}
            if d_data.get("lastPlayedDate") == today_str:
                continue  # Already played today in local timezone

            custom_time = d_data.get("customNotifyTime")
            title = d_data.get("title") or "Daily Game"

            if custom_time:
                if d_data.get("lastNotifiedDate") != today_str and is_time_due(custom_time, local_dt):
                    sent, stale, _ = send_push_to_tokens(
                        fcm_tokens=fcm_tokens,
                        title=f"Time to play {title}!",
                        body="Tap to jump right into today's puzzle.",
                        url=f"/?play={d_doc.id}",
                        base_url=base_url,
                    )
                    all_stale_hashes.update(stale)
                    if sent > 0:
                        notifications_sent += sent
                        d_doc.reference.update({"lastNotifiedDate": today_str})
            elif general_time_matched:
                general_due_titles.append(title)

        user_updates: dict[str, Any] = {}
        if general_time_matched and general_due_titles:
            sent, stale, _ = send_push_to_tokens(
                fcm_tokens=fcm_tokens,
                title="Your Dailies Are Ready!",
                body=format_general_notification_body(general_due_titles),
                url="/",
                base_url=base_url,
            )
            all_stale_hashes.update(stale)
            if sent > 0:
                notifications_sent += sent
                user_updates["lastGeneralNotifiedDate"] = today_str

        for dead_hash in all_stale_hashes:
            user_updates[f"fcmTokens.{dead_hash}"] = firestore.DELETE_FIELD
            stale_tokens_pruned += 1

        if user_updates:
            user_doc.reference.update(user_updates)

    return {
        "usersChecked": users_checked,
        "notificationsSent": notifications_sent,
        "staleTokensPruned": stale_tokens_pruned,
    }
