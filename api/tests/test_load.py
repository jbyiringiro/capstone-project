"""Stress test from docs/testing_plan.md: 20 tablets each syncing 200 completed messages.

Uploads go through the real HTTP stack (TestClient -> routers -> SyncService -> SQLite file) in
the 50-message sessions a tablet would send, one request at a time. Timings are written to
docs/evidence/api_load.json for the report.
"""
import json
import os
import platform
import statistics
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

_test_directory = TemporaryDirectory(prefix="vuga-load-tests-")
os.environ.setdefault("VUGA_DATABASE_URL",
                      f"sqlite:///{Path(_test_directory.name) / 'load_vuga.db'}")

import fastapi
import pytest
import sqlalchemy
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import models
from app.db import Base, SessionLocal, engine
from app.main import app
from app.security import create_token, hash_password

TABLETS, MESSAGES_PER_TABLET, BATCH = 20, 200, 50
ACTIONS = [("select", "I"), ("navigate", None), ("select", "WANT"), ("select", "WATER"),
           ("speak", None)]
EVIDENCE = Path(__file__).resolve().parents[2] / "docs" / "evidence" / "api_load.json"


@pytest.fixture
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(engine)
    engine.dispose()


def _tablets(client):
    """One adult account and one child profile per tablet (one shared hash keeps setup fast)."""
    password_hash = hash_password("secret1")
    with SessionLocal() as db:
        users = [models.User(name=f"T{i}", phone=f"07810{i:05d}", role="teacher",
                             password_hash=password_hash) for i in range(TABLETS)]
        db.add_all(users)
        db.commit()
        tokens = [create_token(user) for user in users]
    tablets = []
    for i, token in enumerate(tokens):
        headers = {"Authorization": f"Bearer {token}"}
        response = client.post("/profiles", json={"code": f"L-{i:02d}"}, headers=headers)
        assert response.status_code == 201, response.text
        tablets.append((headers, response.json()["profile_id"]))
    return tablets


def _message(profile_id, n):
    t0 = datetime(2026, 10, 1, 8, tzinfo=UTC) + timedelta(minutes=n)
    mode = "predictive" if n % 2 else "static"
    events = [{"event_id": str(uuid.uuid4()), "action_index": i, "action_type": action,
               "symbol_key": symbol, "was_suggested": mode == "predictive" and symbol == "WATER",
               "ts": (t0 + timedelta(seconds=i)).isoformat()}
              for i, (action, symbol) in enumerate(ACTIONS)]
    return {"message_id": str(uuid.uuid4()), "profile_id": profile_id,
            "started_at": t0.isoformat(),
            "spoken_at": (t0 + timedelta(seconds=len(ACTIONS) + 1)).isoformat(),
            "tap_count": len(events), "duration_ms": None, "board_mode": mode, "events": events}


def _os_name():
    # Python 3.11 reports Windows 11 as release "10"; the build number tells them apart.
    if platform.system() == "Windows":
        build = int(platform.version().split(".")[-1])
        return f"Windows {'11' if build >= 22000 else platform.release()} (build {build})"
    return platform.platform()


def _percentile(values, q):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round(q * (len(ordered) - 1)))]


def _post(client, headers, batch, timings):
    start = time.perf_counter()
    response = client.post("/sync", json={"messages": batch}, headers=headers)
    timings.append((time.perf_counter() - start) * 1000)
    assert response.status_code == 200, response.text
    return response.json()


def test_twenty_tablets_sync_two_hundred_messages_each(client):
    tablets = _tablets(client)
    backlog = [[_message(pid, n) for n in range(MESSAGES_PER_TABLET)] for _, pid in tablets]

    upload_ms, accepted = [], 0
    started = time.perf_counter()
    # Round-robin so every tablet's sessions arrive interleaved with the others'.
    for offset in range(0, MESSAGES_PER_TABLET, BATCH):
        for (headers, _), messages in zip(tablets, backlog):
            result = _post(client, headers, messages[offset:offset + BATCH], upload_ms)
            assert result["duplicates"] == 0
            accepted += result["accepted_messages"]
    wall_s = time.perf_counter() - started

    resend_ms = []
    for (headers, _), messages in zip(tablets, backlog):
        result = _post(client, headers, messages[-BATCH:], resend_ms)
        assert result == {"accepted_messages": 0, "accepted_events": 0, "duplicates": BATCH}

    total = TABLETS * MESSAGES_PER_TABLET
    assert accepted == total
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(models.Message)) == total
        assert db.scalar(select(func.count()).select_from(models.TapEvent)) == total * len(ACTIONS)
    headers, pid = tablets[0]
    summary = client.get(f"/profiles/{pid}/summary", headers=headers).json()
    assert sum(m["messages"] for m in summary["by_board_mode"].values()) == MESSAGES_PER_TABLET
    assert summary["symbol_frequency"] == {key: MESSAGES_PER_TABLET
                                           for key in ("I", "WANT", "WATER")}

    evidence = {
        "date": datetime.now(UTC).astimezone().date().isoformat(),
        "test": "api/tests/test_load.py",
        "scenario": f"{TABLETS} tablets x {MESSAGES_PER_TABLET} completed messages x "
                    f"{len(ACTIONS)} actions, uploaded in {BATCH}-message sync sessions, "
                    "sequential requests through FastAPI TestClient",
        "database": "SQLite file in a temporary directory",
        "requests": len(upload_ms),
        "messages": total,
        "events": total * len(ACTIONS),
        "wall_seconds": round(wall_s, 2),
        "messages_per_second": round(total / wall_s, 1),
        "events_per_second": round(total * len(ACTIONS) / wall_s, 1),
        "upload_latency_ms": {"p50": round(statistics.median(upload_ms), 1),
                              "p95": round(_percentile(upload_ms, 0.95), 1),
                              "max": round(max(upload_ms), 1)},
        "idempotent_resend_latency_ms": {"requests": len(resend_ms),
                                         "p50": round(statistics.median(resend_ms), 1),
                                         "p95": round(_percentile(resend_ms, 0.95), 1)},
        "environment": {"python": platform.python_version(), "os": _os_name(),
                        "fastapi": fastapi.__version__, "sqlalchemy": sqlalchemy.__version__},
    }
    EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
