"""Deletion propagation uses the same visible revision as backup writes.

Each test owns a temporary database. No runtime accounts, provider or SMS are used.
"""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import Annotated
from uuid import uuid4

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from app import models, schemas
from app.db import Base, get_db
from app.main import app
from app.security import current_user, hash_password, verify_password
from app.services import codes
from app.services.accounts import AccountService
from app.services.backups import BackupService
from app.services.errors import InvalidCredentials, NotFound, StaleBackup
from app.services.profiles import ProfileService


@pytest.fixture
def store(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'deletion-tests.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, autoflush=False)
    user_id, child_id = str(uuid4()), str(uuid4())
    with sessions() as db:
        db.add(models.User(user_id=user_id, name="Test caregiver", phone="+250780000001", role="teacher", password_hash="not-used"))
        db.add(models.ChildProfile(profile_id=child_id, code="P-01", created_by=user_id))
        db.commit()
    yield sessions, user_id, child_id
    engine.dispose()


def snapshot(child_id, base=0, deleted=None):
    data = {
        "profiles": [{"profile_id": child_id, "code": "P-01", "local_only": False}],
        "vocabulary": [{"profile_id": child_id, "key": "WATER"}],
        "settings": [{"key": "mode", "value": "predictive"},
                     {"key": "profile", "value": {"profile_id": child_id, "code": "P-01"}}],
    }
    if deleted is not None:
        data["deleted"] = deleted
    return schemas.BackupIn(format="vuga-account-backup-v2", base_revision=base, data=data)


def service(db, user_id):
    return BackupService(db, db.get(models.User, user_id))


def test_delete_is_visible_through_status_without_a_later_backup_put(store):
    sessions, user_id, child_id = store
    with sessions() as db:
        assert service(db, user_id).save(snapshot(child_id)).revision == 1

    def database():
        with sessions() as db:
            yield db

    def caregiver(db: Annotated[Session, Depends(get_db)]):
        return db.get(models.User, user_id)

    before = dict(app.dependency_overrides)
    app.dependency_overrides.update({get_db: database, current_user: caregiver})
    # No lifespan: tests use their own database, not the application's configured database.
    client = TestClient(app)
    try:
        assert client.get("/backup/status").json()["revision"] == 1
        assert client.delete(f"/profiles/{child_id}").status_code == 204
        status = client.get("/backup/status").json()
        assert status["revision"] == 2
        assert status["saved_at"]
        saved = client.get("/backup").json()
        assert saved["revision"] == 2
        assert saved["data"]["deleted"] == [child_id]
        assert saved["data"]["profiles"] == []
    finally:
        client.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(before)


def test_stale_deletion_advances_revision_without_replacing_newer_settings(store):
    sessions, user_id, child_id = store
    with sessions() as db:
        backups = service(db, user_id)
        backups.save(snapshot(child_id))
        newer = snapshot(child_id, 1)
        newer.data.settings[0].value = "static"
        assert backups.save(newer).revision == 2
        with pytest.raises(StaleBackup) as refused:
            backups.save(snapshot(child_id, 1, [child_id]))
        assert refused.value.revision == 3
        assert backups.status().revision == 3
        saved = backups.load()
        assert saved.data.profiles == []
        assert saved.data.vocabulary == []
        assert saved.data.deleted == [child_id]
        assert [s.model_dump() for s in saved.data.settings] == [{"key": "mode", "value": "static"}]
        # A retry cannot generate endless revisions just by resending the same tombstone.
        with pytest.raises(StaleBackup):
            backups.save(snapshot(child_id, 1, [child_id]))
        assert backups.status().revision == 3


def test_deletion_before_first_copy_is_visible_and_rejects_an_unaware_first_save(store):
    sessions, user_id, child_id = store
    with sessions() as db:
        ProfileService(db).delete(db.get(models.ChildProfile, child_id))
        backups = service(db, user_id)
        assert backups.status().revision == 1
        assert backups.status().saved_at is not None
        assert backups.load().data.deleted == [child_id]
        with pytest.raises(StaleBackup):
            backups.save(snapshot(child_id, 0))
        assert backups.save(snapshot(child_id, 1)).revision == 2
        assert backups.load().data.profiles == []


def test_failed_child_erasure_rolls_back_tombstone_and_visible_revision(store, monkeypatch):
    from app.services import profiles

    sessions, user_id, child_id = store
    with sessions() as db:
        service(db, user_id).save(snapshot(child_id))

    def fail(*_args):
        raise RuntimeError("simulated storage failure")

    monkeypatch.setattr(profiles, "erase_profiles", fail)
    with sessions() as db:
        with pytest.raises(RuntimeError, match="simulated"):
            ProfileService(db).delete(db.get(models.ChildProfile, child_id))
        db.rollback()
    with sessions() as db:
        assert db.get(models.ChildProfile, child_id) is not None
        assert db.scalars(select(models.DeletedProfile)).all() == []
        assert service(db, user_id).status().revision == 1


def test_overlapping_stale_deletions_from_separate_workers_are_all_remembered(store):
    sessions, user_id, child_id = store
    extra_ids = ["local-" + str(uuid4()) for _ in range(4)]
    with sessions() as db:
        service(db, user_id).save(snapshot(child_id))
    ready = Barrier(4)

    def send(extra_id):
        with sessions() as db:
            backups = service(db, user_id)
            ready.wait(timeout=10)
            with pytest.raises(StaleBackup):
                backups.save(snapshot(child_id, 0, [child_id, extra_id]))

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(send, extra_ids))
    with sessions() as db:
        backups = service(db, user_id)
        assert set(backups.load().data.deleted) == {child_id, *extra_ids}
        assert backups.status().revision == 5


def test_first_save_racing_delete_never_hides_or_reintroduces_deletion(store):
    sessions, user_id, child_id = store
    ready = Barrier(2)

    def write():
        with sessions() as db:
            backups = service(db, user_id)
            ready.wait(timeout=10)
            try:
                return backups.save(snapshot(child_id)).revision
            except StaleBackup:
                return None

    def erase():
        with sessions() as db:
            profile = db.get(models.ChildProfile, child_id)
            ready.wait(timeout=10)
            ProfileService(db).delete(profile)

    with ThreadPoolExecutor(max_workers=2) as pool:
        write_result, erase_result = pool.submit(write), pool.submit(erase)
        revision = write_result.result(timeout=15)
        erase_result.result(timeout=15)
    with sessions() as db:
        backups = service(db, user_id)
        assert backups.load().data.profiles == []
        assert backups.load().data.deleted == [child_id]
        assert backups.status().revision == (2 if revision == 1 else 1)


def test_accepted_save_reports_its_own_revision_when_a_following_save_commits(store):
    sessions, user_id, child_id = store
    with sessions() as db:
        service(db, user_id).save(snapshot(child_id))
    fired = []

    def next_save(_session):
        if fired:
            return
        fired.append(True)
        with sessions() as other:
            service(other, user_id).save(snapshot(child_id, 2))

    event.listen(sessions, "after_commit", next_save)
    try:
        with sessions() as db:
            accepted = service(db, user_id).save(snapshot(child_id, 1))
        assert accepted.revision == 2
    finally:
        event.remove(sessions, "after_commit", next_save)
    with sessions() as db:
        assert service(db, user_id).status().revision == 3


def prepare_reset(store):
    sessions, user_id, child_id = store
    with sessions() as db:
        user = db.get(models.User, user_id)
        user.password_hash = hash_password("2468")
        now = codes._now()
        db.add(models.PhoneCode(phone=user.phone, purpose="reset", code_hash=codes._digest(user.phone, "reset", "123456"),
                                expires_at=now + codes.CODE_LIFETIME, sent_at=now, attempts=0, sends=1, window_start=now))
        db.commit()
        service(db, user_id).save(snapshot(child_id))


def test_reset_between_authentication_and_erasure_preserves_account_and_all_child_data(store, monkeypatch):
    sessions, user_id, child_id = store
    prepare_reset(store)
    original = AccountService.authenticate

    def reset_after_authentication(self, phone, pin):
        authenticated = original(self, phone, pin)
        # Another request resets the PIN after the deletion's password check, but before its
        # account lock. The lock must not refresh token_version and bless that old PIN.
        with sessions() as other:
            AccountService(other).reset_pin(schemas.PinReset(phone=phone, code="123456", pin="9753"))
        return authenticated

    monkeypatch.setattr(AccountService, "authenticate", reset_after_authentication)
    with sessions() as db, pytest.raises(InvalidCredentials):
        AccountService(db).delete_account(schemas.AccountDelete(phone="+250780000001", pin="2468"))
    with sessions() as db:
        user = db.get(models.User, user_id)
        assert user.token_version == 1 and verify_password("9753", user.password_hash)
        assert db.get(models.ChildProfile, child_id) is not None
        assert service(db, user_id).status().revision == 1
        assert db.get(models.PhoneCode, (user.phone, "reset")).code_hash is None


def test_concurrent_reset_and_erasure_finish_without_partial_account_data(store):
    sessions, user_id, child_id = store
    prepare_reset(store)
    ready = Barrier(2)

    def reset():
        with sessions() as db:
            ready.wait(timeout=10)
            try:
                AccountService(db).reset_pin(schemas.PinReset(phone="+250780000001", code="123456", pin="9753"))
                return True
            except NotFound:
                return False

    def erase():
        with sessions() as db:
            ready.wait(timeout=10)
            try:
                AccountService(db).delete_account(schemas.AccountDelete(phone="+250780000001", pin="2468"))
                return True
            except (InvalidCredentials, NotFound):
                return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        reset_result, erase_result = pool.submit(reset), pool.submit(erase)
        reset_ok, erased = reset_result.result(timeout=15), erase_result.result(timeout=15)
    assert reset_ok != erased
    with sessions() as db:
        if erased:
            assert db.get(models.User, user_id) is None
            assert db.get(models.ChildProfile, child_id) is None
            assert db.get(models.AccountBackup, user_id) is None
            assert db.scalars(select(models.PhoneCode)).all() == []
        else:
            user = db.get(models.User, user_id)
            assert verify_password("9753", user.password_hash)
            assert db.get(models.ChildProfile, child_id) is not None
            assert service(db, user_id).status().revision == 1
