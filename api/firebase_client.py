from __future__ import annotations

import base64
import json
import os
from typing import Any

import firebase_admin
from firebase_admin import credentials, firestore


def _load_env_file_if_present() -> None:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for filename in (".env.local", ".env"):
        path = os.path.join(root, filename)
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8") as fh:
            for raw_line in fh:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                    value = value[1:-1]
                os.environ.setdefault(key, value)


def ensure_firebase_initialized() -> firebase_admin.App:
    if firebase_admin._apps:
        return firebase_admin.get_app()

    _load_env_file_if_present()
    raw_sa = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()

    if raw_sa:
        parsed: dict[str, Any]
        if raw_sa.startswith("{"):
            parsed = json.loads(raw_sa)
        else:
            decoded = base64.b64decode(raw_sa).decode("utf-8")
            parsed = json.loads(decoded)

        if "private_key" in parsed and isinstance(parsed["private_key"], str):
            parsed["private_key"] = parsed["private_key"].replace("\\n", "\n")

        cred = credentials.Certificate(parsed)
        return firebase_admin.initialize_app(cred)

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    local_keys = [
        os.path.join(root, f)
        for f in os.listdir(root)
        if f.endswith(".json") and ("firebase-adminsdk" in f or "service-account" in f)
    ]
    if local_keys:
        cred = credentials.Certificate(local_keys[0])
        return firebase_admin.initialize_app(cred)

    return firebase_admin.initialize_app()


def get_db() -> firestore.Client:
    app = ensure_firebase_initialized()
    database_id = os.environ.get("FIREBASE_DATABASE_ID", "(default)").strip() or "(default)"
    if database_id == "(default)":
        return firestore.client(app=app)
    return firestore.client(app=app, database_id=database_id)
