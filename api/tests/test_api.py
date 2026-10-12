import os
import uuid
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

_test_directory = TemporaryDirectory(prefix="vuga-api-tests-")
os.environ["VUGA_DATABASE_URL"] = f"sqlite:///{Path(_test_directory.name) / 'test_vuga.db'}"

import pytest
from fastapi.testclient import TestClient

from app import models
from app.db import Base, SessionLocal, engine
from app.main import app


@pytest.fixture
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(engine)
    engine.dispose()


def _auth(client, phone="0780000001", role="teacher"):
    client.post("/auth/register", json={"name": "T", "phone": phone, "role": role, "password": "secret1"})
    r = client.post("/auth/login", data={"username": phone, "password": "secret1"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_health(client):
    assert client.get("/health").json()["status"] == "ok"


def test_register_login_profile_vocabulary_sync_summary(client):
    # The shipped catalogue is seeded on startup without a privileged public account.
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
        {"event_id": str(uuid.uuid4()), "action_index": 4, "action_type": "speak", "ts": (t0 + timedelta(milliseconds=8200)).isoformat()},
    ]
    msg = {"message_id": mid, "profile_id": pid, "started_at": t0.isoformat(), "spoken_at": (t0 + timedelta(milliseconds=8200)).isoformat(),
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


def _profile(client, phone="0780000010", code="P-07"):
    headers = _auth(client, phone)
    response = client.post("/profiles", json={"code": code}, headers=headers)
    assert response.status_code == 201, response.text
    return headers, response.json()["profile_id"]


def _message(profile_id):
    t0 = datetime(2026, 9, 1, tzinfo=timezone.utc)
    actions = [("select", "I"), ("navigate", None), ("select", "WATER"),
               ("correct", None), ("select", "WANT"), ("speak", None)]
    events = [
        {"event_id": str(uuid.uuid4()), "action_index": index, "action_type": action,
         "symbol_key": symbol, "ts": (t0 + timedelta(seconds=index)).isoformat()}
        for index, (action, symbol) in enumerate(actions)
    ]
    return {"message_id": str(uuid.uuid4()), "profile_id": profile_id,
            "started_at": t0.isoformat(), "spoken_at": (t0 + timedelta(seconds=8)).isoformat(),
            "tap_count": len(events), "duration_ms": 8000,
            "board_mode": "static", "events": events}


def test_public_registration_cannot_create_admin_and_password_limits(client):
    body = {"name": "Teacher", "phone": "0780000020", "password": "secret1"}
    assert client.post("/auth/register", json={**body, "role": "administrator"}).status_code == 422
    assert client.post("/auth/register", json={**body, "password": "é" * 37}).status_code == 422
    assert client.post("/auth/register", json=body).status_code == 201
    assert client.post("/auth/login", data={"username": body["phone"], "password": "x" * 73}).status_code == 401
    headers = _auth(client, body["phone"])
    assert client.post("/symbols/import", headers=headers).status_code == 403


def test_vocabulary_replacement_is_validated_before_mutation(client):
    headers, pid = _profile(client)
    symbols = client.get("/symbols").json()
    original = [s["symbol_id"] for s in symbols[:3]]
    endpoint = f"/profiles/{pid}/vocabulary"
    for _ in range(2):
        assert client.put(endpoint, json={"symbol_ids": original}, headers=headers).status_code == 200
    for invalid in ([original[0], original[0]], [original[0], 999999]):
        response = client.put(endpoint, json={"symbol_ids": invalid}, headers=headers)
        assert response.status_code == 422
        assert {s["symbol_id"] for s in client.get(endpoint, headers=headers).json()} == set(original)
    assert client.put(endpoint, json={"symbol_ids": []}, headers=headers).json()["enabled"] == 0
    assert client.get(endpoint, headers=headers).json() == []


def test_predict_empty_mask_and_invalid_k(client, monkeypatch):
    from app import main

    class Model:
        name = "test"

        def top_k(self, prefix, k, allowed):
            return ["I"] if allowed is None or "I" in allowed else []

    monkeypatch.setattr(main, "load_model", lambda: Model())
    assert client.post("/predict", json={"prefix": [], "allowed": []}).json()["suggestions"] == []
    assert client.post("/predict", json={"prefix": []}).json()["suggestions"] == ["I"]
    assert client.post("/predict", json={"prefix": [], "k": -1}).status_code == 422


@pytest.mark.parametrize("corruption", ["tap_count", "index", "event_id", "symbol", "speak", "time"])
def test_sync_rejects_invalid_action_logs_atomically(client, corruption):
    headers, pid = _profile(client)
    good, bad = _message(pid), _message(pid)
    if corruption == "tap_count":
        bad["tap_count"] = 99
    elif corruption == "index":
        bad["events"][1]["action_index"] = 0
    elif corruption == "event_id":
        bad["events"][1]["event_id"] = bad["events"][0]["event_id"]
    elif corruption == "symbol":
        bad["events"][0]["symbol_key"] = "UNKNOWN_SYMBOL"
    elif corruption == "speak":
        bad["events"][-1]["action_type"] = "navigate"
    elif corruption == "time":
        bad["events"][0]["ts"] = "2026-01-01T00:00:00Z"
    response = client.post("/sync", json={"messages": [good, bad]}, headers=headers)
    assert response.status_code == 422, response.text
    assert client.get(f"/profiles/{pid}/summary", headers=headers).json()["by_board_mode"] == {}
    # The valid member was not partially committed before the rejection.
    assert client.post("/sync", json={"messages": [good]}, headers=headers).json()["accepted_messages"] == 1


def test_sync_retries_collisions_and_composition_time(client):
    headers, pid = _profile(client)
    message = _message(pid)
    response = client.post("/sync", json={"messages": [message]}, headers=headers)
    assert response.json() == {"accepted_messages": 1, "accepted_events": 6, "duplicates": 0}
    assert client.post("/sync", json={"messages": [message]}, headers=headers).json()["duplicates"] == 1
    summary = client.get(f"/profiles/{pid}/summary", headers=headers).json()
    assert summary["by_board_mode"]["static"]["taps_per_message"] == 6
    assert summary["by_board_mode"]["static"]["seconds_per_message"] == 5
    changed = deepcopy(message)
    changed["board_mode"] = "predictive"
    assert client.post("/sync", json={"messages": [changed]}, headers=headers).status_code == 409
    reused_event = _message(pid)
    reused_event["events"][0]["event_id"] = message["events"][0]["event_id"]
    assert client.post("/sync", json={"messages": [reused_event]}, headers=headers).status_code == 409
    other_headers, other_pid = _profile(client, "0780000030", "P-08")
    stolen = deepcopy(message)
    stolen["profile_id"] = other_pid
    assert client.post("/sync", json={"messages": [stolen]}, headers=other_headers).status_code == 409


def test_sync_rejects_cross_profile_upload_and_foreign_device(client):
    headers, pid = _profile(client)
    other_headers, other_pid = _profile(client, "0780000030", "P-08")
    own, foreign = _message(pid), _message(other_pid)
    assert client.post("/sync", json={"messages": [own, foreign]}, headers=headers).status_code == 403
    assert client.get(f"/profiles/{pid}/summary", headers=headers).json()["by_board_mode"] == {}
    with SessionLocal() as db:
        db.add(models.Device(device_id="owned-device", profile_id=pid))
        db.commit()
    assert client.post("/sync", json={"messages": [], "device_id": "owned-device"}, headers=other_headers).status_code == 404
    with SessionLocal() as db:
        assert db.get(models.Device, "owned-device").last_sync is None
    assert client.post("/sync", json={"messages": [own], "device_id": "owned-device"}, headers=headers).status_code == 200
