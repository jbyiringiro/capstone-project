"""Neon transport/session and identity tests use only synthetic responses and disposable DBs."""
import io
import json
import time
from datetime import UTC, datetime, timedelta
from email.message import Message
from urllib.error import HTTPError, URLError

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import sessionmaker

from app import models, schemas
from app.config import settings
from app.db import Base, get_db
from app.main import app
from app.migrations import migrate_email_accounts
from app.routers import auth
from app.security import create_token
from app.services import email_accounts
from app.services.email_accounts import EmailAccountService
from app.services.errors import (
    Conflict,
    EmailAuthUnavailable,
    EmailDeletionPending,
    EmailNotVerified,
    EmailProviderError,
    InvalidCredentials,
)
from app.services.neon_auth import NeonAuth, _NoRedirects

AUTH_URL = "https://ep-vuga.neonauth.c-7.eu-central-1.aws.neon.tech/neondb/auth"


@pytest.fixture
def provider(monkeypatch):
    provider = NeonAuth(AUTH_URL, "http://localhost:5173", "test-secret-with-at-least-32-characters", delete_enabled=True)
    provider.user = {"id": "neon-test-uid", "email": "parent@example.test", "name": "Parent", "emailVerified": True}
    provider.session = {"id": "session-id", "userId": "neon-test-uid", "token": "never-expose-raw-token",
                        "expiresAt": (datetime.now(UTC) + timedelta(hours=1)).isoformat()}
    provider.calls = []
    provider.revoked = False
    provider.delete_result = {"success": True, "message": "User deleted"}

    def request(path, body=None, *, cookie=None):
        provider.calls.append((path, body, cookie))
        if path == "/sign-in/email":
            return {"user": provider.user}, ["__Secure-neon-auth.session_token=signed-test-cookie; Secure; HttpOnly; Path=/"]
        if path.startswith("/get-session"):
            return None if provider.revoked else {"user": provider.user, "session": provider.session}, []
        if path == "/delete-user":
            return provider.delete_result, []
        if path == "/sign-up/email":
            return {"user": {**provider.user, "emailVerified": False}, "token": None}, []
        if path == "/email-otp/verify-email":
            return {"status": True, "user": provider.user, "token": "discard-this-token"}, []
        if path == "/revoke-sessions":
            provider.revoked = True
            return {"status": True}, []
        return {"success": True}, []

    monkeypatch.setattr(provider, "_request", request)
    return provider


@pytest.fixture
def store(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'neon.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine, autoflush=False)
    engine.dispose()


def signed(provider):
    return provider.login("parent@example.test", "a-test-password")["idToken"]


def open_account(store, provider, token):
    with store() as db:
        return EmailAccountService(db, provider).session(schemas.EmailSessionIn(id_token=token, name="Parent"))


def reseal(auth_provider, token, **overrides):
    claims = auth_provider._open(token)
    claims.update(overrides)
    return "neon." + auth_provider._cipher.encrypt(json.dumps(claims).encode()).decode()


def test_login_envelope_hides_provider_cookie_and_each_request_checks_neon(provider):
    token = signed(provider)
    assert token.startswith("neon.") and "signed-test-cookie" not in token and "parent@" not in token
    assert provider.verify(token).uid == "neon-test-uid"
    assert provider.verify(token).email == "parent@example.test"
    lookups = [call for call in provider.calls if call[0].startswith("/get-session")]
    assert len(lookups) == 3 and all("disableCookieCache=true" in call[0] for call in lookups)
    assert all(call[2] == "__Secure-neon-auth.session_token=signed-test-cookie" for call in lookups)


@pytest.mark.parametrize("changes", [{"provider": "https://other.neon.build/neondb/auth"}, {"exp": 1},
                                    {"auth_time": int(time.time()) + 3600}, {"v": 2},
                                    {"cookie": "cookie\r\nAuthorization: injected"}])
def test_sealed_but_invalid_claims_rejected_before_provider_request(provider, changes):
    token = reseal(provider, signed(provider), **changes)
    count = len(provider.calls)
    with pytest.raises(InvalidCredentials):
        provider.verify(token)
    assert len(provider.calls) == count


def test_tampered_and_other_secret_tokens_rejected(provider):
    token = signed(provider)
    with pytest.raises(InvalidCredentials):
        provider.verify(token[:-8] + "bad-signature")
    other = NeonAuth(AUTH_URL, "http://localhost:5173", "different-signing-secret-that-is-long")
    with pytest.raises(InvalidCredentials):
        other.verify(token)


@pytest.mark.parametrize("changes", [{"id": "someone-else"}, {"email": "someone@example.test"},
                                    {"banned": True}])
def test_current_identity_must_match_encrypted_identity(provider, changes):
    token = signed(provider)
    provider.user.update(changes)
    with pytest.raises(InvalidCredentials):
        provider.verify(token)


def test_revocation_verification_impersonation_and_session_expiry_fail_closed(provider):
    token = signed(provider)
    provider.revoked = True
    with pytest.raises(InvalidCredentials):
        provider.verify(token)
    provider.revoked = False
    provider.user["emailVerified"] = False
    with pytest.raises(EmailNotVerified):
        provider.verify(token)
    provider.user["emailVerified"] = True
    provider.session["impersonatedBy"] = "an-admin"
    with pytest.raises(InvalidCredentials):
        provider.verify(token)
    provider.session.pop("impersonatedBy")
    provider.session["expiresAt"] = "2000-01-01T00:00:00Z"
    with pytest.raises(InvalidCredentials):
        provider.verify(token)


def test_unverified_provider_signup_does_not_create_vuga_session(provider):
    assert provider.register("Parent", "parent@example.test", "test-password") == {
        "email": "parent@example.test", "verificationSent": True}
    assert [call[0] for call in provider.calls] == ["/sign-up/email"]  # provider already sent the OTP
    assert provider.verify_email("parent@example.test", "123456") == {"email": "parent@example.test", "verified": True}
    provider.user["emailVerified"] = False
    with pytest.raises(EmailNotVerified):
        provider.login("parent@example.test", "test-password")


def test_signup_requires_provider_verification_configuration(provider, monkeypatch):
    def unsafe(*args, **kwargs):
        return {"user": provider.user, "token": "auto-session-without-verification"}, []
    monkeypatch.setattr(provider, "_request", unsafe)
    with pytest.raises(EmailProviderError) as error:
        provider.register("Parent", "parent@example.test", "test-password")
    assert error.value.account_created and error.value.code == "VERIFICATION_CONFIGURATION_REQUIRED"


def test_password_reset_explicitly_revokes_all_existing_sessions(provider):
    assert provider.request_reset("parent@example.test") == {"sent": True}
    assert provider.reset_password("parent@example.test", "123456", "new-password") == {"reset": True}
    assert [c[0] for c in provider.calls] == ["/email-otp/request-password-reset", "/email-otp/reset-password",
                                           "/sign-in/email", "/revoke-sessions"]
    assert provider.revoked


@pytest.mark.parametrize("revoke_result", [{"status": False}, None, {"success": True}])
def test_password_reset_reports_partial_success_and_retry_does_not_reuse_otp(provider, monkeypatch, revoke_result):
    original = provider._request

    def unconfirmed(path, body=None, **kwargs):
        if path == "/revoke-sessions":
            return revoke_result, []
        return original(path, body, **kwargs)
    monkeypatch.setattr(provider, "_request", unconfirmed)
    with pytest.raises(EmailProviderError) as error:
        provider.reset_password("parent@example.test", "123456", "new-password")
    assert error.value.password_reset and error.value.code == "PASSWORD_RESET_COMPLETED"
    monkeypatch.setattr(provider, "_request", original)
    before = len(provider.calls)
    assert provider.finish_reset("parent@example.test", "new-password") == {"reset": True}
    assert [c[0] for c in provider.calls[before:]] == ["/sign-in/email", "/revoke-sessions"]


@pytest.mark.parametrize("url", ["http://ep-vuga.neon.build/neondb/auth", "https://evil.example/auth",
                                "https://user:pass@ep-vuga.neon.build/neondb/auth",
                                "https://ep-vuga.neon.build/neondb/auth?key=oops",
                                "https://ep-vuga.neon.build/neondb/auth#oops",
                                "https://ep-vuga.neon.build.evil.example/auth"])
def test_provider_configuration_cannot_target_arbitrary_hosts(url):
    assert not NeonAuth(url, "https://vuga-app.onrender.com", "long-secret-for-tests").configured


def test_provider_cookie_cache_is_discarded_and_missing_cookie_fails_closed():
    assert NeonAuth._cookie(["__Secure-neon-auth.session_token=signed; HttpOnly; Secure",
                             "neon-auth.session_data=cached-user; HttpOnly"]) == "__Secure-neon-auth.session_token=signed"
    with pytest.raises(EmailAuthUnavailable):
        NeonAuth._cookie(["neon-auth.session_data=cached-user"])
    assert _NoRedirects().redirect_request(None, None, 302, "", {}, "https://other.example") is None


def test_transport_uses_fixed_origin_and_does_not_expose_provider_errors(monkeypatch):
    provider = NeonAuth(AUTH_URL, "https://vuga-app.onrender.com", "test-secret")
    seen = []

    def fail(request, timeout):
        seen.append(request)
        raise URLError("secret-cookie-and-password")
    monkeypatch.setattr(provider._opener, "open", fail)
    with pytest.raises(EmailAuthUnavailable) as error:
        provider._request("/sign-in/email", {"password": "private-password"})
    assert "secret" not in str(error.value) and "private" not in str(error.value)
    assert seen[0].get_header("Origin") == "https://vuga-app.onrender.com"

    def limited(request, timeout):
        raise HTTPError(request.full_url, 429, "", Message(), io.BytesIO(b'{"message":"private-password"}'))
    monkeypatch.setattr(provider._opener, "open", limited)
    with pytest.raises(EmailProviderError) as error:
        provider._request("/sign-in/email", {})
    assert error.value.code == "TOO_MANY_REQUESTS" and error.value.status == 429


def test_neon_provisioning_preserves_stable_identity_and_does_not_merge_emails(store, provider):
    token = signed(provider)
    user = open_account(store, provider, token)
    with store() as db:
        same = EmailAccountService(db, provider).session(schemas.EmailSessionIn(id_token=token))
        assert same.user_id == user.user_id and same.auth_provider == "neon"
        assert same.password_hash is None and same.firebase_uid is None
        db.add(models.User(name="Old Firebase parent", email="old@example.test", role="caregiver",
                           firebase_uid="old-firebase", firebase_project_id="old-project"))
        db.commit()
    provider.user.update(id="new-neon-uid", email="old@example.test")
    provider.session["userId"] = "new-neon-uid"
    with store() as db, pytest.raises(Conflict):
        EmailAccountService(db, provider).session(schemas.EmailSessionIn(id_token=signed(provider), name="Different"))
    with store() as db:
        old = db.scalar(select(models.User).where(models.User.firebase_uid == "old-firebase"))
        assert old.neon_uid is None and old.name == "Old Firebase parent"


def test_deletion_needs_fresh_login_and_enabled_capability_before_erasing(store, provider):
    token = signed(provider)
    user = open_account(store, provider, token)
    stale = reseal(provider, token, auth_time=int(time.time()) - 301)
    with store() as db, pytest.raises(InvalidCredentials):
        EmailAccountService(db, provider).delete_account(schemas.EmailDelete(id_token=stale, user_id=user.user_id))
    provider.delete_enabled = False
    with store() as db, pytest.raises(EmailAuthUnavailable):
        EmailAccountService(db, provider).delete_account(schemas.EmailDelete(id_token=token, user_id=user.user_id))
    with store() as db:
        assert db.get(models.User, user.user_id) is not None


def test_deletion_pending_is_honest_and_tombstone_blocks_resurrection(store, provider):
    token = signed(provider)
    user = open_account(store, provider, token)
    provider.delete_result = {"success": True, "message": "Verification email sent"}
    with store() as db, pytest.raises(EmailDeletionPending):
        EmailAccountService(db, provider).delete_account(schemas.EmailDelete(id_token=token, user_id=user.user_id))
    with store() as db:
        assert db.get(models.User, user.user_id) is None
        assert db.get(models.NeonIdentity, (AUTH_URL, "neon-test-uid")).deleted
        with pytest.raises(InvalidCredentials):
            EmailAccountService(db, provider).session(schemas.EmailSessionIn(id_token=token, name="Again"))
    provider.delete_result = {"success": True, "message": "User deleted"}
    with store() as db:
        EmailAccountService(db, provider).delete_account(schemas.EmailDelete(id_token=token, user_id=user.user_id))
        assert db.get(models.NeonIdentity, (AUTH_URL, "neon-test-uid")).provider_deleted
    calls = len(provider.calls)
    provider.revoked = True
    with store() as db:
        EmailAccountService(db, provider).delete_account(schemas.EmailDelete(id_token=token, user_id=user.user_id))
    assert len(provider.calls) == calls  # successful-response replay does not need the revoked cookie


def test_api_dispatch_rejects_wrong_provider_tokens_and_disables_sms(store, provider, monkeypatch):
    monkeypatch.setattr(settings, "email_auth_provider", "neon")
    monkeypatch.setattr(email_accounts, "neon_auth", provider)
    monkeypatch.setattr(auth, "neon_auth", provider)

    def database():
        with store() as db:
            yield db
    before = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = database
    try:
        client = TestClient(app)
        login = client.post("/auth/neon/login", json={"email": "parent@example.test", "password": "test-password"})
        assert login.status_code == 200 and login.headers["Cache-Control"] == "no-store"
        invalid = client.post("/auth/neon/login", json={"email": "parent@example.test", "password": "shh!5"})
        assert invalid.status_code == 422 and "shh!5" not in invalid.text and "input" not in invalid.text
        token = login.json()["idToken"]
        session = client.post("/auth/email/session", json={"id_token": token, "name": "Parent"})
        assert session.status_code == 200 and session.json()["user"]["auth_provider"] == "neon"
        assert client.get("/auth/me", headers={"Authorization": "Bearer " + token}).status_code == 200
        assert client.post("/auth/code", json={"phone": "0788000001", "purpose": "register"}).status_code == 503
        with store() as db:
            user = db.get(models.User, session.json()["user"]["user_id"])
            old_token = create_token(user)
        assert client.get("/auth/me", headers={"Authorization": "Bearer " + old_token}).status_code == 401
        fake_firebase = jwt.encode({"sub": "uid"}, "synthetic", headers={"alg": "HS256"})
        assert client.post("/auth/email/session", json={"id_token": fake_firebase, "name": "Parent"}).status_code == 401
        monkeypatch.setattr(settings, "email_auth_provider", "firebase")
        assert client.get("/auth/me", headers={"Authorization": "Bearer " + token}).status_code == 401
        assert client.post("/auth/neon/login", json={"email": "parent@example.test", "password": "test-password"}).status_code == 503
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(before)


def test_neon_additive_migration_preserves_existing_firebase_and_phone_data(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE users (user_id VARCHAR(36) PRIMARY KEY,name VARCHAR(120) NOT NULL,"
                          "phone VARCHAR(32),password_hash VARCHAR(128),email VARCHAR(254),"
                          "firebase_uid VARCHAR(128),firebase_project_id VARCHAR(128),role VARCHAR(16) NOT NULL)"))
        conn.execute(text("INSERT INTO users VALUES ('old-id','Parent',NULL,NULL,'parent@example.test','old-uid','project','caregiver')"))
    migrate_email_accounts(engine)
    migrate_email_accounts(engine)
    assert {"neon_uid", "neon_auth_url"} <= {col["name"] for col in inspect(engine).get_columns("users")}
    assert "neon_identities" in inspect(engine).get_table_names()
    with engine.connect() as conn:
        row = conn.execute(text("SELECT user_id,firebase_uid,neon_uid FROM users")).one()
        assert tuple(row) == ("old-id", "old-uid", None)
    engine.dispose()
