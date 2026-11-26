from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from api.auth import AuthenticatedUser
from api.catalog import _load_seed_catalog, canonicalize_game_url
from api.index import (
    _daily_sort_key,
    _is_compiledle_self_url,
    _request_sort_key,
    _require_recent_auth,
    app,
)
from api.inspector import normalize_and_validate_url
from api.notifier import (
    compute_utc_notify_slots,
    current_utc_query_slots,
    format_general_notification_body,
    group_due_dailies_by_time,
    is_time_due,
    local_now_for_timezone,
    validate_notify_time,
    validate_timezone,
)


def test_ssrf_and_scheme_validation() -> None:
    with pytest.raises(ValueError):
        normalize_and_validate_url("javascript:alert(1)")

    with pytest.raises(ValueError):
        normalize_and_validate_url("http://localhost:8000/secret")

    with pytest.raises(ValueError):
        normalize_and_validate_url("http://127.0.0.1/admin")

    with pytest.raises(ValueError):
        normalize_and_validate_url("http://169.254.169.254/latest/meta-data/")


def test_timezone_and_15m_window_matching() -> None:
    assert validate_notify_time("00:00") == "00:00"
    assert validate_notify_time("23:45") == "23:45"
    with pytest.raises(ValueError):
        validate_notify_time("25:00")

    assert validate_timezone("Asia/Singapore") == "Asia/Singapore"
    with pytest.raises(ValueError):
        validate_timezone("Invalid/Zone")

    # 16:02 UTC is 00:02 next day in Asia/Singapore (UTC+8)
    utc_dt = datetime(2026, 11, 25, 16, 2, tzinfo=timezone.utc)
    sg_dt = local_now_for_timezone("Asia/Singapore", utc_dt)
    assert sg_dt.strftime("%Y-%m-%d") == "2026-11-26"
    assert is_time_due("00:00", sg_dt) is True
    assert is_time_due("00:15", sg_dt) is False

    afternoon_sg = datetime(2026, 11, 26, 14, 0, tzinfo=ZoneInfo("Asia/Singapore"))
    assert is_time_due("00:00", afternoon_sg) is False


def test_general_notification_body_formatting() -> None:
    assert format_general_notification_body(["Wordle"]) == "Ready to play: Wordle"
    assert (
        format_general_notification_body(["Wordle", "Connections"])
        == "Ready to play: Wordle, Connections"
    )
    assert (
        format_general_notification_body(["Wordle", "Connections", "Krillion", "Framed"])
        == "Ready to play: Wordle, Connections (+2 more)"
    )


def test_api_health_and_cron_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CRON_SECRET", "super-secret-token")
    client = TestClient(app)

    res_health = client.get("/api/health")
    assert res_health.status_code == 200
    assert res_health.json() == {"status": "ok"}

    res_unauth = client.get("/api/me")
    assert res_unauth.status_code == 401

    res_bad_cron = client.get("/api/cron/notify", headers={"Authorization": "Bearer wrong"})
    assert res_bad_cron.status_code == 401

    monkeypatch.setattr(
        "api.index.dispatch_due_notifications",
        lambda **_: {"usersChecked": 2, "notificationsSent": 3, "staleTokensPruned": 0},
    )
    res_ok_cron = client.post(
        "/api/cron/notify", headers={"Authorization": "Bearer super-secret-token"}
    )
    assert res_ok_cron.status_code == 200
    assert res_ok_cron.json()["notificationsSent"] == 3


def test_daily_sort_key_preserves_legacy_and_explicit_order() -> None:
    items = [
        ("c", {"createdAt": "2026-11-26T03:00:00Z"}),
        ("a", {"order": 1, "createdAt": "2026-11-26T02:00:00Z"}),
        ("b", {"order": 0, "createdAt": "2026-11-26T01:00:00Z"}),
    ]
    items.sort(key=_daily_sort_key)
    assert [doc_id for doc_id, _ in items] == ["b", "a", "c"]


def test_recent_auth_guard() -> None:
    import time
    from fastapi import HTTPException

    fresh_user = AuthenticatedUser(uid="u1", email="a@b.com", auth_time=int(time.time()))
    _require_recent_auth(fresh_user)

    stale_user = AuthenticatedUser(uid="u1", email="a@b.com", auth_time=int(time.time()) - 600)
    with pytest.raises(HTTPException) as exc_info:
        _require_recent_auth(stale_user)
    assert exc_info.value.status_code == 403


def test_group_due_dailies_batches_by_time_slot() -> None:
    sg_1300 = datetime(2026, 11, 26, 13, 2, tzinfo=ZoneInfo("Asia/Singapore"))
    dailies = [
        ("ref1", {"title": "Krillion", "customNotifyTime": "13:00"}),
        ("ref2", {"title": "Connections", "customNotifyTime": "13:00"}),
        ("ref3", {"title": "Wordle", "customNotifyTime": "13:00", "lastPlayedDate": "2026-11-26"}),
        ("ref4", {"title": "Framed", "customNotifyTime": "13:00", "lastNotifiedDate": "2026-11-26"}),
        ("ref5", {"title": "Worldle", "customNotifyTime": "18:00"}),
    ]
    grouped = group_due_dailies_by_time(dailies, "00:00", None, sg_1300)
    assert list(grouped.keys()) == ["13:00"]
    assert [title for _, title, _ in grouped["13:00"]] == ["Krillion", "Connections"]

    # Also merges explicit custom time matching default time into a single batch
    sg_0000 = datetime(2026, 11, 26, 0, 1, tzinfo=ZoneInfo("Asia/Singapore"))
    midnight_dailies = [
        ("ref1", {"title": "Wordle", "customNotifyTime": None}),
        ("ref2", {"title": "Minute Cryptic", "customNotifyTime": "00:00"}),
    ]
    grouped_midnight = group_due_dailies_by_time(midnight_dailies, "00:00", None, sg_0000)
    assert list(grouped_midnight.keys()) == ["00:00"]
    assert [title for _, title, _ in grouped_midnight["00:00"]] == ["Wordle", "Minute Cryptic"]


def test_canonicalize_game_url_deduplicates_variants() -> None:
    _, k1, id1 = canonicalize_game_url("https://www.nytimes.com/games/wordle/index.html?utm_source=x")
    _, k2, id2 = canonicalize_game_url("nytimes.com/games/wordle/")
    _, k3, id3 = canonicalize_game_url("http://nytimes.com/games/wordle")
    assert k1 == k2 == k3 == "nytimes.com/games/wordle"
    assert id1 == id2 == id3


def test_request_sort_order_by_count_desc_then_name_asc() -> None:
    reqs = [
        {"title": "Zebra", "requestCount": 2},
        {"title": "Alpha", "requestCount": 2},
        {"title": "Wordle", "requestCount": 5},
        {"title": "Beta", "requestCount": 1},
    ]
    reqs.sort(key=_request_sort_key)
    assert [r["title"] for r in reqs] == ["Wordle", "Alpha", "Zebra", "Beta"]


def test_seed_catalog_loads_valid_unique_games() -> None:
    seed = _load_seed_catalog()
    assert len(seed) >= 70
    titles = {g["title"] for g in seed.values()}
    assert "Wordle" in titles
    assert "Krillion" in titles
    assert "Minute Cryptic" in titles


def test_blocks_suggesting_compiledle_itself() -> None:
    assert _is_compiledle_self_url("https://compiledle.vercel.app/") is True
    assert _is_compiledle_self_url("compiledle.vercel.app/some-path") is True
    assert _is_compiledle_self_url("https://www.compiledle.vercel.app") is True
    assert _is_compiledle_self_url("https://krillion.io") is False


def test_utc_notify_slots_and_query_window() -> None:
    # Asia/Singapore (UTC+8, no DST): 00:00 -> 16:00 UTC, 13:00 -> 05:00 UTC
    assert compute_utc_notify_slots({"00:00", "13:00"}, "Asia/Singapore", True, True) == [
        "05:00",
        "16:00",
    ]
    # America/New_York (DST): 00:00 covers both 04:00 UTC (EDT) and 05:00 UTC (EST)
    assert compute_utc_notify_slots({"00:00"}, "America/New_York", True, True) == [
        "04:00",
        "05:00",
    ]
    # Disabled or no devices -> empty list (0 cron reads!)
    assert compute_utc_notify_slots({"00:00"}, "Asia/Singapore", False, True) == []
    assert compute_utc_notify_slots({"00:00"}, "Asia/Singapore", True, False) == []

    # Midnight UTC wraps cleanly to previous day's 23:45 slot
    assert current_utc_query_slots(datetime(2026, 11, 26, 0, 2, tzinfo=timezone.utc)) == [
        "00:00",
        "23:45",
    ]
