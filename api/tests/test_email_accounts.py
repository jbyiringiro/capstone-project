"""Email identity tests use synthetic RSA tokens and disposable DBs, never Firebase accounts."""
import io
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from urllib.error import HTTPError, URLError

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine, event, inspect, select, text
from sqlalchemy.orm import sessionmaker

from app import models, schemas
from app.db import Base, get_db
from app.main import app
from app.migrations import migrate_email_accounts
from app.security import create_token
from app.services import email_accounts, firebase_auth
from app.services.email_accounts import EmailAccountService
from app.services.errors import (
    EmailAuthUnavailable,
    EmailDeletionPending,
    EmailNotVerified,
    InvalidCredentials,
    InvalidInput,
)
from app.services.firebase_auth import FirebaseAuth


@pytest.fixture(scope="module")
def signing_key():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "synthetic-test-only")])
    certificate = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
                   .public_key(key.public_key()).serial_number(x509.random_serial_number())
                   .not_valid_before(datetime.now(UTC) - timedelta(days=1))
                   .not_valid_after(datetime.now(UTC) + timedelta(days=1)).sign(key, hashes.SHA256()))
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption()), certificate.public_bytes(serialization.Encoding.PEM).decode()


@pytest.fixture
def provider(signing_key, monkeypatch):
    provider = FirebaseAuth("vuga-email-test", "public-test-key")
    provider.calls = []
    provider.account = {"localId": "test-uid", "email": "parent@example.test", "emailVerified": True,
                        "validSince": "0"}

    def request(url, body=None):
        provider.calls.append((url, body))
        if url == firebase_auth.CERTIFICATES_URL:
            return {"test-key": signing_key[1]}, "public, max-age=3600"
        if "accounts:lookup" in url:
            return {"users": [provider.account]}, ""
        if "accounts:delete" in url:
            return {}, ""
        pytest.fail("unexpected request")

    monkeypatch.setattr(provider, "_request", request)
    return provider


def token(signing_key, **overrides):
    now = int(time.time())
    claims = {"sub": "test-uid", "iss": "https://securetoken.google.com/vuga-email-test",
              "aud": "vuga-email-test", "exp": now + 3600, "iat": now, "auth_time": now,
              "email": "parent@example.test", "email_verified": True,
              "firebase": {"sign_in_provider": "password"}}
    claims.update(overrides)
    return jwt.encode(claims, signing_key[0], algorithm="RS256", headers={"kid": "test-key"})


@pytest.fixture
def store(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'email.db'}", connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine, autoflush=False)
    engine.dispose()


def open_account(db, provider, signed_token):
    return EmailAccountService(db, provider).session(schemas.EmailSessionIn(id_token=signed_token, name="Test Parent"))


def test_verified_identity_uses_signature_and_current_provider_state(provider, signing_key):
    identity = provider.verify(token(signing_key))
    assert identity.uid == "test-uid" and identity.email == "parent@example.test"
    provider.verify(token(signing_key))
    assert sum(url == firebase_auth.CERTIFICATES_URL for url, _ in provider.calls) == 1
    assert sum("accounts:lookup" in url for url, _ in provider.calls) == 2


@pytest.mark.parametrize("overrides", [
    {"aud": "another-project"}, {"iss": "https://example.test"}, {"exp": 1}, {"sub": ""},
    {"auth_time": int(time.time()) + 10000}, {"iat": int(time.time()) + 10000},
    {"firebase": {"sign_in_provider": "custom"}}, {"auth_time": "123"},
    {"aud": ["vuga-email-test"]}, {"firebase": {"sign_in_provider": "password", "tenant": "other-tenant"}},
])
def test_invalid_signed_claims_are_rejected_before_lookup(provider, signing_key, overrides):
    with pytest.raises(InvalidCredentials):
        provider.verify(token(signing_key, **overrides))
    assert not any("lookup" in url for url, _ in provider.calls)


def test_wrong_signature_algorithm_and_unverified_email_are_rejected(provider, signing_key):
    fake = jwt.encode({"sub": "test-uid"}, "not-a-real-secret", algorithm="HS256")
    with pytest.raises(InvalidCredentials):
        provider.verify(fake)
    with pytest.raises(EmailNotVerified):
        provider.verify(token(signing_key, email_verified=False))
    forged_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    forged = (forged_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                       serialization.NoEncryption()), "unused")
    with pytest.raises(InvalidCredentials):
        provider.verify(token(forged))


@pytest.mark.parametrize("changed", [{"disabled": True}, {"localId": "other"},
                                    {"email": "other@example.test"}, {"validSince": "revoked"}])
def test_current_provider_state_rejects_revoked_or_mismatched_identity(provider, signing_key, changed):
    provider.account.update(changed)
    if provider.account["validSince"] == "revoked":
        provider.account["validSince"] = str(int(time.time()) + 10)
    with pytest.raises(InvalidCredentials):
        provider.verify(token(signing_key))


def test_current_provider_verification_required(provider, signing_key):
    provider.account["emailVerified"] = False
    with pytest.raises(EmailNotVerified):
        provider.verify(token(signing_key))


def test_unconfigured_provider_refuses_access_without_network(signing_key):
    with pytest.raises(EmailAuthUnavailable):
        FirebaseAuth(None, None).verify(token(signing_key))


def test_provider_transport_errors_are_sanitized(monkeypatch):
    provider = FirebaseAuth("test", "public-key")

    def fail(*args, **kwargs):
        raise URLError("secret-token-and-provider-response")

    monkeypatch.setattr(firebase_auth, "urlopen", fail)
    with pytest.raises(EmailAuthUnavailable) as error:
        provider._request("https://example.test")
    assert "secret" not in str(error.value)

    def removed(*args, **kwargs):
        raise HTTPError("https://example.test", 400, "Bad", {},
                        io.BytesIO(json.dumps({"error": {"message": "USER_NOT_FOUND"}}).encode()))

    monkeypatch.setattr(firebase_auth, "urlopen", removed)
    provider.delete("synthetic-id-token")  # idempotent provider cleanup


def test_session_and_authenticated_api_keep_name_and_private_credentials_separate(store, provider, signing_key, monkeypatch):
    signed = token(signing_key)
    monkeypatch.setattr(email_accounts, "firebase_auth", provider)

    def database():
        with store() as db:
            yield db

    before = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = database
    try:
        client = TestClient(app)
        missing = client.get("/auth/me", headers={"Authorization": f"Bearer {signed}"})
        assert missing.status_code == 401  # Bearer authentication must never provision.
        response = client.post("/auth/email/session", json={"id_token": signed, "name": " Test Parent "})
        assert response.status_code == 200, response.text
        session = response.json()
        assert session["access_token"] == signed and session["user"]["auth_provider"] == "firebase"
        assert session["user"]["phone"] is None and session["user"]["email"] == "parent@example.test"
        assert client.get("/auth/me", headers={"Authorization": f"Bearer {signed}"}).json() == session["user"]
        second = client.post("/auth/email/session", json={"id_token": signed})
        assert second.json()["user"]["user_id"] == session["user"]["user_id"]
        assert client.post("/auth/email/session", json={"id_token": signed, "email": "spoof@test"}).status_code == 422
        with store() as db:
            user = db.get(models.User, session["user"]["user_id"])
            assert user.password_hash is None and user.phone is None
            legacy_signed = create_token(user)
        assert client.get("/auth/me", headers={"Authorization": f"Bearer {legacy_signed}"}).status_code == 401
        provider.account["disabled"] = True
        assert client.get("/auth/me", headers={"Authorization": f"Bearer {signed}"}).status_code == 401
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(before)


def test_delete_requires_recent_same_identity_and_erases_server_data(store, provider, signing_key):
    signed = token(signing_key)
    with store() as db:
        user = open_account(db, provider, signed)
        user_id = user.user_id
        db.add(models.ChildProfile(profile_id="child", code="P-01", created_by=user_id))
        db.add(models.AccountBackup(user_id=user_id, data="{}", size=2, saved_at=datetime.now(UTC), revision=1))
        db.add(models.DeletedProfile(user_id=user_id, profile_id="old-child"))
        db.commit()
        service = EmailAccountService(db, provider)
        with pytest.raises(InvalidCredentials):
            service.delete_account(schemas.EmailDelete(id_token=signed, user_id="another-user"))
        with pytest.raises(InvalidCredentials):
            service.delete_account(schemas.EmailDelete(id_token=token(signing_key, auth_time=int(time.time()) - 400),
                                                        user_id=user_id))
        service.delete_account(schemas.EmailDelete(id_token=signed, user_id=user_id))
    with store() as db:
        assert db.get(models.User, user_id) is None
        assert db.get(models.ChildProfile, "child") is None
        assert db.get(models.AccountBackup, user_id) is None
        assert db.scalar(select(models.DeletedProfile)) is None
        tombstone = db.get(models.FirebaseIdentity, ("vuga-email-test", "test-uid"))
        assert tombstone.deleted and tombstone.user_id == user_id
        with pytest.raises(InvalidCredentials):
            open_account(db, provider, signed)
        with pytest.raises(InvalidCredentials):
            EmailAccountService(db, provider).authenticate(signed)


def test_provider_failure_after_erasure_is_retriable_without_lookup_or_resurrection(store, provider, signing_key, monkeypatch):
    signed = token(signing_key)
    with store() as db:
        user_id = open_account(db, provider, signed).user_id

    def unavailable(_):
        raise EmailAuthUnavailable("timeout")

    monkeypatch.setattr(provider, "delete", unavailable)
    body = schemas.EmailDelete(id_token=signed, user_id=user_id)
    with store() as db, pytest.raises(EmailDeletionPending):
        EmailAccountService(db, provider).delete_account(body)
    with store() as db:
        assert db.get(models.User, user_id) is None
        with pytest.raises(InvalidCredentials):
            open_account(db, provider, signed)
    monkeypatch.setattr(provider, "delete", lambda _: None)
    monkeypatch.setattr(provider, "verify", lambda *args, **kwargs: pytest.fail("retry must not lookup deleted provider"))
    with store() as db:
        EmailAccountService(db, provider).delete_account(body)


def test_name_required_and_email_alone_cannot_link_an_existing_identity(store, provider, signing_key):
    signed = token(signing_key)
    with store() as db:
        with pytest.raises(InvalidInput):
            EmailAccountService(db, provider).session(schemas.EmailSessionIn(id_token=signed))
        user_id = open_account(db, provider, signed).user_id
    provider.account["localId"] = "different-uid"
    other_token = token(signing_key, sub="different-uid")
    from app.services.errors import Conflict

    with store() as db, pytest.raises(Conflict):
        open_account(db, provider, other_token)
    with store() as db:
        assert db.get(models.User, user_id).firebase_uid == "test-uid"
        assert len(db.scalars(select(models.User)).all()) == 1


def test_concurrent_first_signins_provision_one_account_and_delete_cannot_be_undone(store, provider, signing_key):
    signed = token(signing_key)
    barrier = Barrier(2)

    def signin():
        barrier.wait()
        with store() as db:
            return open_account(db, provider, signed).user_id

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: signin(), range(2)))
    assert results[0] == results[1]
    user_id = results[0]
    barrier = Barrier(2)

    def erase():
        barrier.wait()
        with store() as db:
            EmailAccountService(db, provider).delete_account(schemas.EmailDelete(id_token=signed, user_id=user_id))

    def concurrent_signin():
        barrier.wait()
        try:
            with store() as db:
                return open_account(db, provider, signed).user_id
        except InvalidCredentials:
            return None

    with ThreadPoolExecutor(max_workers=2) as executor:
        deletion = executor.submit(erase)
        provision = executor.submit(concurrent_signin)
        deletion.result()
        assert provision.result() in (None, user_id)
    with store() as db:
        assert db.get(models.User, user_id) is None
        with pytest.raises(InvalidCredentials):
            open_account(db, provider, signed)


def test_fresh_signup_after_deletion_gets_new_user_id_without_old_data(store, provider, signing_key):
    signed = token(signing_key)
    with store() as db:
        old_id = open_account(db, provider, signed).user_id
        EmailAccountService(db, provider).delete_account(schemas.EmailDelete(id_token=signed, user_id=old_id))
    provider.account["localId"] = "new-uid"
    fresh = token(signing_key, sub="new-uid")
    with store() as db:
        new_id = open_account(db, provider, fresh).user_id
        assert new_id != old_id
        with pytest.raises(InvalidCredentials):
            EmailAccountService(db, provider).delete_account(schemas.EmailDelete(id_token=fresh, user_id=old_id))
def test_sqlite_upgrade_keeps_existing_phone_accounts_and_foreign_keys(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as conn:
        conn.exec_driver_sql("PRAGMA foreign_keys=ON")
        conn.exec_driver_sql("CREATE TABLE users (user_id VARCHAR(36) PRIMARY KEY, name VARCHAR(120) NOT NULL, "
                             "phone VARCHAR(32) NOT NULL UNIQUE, role VARCHAR(16) NOT NULL, "
                             "password_hash VARCHAR(128) NOT NULL, token_version INTEGER NOT NULL DEFAULT 0, "
                             "created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL)")
        conn.exec_driver_sql("CREATE TABLE legacy_children (id TEXT PRIMARY KEY, created_by TEXT REFERENCES users(user_id))")
        conn.exec_driver_sql("INSERT INTO users (user_id,name,phone,role,password_hash) "
                             "VALUES ('old','Existing Parent','+250780000001','teacher','existing-hash')")
        conn.exec_driver_sql("INSERT INTO legacy_children VALUES ('child','old')")
        conn.exec_driver_sql("CREATE INDEX idx_legacy_user_name ON users (name)")
    migrate_email_accounts(engine)
    migrate_email_accounts(engine)
    columns = {column["name"]: column for column in inspect(engine).get_columns("users")}
    assert columns["phone"]["nullable"] and columns["password_hash"]["nullable"]
    assert {"email", "firebase_uid", "firebase_project_id"} <= columns.keys()
    with engine.begin() as conn:
        assert conn.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
        assert not conn.exec_driver_sql("PRAGMA foreign_key_check").all()
        assert conn.execute(text("SELECT phone,password_hash FROM users WHERE user_id='old'")).one() == (
            "+250780000001", "existing-hash")
        assert conn.exec_driver_sql("SELECT created_by FROM legacy_children").scalar() == "old"
        assert any(index["name"] == "idx_legacy_user_name" for index in inspect(conn).get_indexes("users"))
    with sessionmaker(bind=engine)() as db:
        db.add(models.User(name="New Parent", email="new@example.test", firebase_uid="new-uid",
                           firebase_project_id="vuga-email-test", role="caregiver"))
        db.commit()
    engine.dispose()
