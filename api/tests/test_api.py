import os
import uuid
from datetime import datetime, timezone

os.environ["VUGA_DATABASE_URL"] = "sqlite:///./test_vuga.db"

import pytest
from fastapi.testclient import TestClient

from app.db import Base, engine
from app.main import app


@pytest.fixture(scope="module")
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(engine)


def _auth(client, phone="0780000001", role="teacher"):
    client.post("/auth/register", json={"name": "T", "phone": phone, "role": role, "password": "secret1"})
    r = client.post("/auth/login", data={"username": phone, "password": "secret1"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_health(client):
    assert client.get("/health").json()["status"] == "ok"


def test_register_login_profile_vocabulary_sync_summary(client):
    admin = _auth(client, "0780000009", "administrator")
    assert client.post("/symbols/import", headers=admin).status_code == 201
    syms = client.get("/symbols").json()
    assert {s["key"] for s in syms} >= {"I", "WANT", "WATER"}
    by_key = {s["key"]: s["symbol_id"] for s in syms}

    h = _auth(client)
    r = client.post("/profiles", json={"code": "P-01", "age_band": "6-8"}, headers=h)
    assert r.status_code == 201, r.text
    pid = r.json()["profile_id"]
    assert client.post("/profiles", json={"code": "bad code"}, headers=h).status_code == 422

    r = client.put(f"/profiles/{pid}/vocabulary", json={"symbol_ids": [by_key["I"], by_key["WANT"], by_key["WATER"]]}, headers=h)
    assert r.json()["enabled"] == 3
    assert len(client.get(f"/profiles/{pid}/vocabulary", headers=h).json()) == 3

    t0 = datetime(2026, 10, 20, 9, 0, tzinfo=timezone.utc)
    mid = str(uuid.uuid4())
    events = [
        {"event_id": str(uuid.uuid4()), "action_index": 0, "action_type": "select", "symbol_key": "I", "ts": t0.isoformat()},
        {"event_id": str(uuid.uuid4()), "action_index": 1, "action_type": "navigate", "context": "cat:actions", "ts": t0.isoformat()},
        {"event_id": str(uuid.uuid4()), "action_index": 2, "action_type": "select", "symbol_key": "WANT", "ts": t0.isoformat()},
        {"event_id": str(uuid.uuid4()), "action_index": 3, "action_type": "select", "symbol_key": "WATER", "was_suggested": True, "ts": t0.isoformat()},
        {"event_id": str(uuid.uuid4()), "action_index": 4, "action_type": "speak", "ts": t0.isoformat()},
    ]
    msg = {"message_id": mid, "profile_id": pid, "started_at": t0.isoformat(), "spoken_at": t0.isoformat(),
           "tap_count": 5, "duration_ms": 8200, "board_mode": "predictive", "events": events}
    r = client.post("/sync", json={"messages": [msg]}, headers=h)
    assert r.json() == {"accepted_messages": 1, "accepted_events": 5, "duplicates": 0}
    # re-upload is idempotent
    assert client.post("/sync", json={"messages": [msg]}, headers=h).json()["duplicates"] == 1

    s = client.get(f"/profiles/{pid}/summary", headers=h).json()
    assert s["symbol_frequency"] == {"I": 1, "WANT": 1, "WATER": 1}
    assert s["by_board_mode"]["predictive"]["taps_per_message"] == 5  # all actions incl. Speak

    # another teacher cannot see or upload to this profile
    other = _auth(client, "0780000002")
    assert client.get(f"/profiles/{pid}/summary", headers=other).status_code == 404
    assert client.post("/sync", json={"messages": [msg]}, headers=other).status_code == 403


def test_select_event_requires_symbol(client):
    h = _auth(client, "0780000003")
    pid = client.post("/profiles", json={"code": "P-02"}, headers=h).json()["profile_id"]
    t0 = datetime.now(timezone.utc).isoformat()
    msg = {"message_id": str(uuid.uuid4()), "profile_id": pid, "started_at": t0, "spoken_at": t0,
           "tap_count": 1, "duration_ms": 10, "board_mode": "static",
           "events": [{"event_id": str(uuid.uuid4()), "action_index": 0, "action_type": "select", "ts": t0}]}
    assert client.post("/sync", json={"messages": [msg]}, headers=h).status_code == 422
