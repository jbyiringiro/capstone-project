"""Firebase Email/Password identity boundary, using its documented ID-token and REST protocols.

Passwords never reach Vuga. Signatures use Google's fixed certificate URL, with project-bound
issuer/audience and verified-email claims. Every cloud request also checks the provider's current
account state; a signed but revoked/deleted/disabled identity is not sufficient. No admin key or
billing-only Firebase service is needed. Network errors fail closed without logging token data.
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from jose import JWTError, jwt

from ..config import settings
from .errors import EmailAuthUnavailable, EmailNotVerified, InvalidCredentials

CERTIFICATES_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
IDENTITY_URL = "https://identitytoolkit.googleapis.com/v1/"
RECENT_LOGIN_SECONDS = 300
_MAX_RESPONSE = 1024 * 1024


@dataclass(frozen=True)
class EmailIdentity:
    project_id: str
    uid: str
    email: str
    auth_time: int
    expires_at: int


class FirebaseAuth:
    def __init__(self, project_id: str | None, api_key: str | None) -> None:
        self.project_id = project_id
        self.api_key = api_key
        self._certificates: dict[str, str] = {}
        self._certificates_until = 0.0
        self._certificates_lock = Lock()

    @property
    def configured(self) -> bool:
        return bool(self.project_id and self.api_key)

    def _require_configuration(self) -> None:
        if not self.configured:
            raise EmailAuthUnavailable("email sign-in is not configured")

    def _request(self, url: str, body: dict | None = None) -> tuple[dict, str]:
        data = json.dumps(body).encode() if body is not None else None
        request = Request(url, data=data, headers={"Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=10) as response:
                raw = response.read(_MAX_RESPONSE + 1)
                if len(raw) > _MAX_RESPONSE:
                    raise ValueError("oversized provider response")
                result = json.loads(raw)
                if not isinstance(result, dict):
                    raise TypeError("invalid provider response")
                return result, response.headers.get("Cache-Control", "")
        except HTTPError as error:
            # Only bounded provider error codes cross this boundary. Never echo its body or URL.
            code = None
            try:
                payload = json.loads(error.read(_MAX_RESPONSE))
                message = payload.get("error", {}).get("message", "")
                if isinstance(message, str):
                    code = message.split(" : ", 1)[0]
            except (ValueError, AttributeError, TypeError):
                pass
            if code in {"INVALID_ID_TOKEN", "TOKEN_EXPIRED", "USER_DISABLED", "INVALID_REFRESH_TOKEN"}:
                raise InvalidCredentials("invalid or expired email session") from None
            if code == "USER_NOT_FOUND":
                raise _ProviderAccountMissing() from None
            if code == "CREDENTIAL_TOO_OLD_LOGIN_AGAIN":
                raise InvalidCredentials("sign in again before deleting your account") from None
            raise EmailAuthUnavailable("email provider is unavailable; try again") from None
        except (URLError, TimeoutError, OSError, ValueError, TypeError):
            raise EmailAuthUnavailable("email provider is unavailable; try again") from None

    def _account_request(self, action: str, token: str) -> dict:
        self._require_configuration()
        result, _ = self._request(IDENTITY_URL + action + "?" + urlencode({"key": self.api_key}),
                                  {"idToken": token})
        return result

    def _signing_key(self, kid: str) -> str:
        with self._certificates_lock:
            if time.monotonic() >= self._certificates_until:
                certificates, cache = self._request(CERTIFICATES_URL)
                if not certificates or not all(isinstance(k, str) and isinstance(v, str)
                                                for k, v in certificates.items()):
                    raise EmailAuthUnavailable("email verification keys are unavailable")
                self._certificates = certificates
                match = re.search(r"(?:^|,)\s*max-age=(\d+)", cache)
                ttl = min(int(match.group(1)), 86400) if match else 300
                self._certificates_until = time.monotonic() + ttl
            certificate = self._certificates.get(kid)
        if not certificate:
            raise InvalidCredentials("invalid email session")
        try:
            return x509.load_pem_x509_certificate(certificate.encode()).public_key().public_bytes(
                serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
        except (ValueError, TypeError):
            raise EmailAuthUnavailable("email verification keys are unavailable") from None

    def verify_signature(self, token: str, *, recent: bool = False) -> EmailIdentity:
        """Does not contact the account lookup endpoint: deletion retries may already be erased.

        Ordinary sign-in and access MUST use verify() below, including current provider state.
        """
        self._require_configuration()
        try:
            header = jwt.get_unverified_header(token)
            if header.get("alg") != "RS256" or not isinstance(header.get("kid"), str):
                raise InvalidCredentials("invalid email session")
            claims = jwt.decode(token, self._signing_key(header["kid"]), algorithms=["RS256"],
                                audience=self.project_id, issuer=f"https://securetoken.google.com/{self.project_id}",
                                options={"require_exp": True, "require_iat": True, "require_aud": True,
                                         "require_iss": True, "require_sub": True})
            now = time.time()
            uid, email = claims["sub"], claims.get("email")
            auth_time, issued = claims.get("auth_time"), claims["iat"]
            if (not isinstance(uid, str) or not 1 <= len(uid) <= 128
                    or claims["aud"] != self.project_id or type(claims["exp"]) is not int
                    or not isinstance(email, str) or not 3 <= len(email) <= 254 or "@" not in email
                    or type(auth_time) is not int or type(issued) is not int
                    or auth_time > now or issued > now or auth_time < 0
                    or not isinstance(claims.get("firebase"), dict)
                    or claims["firebase"].get("sign_in_provider") != "password"
                    or claims["firebase"].get("tenant") is not None):
                raise InvalidCredentials("invalid email session")
            if claims.get("email_verified") is not True:
                raise EmailNotVerified("verify your email before signing in")
            if recent and now - auth_time > RECENT_LOGIN_SECONDS:
                raise InvalidCredentials("sign in again before deleting your account")
            return EmailIdentity(self.project_id, uid, email.strip().casefold(), auth_time, claims["exp"])
        except (JWTError, KeyError, TypeError, ValueError):
            raise InvalidCredentials("invalid or expired email session") from None

    def verify(self, token: str, *, recent: bool = False) -> EmailIdentity:
        identity = self.verify_signature(token, recent=recent)
        try:
            payload = self._account_request("accounts:lookup", token)
        except _ProviderAccountMissing:
            raise InvalidCredentials("invalid or expired email session") from None
        users = payload.get("users")
        if not isinstance(users, list) or len(users) != 1 or not isinstance(users[0], dict):
            raise InvalidCredentials("invalid or expired email session")
        user = users[0]
        try:
            since = int(user.get("validSince", 0))
        except (TypeError, ValueError):
            raise EmailAuthUnavailable("email provider returned invalid account state") from None
        if (user.get("localId") != identity.uid or user.get("disabled") is True
                or not isinstance(user.get("email"), str)
                or user["email"].strip().casefold() != identity.email
                or identity.auth_time < since):
            raise InvalidCredentials("invalid or expired email session")
        if user.get("emailVerified") is not True:
            raise EmailNotVerified("verify your email before signing in")
        return identity

    def delete(self, token: str) -> None:
        try:
            self._account_request("accounts:delete", token)
        except _ProviderAccountMissing:
            pass  # Retrying a request whose first response was lost is successful.


class _ProviderAccountMissing(Exception):
    pass


firebase_auth = FirebaseAuth(settings.firebase_project_id, settings.firebase_api_key)
