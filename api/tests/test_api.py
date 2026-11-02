import os
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

_test_directory = TemporaryDirectory(prefix="vuga-api-tests-")
os.environ["VUGA_DATABASE_URL"] = f"sqlite:///{Path(_test_directory.name) / 'test_vuga.db'}"

import pytest
from fastapi.testclient import TestClient

from app import models
from app.config import settings
from app.db import Base, SessionLocal, engine
from app.dependencies import get_sms
from app.main import app
from app.schemas import normalise_phone
from app.services import SmsFailed, accounts, codes


class Outbox:
    """Stands in for the SMS service: keeps every text, so a test reads the code a caregiver would."""

    def __init__(self):
        self.texts = []

    def send(self, phone, text):
        self.texts.append((phone, text))

    def code(self, phone):
        text = next(text for to, text in reversed(self.texts) if to == normalise_phone(phone))
        return re.search(r"\b\d{6}\b", text).group()


def _other(code):
    return "000000" if code != "000000" else "111111"


@pytest.fixture
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    outbox = Outbox()
    app.dependency_overrides[get_sms] = lambda: outbox
    with TestClient(app) as c:
        c.sms = outbox
        yield c
    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()


def _auth(client, phone="0780000001", role="teacher"):
    """Opens an account for the number if it has none, with the texted code, and signs in."""
    if client.post("/auth/code", json={"phone": phone, "purpose": "register"}).status_code == 202:
        client.post("/auth/register", json={"name": "T", "phone": phone, "code": client.sms.code(phone),
                                            "role": role, "pin": "2468"})
    r = client.post("/auth/login", data={"username": phone, "password": "2468"})
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


def test_public_registration_cannot_create_admin_and_takes_a_four_to_six_digit_pin(client):
    assert client.post("/auth/code", json={"phone": "0780000020", "purpose": "register"}).status_code == 202
    body = {"phone": "0780000020", "code": client.sms.code("0780000020"), "pin": "2468"}
    assert client.post("/auth/register", json={**body, "role": "administrator"}).status_code == 422
    for pin in ("123", "1234567", "12a4", "secret1", "é" * 37):
        assert client.post("/auth/register", json={**body, "pin": pin}).status_code == 422
    r = client.post("/auth/register", json=body)
    assert r.status_code == 201 and r.json()["name"] == ""
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


BACKUP = "vuga-account-backup-v2"


def _snapshot(base=0, place="meal", words=("I", "WANT", "WATER")):
    """A device's account copy: one child by code, its word list, its board place and the open child."""
    return {"format": BACKUP, "base_revision": base, "data": {
        "profiles": [{"profile_id": "local-1", "code": "P-01", "age_band": None, "access_method": "touch",
                      "local_only": True}],
        "vocabulary": [{"profile_id": "local-1", "key": key} for key in words],
        "settings": [{"key": "appearance:local-1", "value": {"environment": place}},
                     {"key": "vocabulary:local-1", "value": True},
                     {"key": "profile", "value": {"profile_id": "local-1", "code": "P-01"}}]}}


def test_backup_brings_a_caregivers_device_back_and_only_to_their_account(client):
    h = _auth(client)
    assert client.get("/backup/status", headers=h).json() == {"saved_at": None, "size": 0, "revision": 0}
    assert client.get("/backup", headers=h).status_code == 404
    r = client.put("/backup", json=_snapshot(), headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["size"] > 0 and r.json()["saved_at"] and r.json()["revision"] == 1
    back = client.get("/backup", headers=h).json()
    assert back["format"] == BACKUP and back["revision"] == 1
    assert back["data"] == _snapshot()["data"]
    # A later save on that copy replaces it; another account sees nothing.
    assert client.put("/backup", json=_snapshot(base=1, place="school"), headers=h).json()["revision"] == 2
    assert client.get("/backup", headers=h).json()["data"] == _snapshot(place="school")["data"]
    other = _auth(client, phone="0780000002")
    assert client.get("/backup", headers=other).status_code == 404
    assert client.get("/backup/status", headers=other).json()["saved_at"] is None


def test_a_device_with_an_older_copy_never_replaces_a_newer_one(client):
    h = _auth(client)
    save = lambda base, place: client.put("/backup", json=_snapshot(base, place), headers=h)
    # The tablet saves the first copy, which the phone receives (revision 1); the tablet then saves
    # a change (revision 2).
    assert save(0, "meal").json()["revision"] == 1
    assert save(1, "school").json()["revision"] == 2
    # The phone, still on revision 1, is refused and told which copy is newer; nothing changes.
    stale = save(1, "home")
    assert stale.status_code == 409
    assert stale.json()["revision"] == 2 and stale.json()["saved_at"]
    copy = client.get("/backup", headers=h).json()
    assert copy["revision"] == 2 and copy["data"]["settings"][0]["value"] == {"environment": "school"}
    assert save(0, "home").status_code == 409
    # Once the caregiver has chosen, the phone saves on revision 2.
    assert save(2, "home").json()["revision"] == 3
    # Of several devices saving on the same copy at the same moment, one is kept and the rest refused.
    with ThreadPoolExecutor(max_workers=8) as pool:
        replies = list(pool.map(lambda n: save(3, f"place-{n}").status_code, range(8)))
    assert sorted(replies) == [200] + [409] * 7
    assert client.get("/backup/status", headers=h).json()["revision"] == 4


def test_the_account_copy_refuses_childrens_names_photos_and_recordings(client):
    h = _auth(client)
    good = _snapshot()

    def changed(edit):
        snapshot = deepcopy(good)
        edit(snapshot["data"])
        return snapshot
    refused = [
        changed(lambda data: data["profiles"][0].update(code="Keza")),
        changed(lambda data: data["settings"][2].update(value={"profile_id": "local-1", "code": "Keza"})),
        changed(lambda data: data["profiles"][0].update(photo="AAAA")),
        changed(lambda data: data.update(custom_symbols=[{"symbol_id": "CUSTOM-1", "label_rw": "nyogokuru",
                                                          "image": {"type": "image/webp", "base64": "AAAA"}}])),
        changed(lambda data: data.update(recordings=[{"key": "WATER", "blob": {"type": "audio/webm", "base64": "AAAA"}}])),
        changed(lambda data: data["settings"].append({"key": "parent-access:v1", "value": {"digest": "x"}})),
        {**good, "format": "vuga-account-backup-v1"},
    ]
    for snapshot in refused:
        assert client.put("/backup", json=snapshot, headers=h).status_code == 422
    assert client.get("/backup/status", headers=h).json()["saved_at"] is None
    assert client.put("/backup", json=good, headers=h).status_code == 200


def test_backup_needs_an_account_a_known_format_and_stays_under_its_size_limit(client, monkeypatch):
    assert client.get("/backup").status_code == 401
    assert client.put("/backup", json=_snapshot()).status_code == 401
    h = _auth(client)
    assert client.put("/backup", json={"format": "other", "base_revision": 0, "data": {}}, headers=h).status_code == 422
    assert client.put("/backup", json={key: value for key, value in _snapshot().items() if key != "base_revision"},
                      headers=h).status_code == 422
    bad = client.put("/backup", content=b"not json", headers={**h, "Content-Type": "application/json"})
    assert bad.status_code == 422
    monkeypatch.setattr(settings, "max_backup_bytes", 200)
    assert client.put("/backup", json=_snapshot(words=[f"WORD_{n}" for n in range(20)]), headers=h).status_code == 413
    assert client.get("/backup/status", headers=h).json()["saved_at"] is None


def test_a_phone_number_is_a_rwandan_mobile_kept_in_one_form():
    for spelling in ("0788123456", "0788 123 456", "+250 788 123 456", "250788123456",
                     "00250-788-123-456", "788123456", "(078) 812-3456"):
        assert normalise_phone(spelling) == "+250788123456"
    for number in ("0722123456", "0732123456", "0792123456"):
        assert normalise_phone(number) == "+250" + number[1:]
    for wrong in ("", "0788", "07881234567", "0748123456", "+254712345678", "07881234ab"):
        with pytest.raises(ValueError):
            normalise_phone(wrong)


def test_an_account_opens_only_with_the_code_texted_to_its_number(client):
    body = {"name": "Mama Keza", "phone": "0788 123 456", "pin": "2468"}
    assert client.post("/auth/register", json={**body, "code": "123456"}).status_code == 400
    sent = client.post("/auth/code", json={"phone": "0788 123 456", "purpose": "register"})
    assert sent.status_code == 202 and sent.json() == {"resend_after": 60, "expires_in": 600}
    [(to, text)] = client.sms.texts
    assert to == "+250788123456" and text.startswith("Vuga:") and text.isascii() and len(text) <= 160
    code = client.sms.code(to)
    with SessionLocal() as db:
        kept = db.get(models.PhoneCode, (to, "register")).code_hash
    assert len(kept) == 64 and code not in kept
    assert client.post("/auth/register", json={**body, "code": _other(code)}).status_code == 400
    r = client.post("/auth/register", json={**body, "code": code})
    assert r.status_code == 201, r.text
    assert r.json()["phone"] == "+250788123456"
    for spelling in ("0788123456", "+250 788 123 456", "250788123456"):
        assert client.post("/auth/login", data={"username": spelling, "password": "2468"}).status_code == 200
    # One account for a number: no second code and no second account.
    assert client.post("/auth/code", json={"phone": "+250788123456", "purpose": "register"}).status_code == 409
    assert client.post("/auth/register", json={**body, "code": code}).status_code == 409
    assert len(client.sms.texts) == 1
    assert client.post("/auth/code", json={"phone": "0748 123 456", "purpose": "register"}).status_code == 422
    assert client.post("/auth/login", data={"username": "not a phone", "password": "2468"}).status_code == 401


def test_a_code_works_once_for_a_few_tries_and_a_number_gets_few_texts(client, monkeypatch):
    start = codes._now()
    clock = [start]
    monkeypatch.setattr(codes, "_now", lambda: clock[0])
    body = {"phone": "0788123456", "pin": "2468"}
    ask = lambda: client.post("/auth/code", json={"phone": "0788123456", "purpose": "register"})
    register = lambda code: client.post("/auth/register", json={**body, "code": code}).status_code
    assert ask().status_code == 202
    # Another code only after a minute; the wait is in the body and the Retry-After header.
    early = ask()
    assert early.status_code == 429 and early.json()["retry_after"] == 60 and early.headers["Retry-After"] == "60"
    # Five wrong tries spend the code.
    code = client.sms.code("0788123456")
    for _ in range(5):
        assert register(_other(code)) == 400
    assert register(code) == 400
    # A code works for ten minutes.
    clock[0] += timedelta(seconds=61)
    assert ask().status_code == 202
    clock[0] += timedelta(minutes=10)
    assert register(client.sms.code("0788123456")) == 400
    # Five texts an hour at most to one number.
    for _ in range(3):
        clock[0] += timedelta(seconds=61)
        assert ask().status_code == 202
    clock[0] += timedelta(seconds=61)
    capped = ask()
    assert capped.status_code == 429 and capped.json()["retry_after"] > 60 * 40
    assert len(client.sms.texts) == 5
    clock[0] = start + timedelta(hours=1, seconds=1)
    assert ask().status_code == 202
    assert register(client.sms.code("0788123456")) == 201


def test_a_forgotten_pin_is_replaced_with_a_texted_code_which_also_lifts_a_lock(client):
    _auth(client, "0788123456")
    texts = len(client.sms.texts)
    # A number without an account is told so, and gets no text.
    assert client.post("/auth/code", json={"phone": "0722000000", "purpose": "reset"}).status_code == 404
    assert len(client.sms.texts) == texts
    assert client.post("/auth/reset-pin", json={"phone": "0722000000", "code": "123456", "pin": "1357"}).status_code == 404
    assert client.post("/auth/code", json={"phone": "+250 788 123 456", "purpose": "reset"}).status_code == 202
    to, text = client.sms.texts[-1]
    assert to == "+250788123456" and "ijambobanga" in text
    code = client.sms.code(to)
    # Five wrong PINs had locked the number; the texted code lifts the lock.
    for _ in range(5):
        client.post("/auth/login", data={"username": "0788123456", "password": "0000"})
    assert client.post("/auth/login", data={"username": "0788123456", "password": "2468"}).status_code == 429
    reset = lambda code, pin: client.post("/auth/reset-pin", json={"phone": "0788123456", "code": code, "pin": pin}).status_code
    assert reset(_other(code), "1357") == 400
    assert reset(code, "short") == 422
    assert reset(code, "1357") == 204
    assert reset(code, "9753") == 400
    assert client.post("/auth/login", data={"username": "0788123456", "password": "2468"}).status_code == 401
    assert client.post("/auth/login", data={"username": "0788123456", "password": "1357"}).status_code == 200


def test_a_text_the_sms_service_refuses_is_reported_and_leaves_no_wait(client):
    class Down:
        def send(self, phone, text):
            raise SmsFailed("could not send the code")

    app.dependency_overrides[get_sms] = Down
    assert client.post("/auth/code", json={"phone": "0788123456", "purpose": "register"}).status_code == 502
    app.dependency_overrides[get_sms] = lambda: client.sms
    assert client.post("/auth/code", json={"phone": "0788123456", "purpose": "register"}).status_code == 202


def test_five_wrong_pins_lock_the_number_for_fifteen_minutes(client, monkeypatch):
    _auth(client, "0788123456")
    start = codes._now()
    clock = [start]
    monkeypatch.setattr(codes, "_now", lambda: clock[0])
    login = lambda pin: client.post("/auth/login", data={"username": "0788123456", "password": pin})
    for _ in range(4):
        assert login("0000").status_code == 401
    # The fifth wrong PIN locks the number, and the lock holds even for the right PIN.
    locked = login("0000")
    assert locked.status_code == 429 and locked.json()["retry_after"] == 15 * 60
    assert login("2468").status_code == 429
    # A right PIN clears the count, so wrong ones are counted afresh after the lock.
    clock[0] = start + timedelta(minutes=15, seconds=1)
    assert login("2468").status_code == 200
    for _ in range(4):
        assert login("0000").status_code == 401
    assert login("2468").status_code == 200
    assert login("0000").status_code == 401
    # Another number is not affected.
    _auth(client, "0722000000")


def test_a_pin_is_changed_with_the_current_one(client):
    _auth(client, "0788123456")
    change = lambda pin, new_pin: client.post("/auth/change-pin", json={"phone": "0788 123 456", "pin": pin, "new_pin": new_pin}).status_code
    assert change("0000", "1357") == 401
    assert change("2468", "13") == 422
    assert change("2468", "1357") == 204
    assert client.post("/auth/login", data={"username": "0788123456", "password": "2468"}).status_code == 401
    assert client.post("/auth/login", data={"username": "0788123456", "password": "1357"}).status_code == 200


def test_wrong_pins_sent_at_the_same_moment_are_all_counted(client, monkeypatch):
    _auth(client, "0788123456")
    checked, real_check = [], accounts.verify_password

    def slow_check(pin, digest):
        # A slow hash widens the moment in which tries sent together could all be checked.
        checked.append(pin)
        time.sleep(0.05)
        return real_check(pin, digest)

    monkeypatch.setattr(accounts, "verify_password", slow_check)
    login = lambda pin: client.post("/auth/login", data={"username": "0788123456", "password": pin}).status_code
    with ThreadPoolExecutor(max_workers=20) as pool:
        replies = list(pool.map(login, ["0000"] * 20))
    # However many arrive together, five PINs are checked and the number is then locked.
    assert len(checked) == accounts.MAX_TRIES
    assert sorted(replies) == [401] * (accounts.MAX_TRIES - 1) + [429] * (21 - accounts.MAX_TRIES)
    assert login("2468") == 429 and len(checked) == accounts.MAX_TRIES


def test_a_new_pin_ends_every_session_opened_with_the_old_one(client):
    def session(pin):
        r = client.post("/auth/login", data={"username": "0788123456", "password": pin})
        assert r.status_code == 200, r.text
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    _auth(client, "0788123456")
    first, second = session("2468"), session("2468")
    change = lambda pin, new_pin: client.post("/auth/change-pin", json={"phone": "0788123456", "pin": pin, "new_pin": new_pin}).status_code
    # A refused change leaves the sessions as they were.
    assert change("0000", "1357") == 401
    assert client.get("/profiles", headers=first).status_code == 200
    assert change("2468", "1357") == 204
    for old in (first, second):
        assert client.get("/profiles", headers=old).status_code == 401
        assert client.get("/backup/status", headers=old).status_code == 401
    changed = session("1357")
    assert client.get("/profiles", headers=changed).status_code == 200
    # A PIN replaced with a texted code ends the sessions too, including one opened after the change.
    assert client.post("/auth/code", json={"phone": "0788123456", "purpose": "reset"}).status_code == 202
    reset = {"phone": "0788123456", "code": client.sms.code("0788123456"), "pin": "9753"}
    assert client.post("/auth/reset-pin", json=reset).status_code == 204
    for old in (first, changed):
        assert client.get("/profiles", headers=old).status_code == 401
    assert client.get("/profiles", headers=session("9753")).status_code == 200
