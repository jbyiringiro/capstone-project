"""Synthetic transport checks: no real Neon management key, branch or user is contacted."""
import io
import json
from email.message import Message
from urllib.error import HTTPError, URLError

import pytest

from app.config import Settings
from app.services.errors import EmailAuthUnavailable, EmailProviderError
from app.services.neon_management import NeonManagementDeletion, _NoRedirects

AUTH_URL = "https://ep-vuga.neonauth.c-7.eu-central-1.aws.neon.tech/neondb/auth"
ROOT = "https://console.neon.tech/api/v2/projects/vuga-test-123/branches/br-vuga-test/auth"


def response(payload=None, status=200):
    value = io.BytesIO(json.dumps(payload).encode() if payload is not None else b"")
    value.status = status
    return value


@pytest.fixture
def management(monkeypatch):
    client = NeonManagementDeletion(AUTH_URL, "vuga-test-123", "br-vuga-test", "synthetic-management-key")
    client.calls = []
    client.metadata = {"auth_provider": "better_auth", "branch_id": "br-vuga-test", "base_url": AUTH_URL}
    client.delete_status = 204

    def request(req, timeout):
        client.calls.append(req)
        assert timeout == 10
        assert req.get_header("Authorization") == "Bearer synthetic-management-key"
        if req.method == "GET":
            assert req.full_url == ROOT
            return response(client.metadata)
        assert req.method == "DELETE"
        return response(status=client.delete_status)
    monkeypatch.setattr(client._opener, "open", request)
    return client


def test_management_delete_checks_exact_branch_and_uses_fixed_server_api(management):
    uid = "51823529-bc9c-4ab9-8a08-7437e8914839"
    management.delete(uid)
    assert [(call.method, call.full_url) for call in management.calls] == [
        ("GET", ROOT), ("DELETE", ROOT + "/users/" + uid)]
    assert all(call.data is None and call.get_header("Cookie") is None for call in management.calls)
    assert _NoRedirects().redirect_request(None, None, 302, "", {}, "https://other.example") is None


@pytest.mark.parametrize("metadata", [
    {}, {"auth_provider": "stack", "branch_id": "br-vuga-test", "base_url": AUTH_URL},
    {"auth_provider": "better_auth", "branch_id": "br-other", "base_url": AUTH_URL},
    {"auth_provider": "better_auth", "branch_id": "br-vuga-test", "base_url": AUTH_URL + "/"},
    {"auth_provider": "better_auth", "branch_id": "br-vuga-test", "base_url": "https://other.neon.build/neondb/auth"},
])
def test_mismatched_management_branch_never_deletes(management, metadata):
    management.metadata = metadata
    with pytest.raises(EmailAuthUnavailable):
        management.delete("synthetic-user-uid")
    assert [call.method for call in management.calls] == ["GET"]


@pytest.mark.parametrize("project,branch,key", [
    ("../wrong", "br-vuga-test", "key"), ("vuga-test", "br-vuga-test/../auth", "key"),
    ("vuga-test", "br-test?query", "key"), ("vuga-test", "br-test#fragment", "key"),
    ("vuga-test", "br-vuga-test", ""), ("vuga-test", "br-vuga-test", "key\r\nInjected:yes"),
    ("", "br-vuga-test", "key"), ("x" * 61, "br-vuga-test", "key"),
])
def test_invalid_management_configuration_fails_before_network(monkeypatch, project, branch, key):
    client = NeonManagementDeletion(AUTH_URL, project, branch, key)
    monkeypatch.setattr(client._opener, "open", lambda *args, **kwargs: pytest.fail("unexpected request"))
    with pytest.raises(EmailProviderError) as error:
        client.preflight()
    assert error.value.code == "ACCOUNT_DELETION_DISABLED"


@pytest.mark.parametrize("uid", ["", ".", "..", "../another", "name/other", "name\\other",
                                 "uid?query", "uid#fragment", "uid%2Fother", "uid\r\nInjected", "x" * 129])
def test_path_like_user_ids_are_refused_before_any_management_request(management, uid):
    with pytest.raises(EmailAuthUnavailable):
        management.delete(uid)
    assert management.calls == []


@pytest.mark.parametrize("status", [200, 202, 301, 302, 400, 401, 403, 404, 409, 429, 500])
def test_only_204_confirms_deletion(management, status):
    management.delete_status = status
    with pytest.raises(EmailAuthUnavailable):
        management.delete("synthetic-user")


@pytest.mark.parametrize("error", [
    HTTPError(ROOT, 404, "private-path-and-key", Message(), io.BytesIO(b"private-key")),
    HTTPError(ROOT, 302, "private-path-and-key", Message(), io.BytesIO(b"private-key")),
    URLError("private-path-and-key"), TimeoutError("private-path-and-key"),
])
def test_transport_failures_do_not_disclose_secrets_or_provider_bodies(management, monkeypatch, error):
    def fail(*args, **kwargs):
        raise error
    monkeypatch.setattr(management._opener, "open", fail)
    with pytest.raises(EmailAuthUnavailable) as caught:
        management.preflight()
    assert "private" not in str(caught.value) and "synthetic-management-key" not in str(caught.value)


@pytest.mark.parametrize("payload", [b"not json", b"[]", b"null", b"x" * (64 * 1024 + 1)],
                         ids=["invalid-json", "list", "null", "oversized"])
def test_invalid_or_oversized_configuration_response_fails_closed(management, monkeypatch, payload):
    def invalid(*args, **kwargs):
        value = io.BytesIO(payload)
        value.status = 200
        return value
    monkeypatch.setattr(management._opener, "open", invalid)
    with pytest.raises(EmailAuthUnavailable):
        management.preflight()


def test_management_key_is_redacted_and_deletion_defaults_off():
    settings = Settings(_env_file=None, neon_management_api_key="synthetic-management-secret")
    assert "synthetic-management-secret" not in repr(settings)
    assert not settings.neon_delete_enabled and settings.neon_delete_mode == "self_service"
