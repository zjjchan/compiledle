from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
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


def group_due_dailies_by_time(
    dailies: list[tuple[str, dict[str, Any]]],
    default_time: str,
    last_general_date: str | None,
    local_dt: datetime,
) -> dict[str, list[tuple[str, str, bool]]]:
    """
    Groups all unplayed, un-notified dailies that are currently due into buckets keyed by
    their effective scheduled time ("HH:MM"), so each scheduled time triggers at most one
    batched notification regardless of how many dailies share that time.

    Returns { "HH:MM": [(daily_id, title, is_custom_time), ...] }.
    """
    today_str = local_dt.strftime("%Y-%m-%d")
    due_by_time: dict[str, list[tuple[str, str, bool]]] = {}

    for daily_id, d_data in dailies:
        if d_data.get("lastPlayedDate") == today_str:
            continue

        custom_time = d_data.get("customNotifyTime")
        is_custom = bool(custom_time)
        effective_time = custom_time or default_time

        if is_custom:
            if d_data.get("lastNotifiedDate") == today_str:
                continue
        else:
            if last_general_date == today_str:
                continue

        if not is_time_due(effective_time, local_dt):
            continue

        title = d_data.get("title") or "Daily Game"
        due_by_time.setdefault(effective_time, []).append((daily_id, title, is_custom))

    return due_by_time


def compute_utc_notify_slots(
    local_times: set[str],
    tz_name: str,
    enabled: bool,
    has_tokens: bool,
) -> list[str]:
    """
    Converts a user's active local reminder times ("HH:MM") into 15-minute UTC slot
    keys ("HH:MM") stored on `users/{uid}.utcNotifySlots`. Evaluates both Jan 15 and
    Jul 15 so DST transitions stay covered automatically without re-syncing.
    """
    if not enabled or not has_tokens or not local_times:
        return []

    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("UTC")

    year = datetime.now(timezone.utc).year
    slots: set[str] = set()
    for month in (1, 7):
        for hhmm in local_times:
            match = TIME_PATTERN.match(hhmm.strip())
            if not match:
                continue
            h, m = int(match.group(1)), int(match.group(2))
            local_dt = datetime(year, month, 15, h, m, tzinfo=tz)
            utc_dt = local_dt.astimezone(timezone.utc)
            floored_min = (utc_dt.minute // 15) * 15
            slots.add(f"{utc_dt.hour:02d}:{floored_min:02d}")
    return sorted(slots)


def current_utc_query_slots(now_utc: datetime) -> list[str]:
    """
    Returns the current and previous 15-minute UTC slots (e.g. ["00:00", "23:45"] at
    00:02 UTC) to match the 30-minute `is_time_due` jitter window.
    """
    ref = now_utc.astimezone(timezone.utc) if now_utc.tzinfo else now_utc.replace(tzinfo=timezone.utc)
    cur_min = (ref.minute // 15) * 15
    cur_dt = ref.replace(minute=cur_min, second=0, microsecond=0)
    prev_dt = cur_dt - timedelta(minutes=15)
    return [cur_dt.strftime("%H:%M"), prev_dt.strftime("%H:%M")]


def compute_slots_for_user_data(user_data: dict[str, Any]) -> list[str]:
    enabled = bool(user_data.get("notificationsEnabled", False))
    has_tokens = bool(user_data.get("fcmTokens"))
    if not enabled or not has_tokens:
        return []
    dailies_map: dict[str, dict[str, Any]] = user_data.get("dailies") or {}
    if not dailies_map:
        return []
    default_time = user_data.get("defaultNotifyTime") or "00:00"
    local_times = {
        (d or {}).get("customNotifyTime") or default_time for d in dailies_map.values()
    }
    tz_name = user_data.get("timezone") or "UTC"
    return compute_utc_notify_slots(local_times, tz_name, enabled=True, has_tokens=True)


def dispatch_due_notifications(
    now_utc: datetime | None = None, base_url: str | None = None
) -> dict[str, int]:
    """
    Queries only users whose `utcNotifySlots` matches the current or previous 15-minute
    UTC slot, reads embedded `users/{uid}.dailies` with 0 extra subcollection reads,
    and sends at most one batched notification per scheduled time slot.
    """
    db = get_db()
    ref_utc = now_utc or datetime.now(timezone.utc)
    query_slots = current_utc_query_slots(ref_utc)

    users_checked = 0
    notifications_sent = 0
    stale_tokens_pruned = 0

    users_query = db.collection("users").where(
        filter=firestore.FieldFilter("utcNotifySlots", "array_contains_any", query_slots)
    )

    for user_doc in users_query.stream():
        users_checked += 1
        user_data = user_doc.to_dict() or {}
        if not user_data.get("notificationsEnabled"):
            continue
        fcm_tokens: dict[str, dict[str, Any]] = user_data.get("fcmTokens") or {}
        if not fcm_tokens:
            continue

        tz_name = user_data.get("timezone") or "UTC"
        local_dt = local_now_for_timezone(tz_name, ref_utc)
        today_str = local_dt.strftime("%Y-%m-%d")

        default_time = user_data.get("defaultNotifyTime") or "00:00"
        last_general_date = user_data.get("lastGeneralNotifiedDate")

        # Use embedded dailies map (0 extra reads); fall back to legacy subcollection only if unmigrated
        if "dailies" in user_data:
            dailies_map: dict[str, dict[str, Any]] = user_data.get("dailies") or {}
            daily_entries = [(did, d or {}) for did, d in dailies_map.items()]
            is_embedded = True
        else:
            legacy_docs = list(user_doc.reference.collection("dailies").stream())
            daily_entries = [(d.id, d.to_dict() or {}) for d in legacy_docs]
            is_embedded = False

        if not daily_entries:
            continue

        due_by_time = group_due_dailies_by_time(
            dailies=daily_entries,
            default_time=default_time,
            last_general_date=last_general_date,
            local_dt=local_dt,
        )

        all_stale_hashes: set[str] = set()
        user_updates: dict[str, Any] = {}

        for _time_slot, items in due_by_time.items():
            titles = [title for _, title, _ in items]
            if len(titles) == 1:
                notif_title = f"Time to play {titles[0]}!"
                notif_body = "Tap to open Compiledle and play today's puzzle."
            else:
                notif_title = "Your Dailies Are Ready!"
                notif_body = format_general_notification_body(titles)

            sent, stale, _ = send_push_to_tokens(
                fcm_tokens=fcm_tokens,
                title=notif_title,
                body=notif_body,
                url="/",
                base_url=base_url,
            )
            all_stale_hashes.update(stale)
            if sent > 0:
                notifications_sent += sent
                for daily_id, _title, is_custom in items:
                    if is_custom:
                        if is_embedded:
                            user_updates[f"dailies.{daily_id}.lastNotifiedDate"] = today_str
                        else:
                            user_doc.reference.collection("dailies").document(daily_id).update(
                                {"lastNotifiedDate": today_str}
                            )
                    else:
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
