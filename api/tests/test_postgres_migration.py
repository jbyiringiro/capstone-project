"""Real PostgreSQL upgrade checks, isolated from application/production databases.

Set VUGA_TEST_POSTGRES_URL to an explicit local PostgreSQL URL. Each test owns a new,
random schema and removes only that schema. Normal test runs skip these checks.
"""
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import (
    Column,
    DateTime,
    Integer,
    MetaData,
    String,
    Table,
    create_engine,
    event,
    inspect,
    text,
)
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models
from app.db import Base, normalise_database_url
from app.migrations import migrate_email_accounts


@pytest.fixture
def postgres():
    supplied = os.environ.get("VUGA_TEST_POSTGRES_URL")
    if not supplied:
        pytest.skip("VUGA_TEST_POSTGRES_URL is required for real PostgreSQL checks")
    url = make_url(normalise_database_url(supplied))
    if url.get_backend_name() != "postgresql" or url.host not in ("127.0.0.1", "localhost", "::1"):
        pytest.fail("PostgreSQL migration tests accept only an explicit loopback database")
    schema = f"vuga_migration_test_{uuid4().hex}"
    administration = create_engine(url)
    with administration.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    target = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    try:
        yield target
    finally:
        target.dispose()
        with administration.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        administration.dispose()


def legacy_schema(target):
    """The deployed pre-email users schema; other existing tables have not changed."""
    legacy = MetaData()
    Table(
        "users", legacy,
        Column("user_id", String(36), primary_key=True),
        Column("name", String(120), nullable=False),
        Column("phone", String(32), nullable=False, unique=True),
        Column("role", String(16), nullable=False),
        Column("password_hash", String(128), nullable=False),
        Column("token_version", Integer, nullable=False, server_default="0"),
        Column("created_at", DateTime, nullable=False, server_default=text("now()")),
    )
    for table in Base.metadata.sorted_tables:
        if table.name not in ("users", "firebase_identities", "deleted_profiles"):
            table.to_metadata(legacy)
    legacy.create_all(target)
    with target.begin() as conn:
        conn.execute(text("CREATE INDEX idx_legacy_user_name ON users (name)"))
    return legacy


def seed_legacy(target, legacy):
    now = datetime(2026, 11, 5, 12, tzinfo=UTC).replace(tzinfo=None)
    rows = {
        "users": {"user_id": "old", "name": "Existing Parent", "phone": "+250780000001",
                      "role": "caregiver", "password_hash": "existing-hash", "token_version": 4},
        "child_profiles": {"profile_id": "child", "code": "P-01", "age_band": "4-6",
                               "access_method": "touch", "created_by": "old"},
        "symbols": {"symbol_id": 1, "key": "WATER", "label_rw": "amazi"},
        "audio_clips": {"clip_id": "audio", "symbol_id": 1, "path": "/audio/water.mp3"},
        "profile_vocabulary": {"profile_id": "child", "symbol_id": 1, "is_favourite": True,
                                   "custom_clip_id": "audio"},
        "boards": {"board_id": "board", "profile_id": "child", "name": "Home",
                       "grid_rows": 4, "grid_cols": 5},
        "board_cells": {"board_id": "board", "position": 0, "symbol_id": 1},
        "messages": {"message_id": "message", "profile_id": "child", "started_at": now,
                         "spoken_at": now, "tap_count": 2, "board_mode": "static"},
        "tap_events": {"event_id": "event", "message_id": "message", "symbol_id": 1,
                           "action_index": 0, "action_type": "select", "was_suggested": False, "ts": now},
        "devices": {"device_id": "device", "profile_id": "child", "last_sync": now},
        "model_versions": {"model_id": "model", "name": "kn", "is_frozen": True},
        "account_backups": {"user_id": "old", "data": "{}", "size": 2, "saved_at": now, "revision": 3},
        "phone_codes": {"phone": "+250780000001", "purpose": "register", "expires_at": now,
                            "attempts": 0, "sent_at": now, "sends": 1, "window_start": now},
        "login_attempts": {"phone": "+250780000001", "failures": 2},
    }
    with target.begin() as conn:
        for table in legacy.sorted_tables:
            conn.execute(table.insert().values(**rows[table.name]))


def snapshot(target, metadata):
    with target.connect() as conn:
        return {table.name: conn.execute(table.select()).all() for table in metadata.sorted_tables}


def test_postgres_upgrade_preserves_existing_data_and_constraints(postgres):
    legacy = legacy_schema(postgres)
    seed_legacy(postgres, legacy)
    before = snapshot(postgres, legacy)
    migrate_email_accounts(postgres)
    migrate_email_accounts(postgres)
    assert snapshot(postgres, legacy) == before
    columns = {column["name"]: column for column in inspect(postgres).get_columns("users")}
    assert columns["phone"]["nullable"] and columns["password_hash"]["nullable"]
    assert {"email", "firebase_uid", "firebase_project_id"} <= columns.keys()
    assert {"firebase_identities", "deleted_profiles"} <= set(inspect(postgres).get_table_names())
    assert any(index["name"] == "idx_legacy_user_name"
               for index in inspect(postgres).get_indexes("users"))
    with Session(postgres) as db:
        db.add(models.User(user_id="new", name="Email Parent", email="parent@example.test",
                           firebase_uid="uid", firebase_project_id="project", role="caregiver"))
        db.add(models.FirebaseIdentity(project_id="project", uid="uid", user_id="new"))
        db.commit()
        assert db.get(models.User, "new").phone is None
        assert db.get(models.FirebaseIdentity, ("project", "uid")).deleted is False
    for values in (
        {"email": "parent@example.test", "firebase_uid": "different"},
        {"email": "different@example.test", "firebase_uid": "uid"},
        {"phone": "+250780000001", "email": "another@example.test", "firebase_uid": "other"},
    ):
        with pytest.raises(IntegrityError), postgres.begin() as conn:
            conn.execute(models.User.__table__.insert().values(
                name="Duplicate", role="caregiver", firebase_project_id="project", **values))
    with pytest.raises(IntegrityError), postgres.begin() as conn:
        conn.execute(text("DELETE FROM users WHERE user_id='old'"))
    assert snapshot(postgres, legacy)["child_profiles"] == before["child_profiles"]


def test_postgres_failed_upgrade_rolls_back_schema_and_data(postgres):
    legacy = legacy_schema(postgres)
    seed_legacy(postgres, legacy)
    with postgres.begin() as conn:
        # A partially upgraded database with conflicting email values must not partly migrate.
        conn.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR(254)"))
        conn.execute(text("UPDATE users SET email='same@example.test'"))
        conn.execute(text("INSERT INTO users (user_id,name,phone,role,password_hash,email) "
                          "VALUES ('second','Second','+250780000002','caregiver','hash',"
                          "'same@example.test')"))
    before = snapshot(postgres, legacy)
    with pytest.raises(IntegrityError):
        migrate_email_accounts(postgres)
    assert snapshot(postgres, legacy) == before
    columns = {column["name"]: column for column in inspect(postgres).get_columns("users")}
    assert not columns["phone"]["nullable"] and not columns["password_hash"]["nullable"]
    assert "firebase_uid" not in columns and "firebase_project_id" not in columns
    assert "firebase_identities" not in inspect(postgres).get_table_names()


def test_postgres_late_table_failure_rolls_back_user_changes(postgres):
    legacy = legacy_schema(postgres)
    seed_legacy(postgres, legacy)
    before = snapshot(postgres, legacy)

    def fail_creation(*_args, **_kwargs):
        raise RuntimeError("simulated new-table DDL failure")

    identity_table = models.FirebaseIdentity.__table__
    event.listen(identity_table, "before_create", fail_creation)
    try:
        with pytest.raises(RuntimeError, match="simulated new-table DDL failure"):
            migrate_email_accounts(postgres)
    finally:
        event.remove(identity_table, "before_create", fail_creation)
    columns = {column["name"]: column for column in inspect(postgres).get_columns("users")}
    assert "email" not in columns and "firebase_uid" not in columns
    assert not columns["phone"]["nullable"] and not columns["password_hash"]["nullable"]
    assert snapshot(postgres, legacy) == before
    assert "firebase_identities" not in inspect(postgres).get_table_names()
    assert "deleted_profiles" not in inspect(postgres).get_table_names()


@pytest.mark.parametrize("has_legacy", [False, True], ids=["empty", "existing"])
def test_postgres_concurrent_startup_finishes_without_ddl_races(postgres, has_legacy):
    if has_legacy:
        legacy = legacy_schema(postgres)
        seed_legacy(postgres, legacy)
        before = snapshot(postgres, legacy)
    ready = Barrier(6)

    def start():
        ready.wait(timeout=10)
        migrate_email_accounts(postgres)

    with ThreadPoolExecutor(max_workers=6) as workers:
        results = [workers.submit(start) for _ in range(6)]
        for result in results:
            result.result(timeout=30)
    assert set(Base.metadata.tables) <= set(inspect(postgres).get_table_names())
    if has_legacy:
        assert snapshot(postgres, legacy) == before
