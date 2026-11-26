from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from firebase_admin import firestore

from api.firebase_client import get_db

CATALOG_CATEGORIES = [
    "Word",
    "Trivia",
    "Geography",
    "Movies & TV",
    "Music",
    "Logic & Math",
    "Gaming",
    "Sports",
    "Other",
]

_TRACKING_PARAMS = {"ref", "source", "fbclid", "gclid"}
_CACHE_TTL_SECONDS = 30.0
_catalog_cache: dict[str, dict[str, Any]] | None = None
_catalog_cache_time: float = 0.0


def canonicalize_game_url(raw_url: str) -> tuple[str, str, str]:
    """
    Produces (normalized_https_url, canonical_key, url_id) so variations like
    `krillion.io`, `http://www.krillion.io/`, and `https://krillion.io/index.html`
    all resolve to the exact same game identifier.
    """
    cleaned = raw_url.strip()
    if not cleaned:
        raise ValueError("URL cannot be empty.")
    if "://" not in cleaned:
        cleaned = f"https://{cleaned}"

    parsed = urlparse(cleaned)
    scheme = parsed.scheme.lower()
    if scheme not in ("http", "https"):
        raise ValueError("Only http:// and https:// URLs are supported.")

    host = (parsed.hostname or "").lower().strip(".")
    if not host or "." not in host:
        raise ValueError("Please enter a valid website domain.")

    canonical_host = host[4:] if host.startswith("www.") else host
    port_suffix = f":{parsed.port}" if parsed.port and parsed.port not in (80, 443) else ""

    raw_path = parsed.path or "/"
    canonical_path = raw_path
    for suffix in ("/index.html", "/index.htm"):
        if canonical_path.lower().endswith(suffix):
            canonical_path = canonical_path[: -len(suffix)] or "/"
    canonical_path = canonical_path.rstrip("/") or ""

    filtered_query = [
        (k, v)
        for k, v in parse_qsl(parsed.query, keep_blank_values=False)
        if not k.lower().startswith("utm_") and k.lower() not in _TRACKING_PARAMS
    ]
    filtered_query.sort()
    query_str = urlencode(filtered_query)

    canonical_key = f"{canonical_host}{port_suffix}{canonical_path}"
    if query_str:
        canonical_key = f"{canonical_key}?{query_str}"

    url_id = hashlib.sha256(canonical_key.encode("utf-8")).hexdigest()[:20]

    display_netloc = f"{host}{port_suffix}"
    normalized_url = urlunparse((scheme, display_netloc, raw_path, "", query_str, ""))
    return normalized_url, canonical_key, url_id


def default_favicon_for_url(url: str) -> str:
    host = urlparse(url).hostname or "example.com"
    return f"https://www.google.com/s2/favicons?domain={host}&sz=128"


def normalize_category(category: str | None) -> str:
    if not category:
        return "Other"
    cleaned = category.strip()
    for allowed in CATALOG_CATEGORIES:
        if allowed.lower() == cleaned.lower():
            return allowed
    return "Other"


def _load_seed_catalog() -> dict[str, dict[str, Any]]:
    seed_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "catalog_seed.json")
    with open(seed_path, encoding="utf-8") as fh:
        raw_items = json.load(fh)

    now_iso = datetime.now(timezone.utc).isoformat()
    games: dict[str, dict[str, Any]] = {}
    for entry in raw_items:
        norm_url, canonical_key, game_id = canonicalize_game_url(entry["url"])
        games[game_id] = {
            "id": game_id,
            "title": entry["title"].strip(),
            "url": norm_url,
            "canonicalKey": canonical_key,
            "category": normalize_category(entry.get("category")),
            "iconUrl": entry.get("iconUrl") or default_favicon_for_url(norm_url),
            "createdAt": now_iso,
        }
    return games


def invalidate_catalog_cache() -> None:
    global _catalog_cache, _catalog_cache_time
    _catalog_cache = None
    _catalog_cache_time = 0.0


def get_catalog_games(force_refresh: bool = False) -> dict[str, dict[str, Any]]:
    global _catalog_cache, _catalog_cache_time

    if (
        not force_refresh
        and _catalog_cache is not None
        and (time.monotonic() - _catalog_cache_time) < _CACHE_TTL_SECONDS
    ):
        return _catalog_cache

    db = get_db()
    catalog_ref = db.collection("config").document("catalog")
    snap = catalog_ref.get()
    if snap.exists:
        data = snap.to_dict() or {}
        games = data.get("games") or {}
    else:
        games = _load_seed_catalog()
        catalog_ref.set(
            {
                "games": games,
                "updatedAt": datetime.now(timezone.utc).isoformat(),
            }
        )

    _catalog_cache = games
    _catalog_cache_time = time.monotonic()
    return games


def add_game_to_catalog(
    url: str,
    title: str,
    category: str | None = None,
    icon_url: str | None = None,
) -> dict[str, Any]:
    norm_url, canonical_key, game_id = canonicalize_game_url(url)
    games = get_catalog_games(force_refresh=True)
    if game_id in games:
        raise ValueError("This game is already in the catalog.")

    entry = {
        "id": game_id,
        "title": title.strip()[:80] or "Daily Game",
        "url": norm_url,
        "canonicalKey": canonical_key,
        "category": normalize_category(category),
        "iconUrl": (icon_url or "").strip() or default_favicon_for_url(norm_url),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }

    db = get_db()
    catalog_ref = db.collection("config").document("catalog")
    catalog_ref.update(
        {
            f"games.{game_id}": entry,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
    )
    invalidate_catalog_cache()
    return entry


def remove_game_from_catalog(game_id: str) -> bool:
    games = get_catalog_games(force_refresh=True)
    if game_id not in games:
        return False

    db = get_db()
    catalog_ref = db.collection("config").document("catalog")
    catalog_ref.update(
        {
            f"games.{game_id}": firestore.DELETE_FIELD,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
    )
    invalidate_catalog_cache()
    return True
