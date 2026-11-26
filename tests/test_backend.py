from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from api.auth import AuthenticatedUser
from api.index import _daily_sort_key, _require_recent_auth, app
from api.inspector import normalize_and_validate_url
from api.notifier import (
    format_general_notification_body,
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
