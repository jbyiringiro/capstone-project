"""Neon Better Auth boundary for browsers without third-party cookies.

Passwords pass directly to the configured HTTPS provider and are never persisted. Only the
provider's session cookie is encrypted into an opaque, branch-bound bearer. Every authenticated
Vuga request checks the current Neon session, bypassing its optional cookie cache. Provider
cookies never reach the browser as cookies; no API key, database password or admin role is used.
"""
from __future__ import annotations

import base64
import hashlib
import json
import time
from datetime import datetime
from http.cookies import CookieError, SimpleCookie
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from cryptography.fernet import Fernet, InvalidToken

from ..config import settings
from .errors import EmailAuthUnavailable, EmailNotVerified, EmailProviderError, InvalidCredentials
from .firebase_auth import RECENT_LOGIN_SECONDS, EmailIdentity

_MAX_RESPONSE = 1024 * 1024
_ERRORS = {
    "EMAIL_NOT_VERIFIED": (403, "Verify your email before signing in."),
    "INVALID_EMAIL_OR_PASSWORD": (401, "Email or password is incorrect."),
    "INVALID_PASSWORD": (401, "Email or password is incorrect."),
    "USER_ALREADY_EXISTS": (409, "An account already exists; sign in or reset your password."),
    "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL": (409, "An account already exists; sign in or reset your password."),
    "INVALID_OTP": (400, "The verification code is incorrect or expired."),
    "OTP_EXPIRED": (400, "The verification code has expired; request another."),
    "TOO_MANY_ATTEMPTS": (429, "Too many attempts; wait before trying again."),
    "TOO_MANY_REQUESTS": (429, "Too many requests; wait before trying again."),
    "PASSWORD_TOO_SHORT": (422, "Use at least eight characters for the password."),
    "PASSWORD_TOO_LONG": (422, "Use at most 128 characters for the password."),
    "UNAUTHORIZED": (401, "Invalid or expired email session."),
    "SESSION_EXPIRED": (401, "Invalid or expired email session."),
    "SESSION_IS_NOT_FRESH": (401, "Sign in again before deleting your account."),
}


class _NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward a password or cookie to a redirect destination.


class NeonAuth:
    name = "neon"

    def __init__(self, auth_url: str | None, origin: str | None, secret: str,
                 *, delete_enabled: bool = False, session_seconds: int = 43200):
        self.auth_url = (auth_url or "").rstrip("/")
        self.origin = (origin or "").rstrip("/")
        self.delete_enabled = delete_enabled
        self.session_seconds = session_seconds
        # Domain separation prevents reuse of the JWT key as a raw encryption key.
        key = hashlib.sha256(b"vuga:neon-session:v1\0" + secret.encode()).digest()
        self._cipher = Fernet(base64.urlsafe_b64encode(key))
        self._opener = build_opener(_NoRedirects())

    @property
    def configured(self) -> bool:
        endpoint, origin = urlsplit(self.auth_url), urlsplit(self.origin)
        host = endpoint.hostname or ""
        neon_host = (".neonauth." in host and host.endswith(".neon.tech")) or host.endswith(".neon.build")
        return bool(neon_host and endpoint.scheme == "https" and endpoint.netloc == host
                    and endpoint.path.endswith("/auth") and len(self.auth_url) <= 512
                    and not endpoint.query and not endpoint.fragment
                    and origin.hostname and not origin.username and not origin.password
                    and origin.scheme in {"http", "https"} and not origin.path
                    and not origin.query and not origin.fragment
                    and (origin.scheme == "https" or origin.hostname in {"localhost", "127.0.0.1"}))

    def _require_configuration(self):
        if not self.configured:
            raise EmailAuthUnavailable("Neon email sign-in is not configured")

    def _request(self, path: str, body: dict | None = None, *, cookie: str | None = None):
        self._require_configuration()
        headers = {"Content-Type": "application/json", "Accept": "application/json", "Origin": self.origin}
        if cookie:
            headers["Cookie"] = cookie
        request = Request(self.auth_url + path, headers=headers,
                          data=json.dumps(body).encode() if body is not None else None)
        try:
            with self._opener.open(request, timeout=15) as response:
                raw = response.read(_MAX_RESPONSE + 1)
                if len(raw) > _MAX_RESPONSE:
                    raise ValueError("oversized response")
                payload = json.loads(raw)
                if payload is not None and not isinstance(payload, dict):
                    raise ValueError("invalid response")
                return payload, response.headers.get_all("Set-Cookie", [])
        except HTTPError as error:
            code = ""
            try:
                payload = json.loads(error.read(_MAX_RESPONSE))
                code = payload.get("code", "") if isinstance(payload, dict) else ""
            except (ValueError, TypeError):
                pass
            if error.code == 429:
                code = "TOO_MANY_REQUESTS"
            if isinstance(code, str) and code in _ERRORS:
                status, detail = _ERRORS[code]
                raise EmailProviderError(detail, code, status) from None
            # No body, URL, password, cookie, email or raw provider message is exposed/logged.
            raise EmailAuthUnavailable("email provider refused the request; check configuration or try again") from None
        except (URLError, TimeoutError, OSError, ValueError, TypeError):
            raise EmailAuthUnavailable("email provider is unavailable; try again") from None

    @staticmethod
    def _cookie(headers: list[str]) -> str:
        selected = []
        try:
            for header in headers:
                jar = SimpleCookie()
                jar.load(header)
                for name, item in jar.items():
                    # Exclude session_data: it can cache a user after revocation/deletion.
                    if name.endswith(".session_token") and item.value:
                        selected.append(f"{name}={item.coded_value}")
        except CookieError:
            raise EmailAuthUnavailable("email provider returned an invalid session") from None
        if len(selected) != 1 or len(selected[0]) > 8192:
            raise EmailAuthUnavailable("email provider did not return a usable session")
        return selected[0]

    def _current(self, cookie: str) -> tuple[dict, dict]:
        try:
            result, _ = self._request("/get-session?disableCookieCache=true", cookie=cookie)
        except EmailProviderError as error:
            if error.status == 401:
                raise InvalidCredentials("invalid or expired email session") from None
            raise
        if not isinstance(result, dict) or not isinstance(result.get("session"), dict) or not isinstance(result.get("user"), dict):
            raise InvalidCredentials("invalid or expired email session")
        user, session = result["user"], result["session"]
        if (not isinstance(user.get("id"), str) or not 1 <= len(user["id"]) <= 128
                or session.get("userId") != user["id"] or user.get("banned") is True
                or session.get("impersonatedBy")
                or not isinstance(user.get("email"), str) or not 3 <= len(user["email"]) <= 254
                or "@" not in user["email"]):
            raise InvalidCredentials("invalid or expired email session")
        if user.get("emailVerified") is not True:
            raise EmailNotVerified("verify your email before signing in")
        try:
            expiry = datetime.fromisoformat(session["expiresAt"])
            if expiry.tzinfo is None or expiry.timestamp() <= time.time():
                raise ValueError("expired")
        except (KeyError, ValueError, TypeError, AttributeError):
            raise InvalidCredentials("invalid or expired email session") from None
        return user, session

    def login(self, email: str, password: str) -> dict:
        _, headers = self._request("/sign-in/email", {"email": email, "password": password, "rememberMe": False})
        cookie = self._cookie(headers)
        user, session = self._current(cookie)
        now = int(time.time())
        expiry = min(now + self.session_seconds, int(datetime.fromisoformat(session["expiresAt"]).timestamp()))
        claims = {"v": 1, "provider": self.auth_url, "cookie": cookie, "uid": user["id"],
                  "email": user["email"].strip().casefold(), "auth_time": now, "exp": expiry}
        bearer = "neon." + self._cipher.encrypt(json.dumps(claims).encode()).decode()
        return {"idToken": bearer, "uid": user["id"], "email": claims["email"],
                "displayName": user.get("name", ""), "expiresIn": expiry - now}

    def _open(self, token: str, *, recent: bool = False) -> dict:
        self._require_configuration()
        try:
            if not token.startswith("neon.") or len(token) > 16384:
                raise ValueError("invalid token")
            claims = json.loads(self._cipher.decrypt(token[5:].encode(), ttl=self.session_seconds))
            now = time.time()
            if (not isinstance(claims, dict) or claims.get("v") != 1 or claims.get("provider") != self.auth_url
                    or type(claims.get("exp")) is not int or not now < claims["exp"] <= now + self.session_seconds
                    or type(claims.get("auth_time")) is not int or not 0 <= claims["auth_time"] <= now
                    or not isinstance(claims.get("uid"), str) or not 1 <= len(claims["uid"]) <= 128
                    or not isinstance(claims.get("email"), str) or "@" not in claims["email"]
                    or not isinstance(claims.get("cookie"), str) or "\r" in claims["cookie"] or "\n" in claims["cookie"]):
                raise ValueError("invalid token")
            if recent and now - claims["auth_time"] > RECENT_LOGIN_SECONDS:
                raise InvalidCredentials("sign in again before deleting your account")
            return claims
        except (InvalidToken, ValueError, TypeError, KeyError, UnicodeError):
            raise InvalidCredentials("invalid or expired email session") from None

    def verify_signature(self, token: str, *, recent: bool = False) -> EmailIdentity:
        claims = self._open(token, recent=recent)
        return EmailIdentity(self.auth_url, claims["uid"], claims["email"], claims["auth_time"], claims["exp"])

    def verify(self, token: str, *, recent: bool = False) -> EmailIdentity:
        claims = self._open(token, recent=recent)
        user, _ = self._current(claims["cookie"])
        if user["id"] != claims["uid"] or user["email"].strip().casefold() != claims["email"]:
            raise InvalidCredentials("invalid or expired email session")
        return EmailIdentity(self.auth_url, claims["uid"], claims["email"], claims["auth_time"], claims["exp"])

    def register(self, name: str, email: str, password: str) -> dict:
        result, _ = self._request("/sign-up/email", {"name": name, "email": email, "password": password})
        if not isinstance(result, dict) or not isinstance(result.get("user"), dict):
            raise EmailAuthUnavailable("email provider did not confirm account creation")
        # Neon must have Verify at Sign-up enabled. It sends the OTP as part of signup;
        # immediately sending another can invalidate the first code or hit its cooldown.
        # Refuse a branch that auto-signs-in before verification instead of silently trusting it.
        if result.get("token") is not None or result["user"].get("emailVerified") is not False:
            raise EmailProviderError("Account created, but email verification is not configured correctly.",
                                     "VERIFICATION_CONFIGURATION_REQUIRED", 503, account_created=True)
        return {"email": email, "verificationSent": True}

    def resend(self, email: str) -> dict:
        result, _ = self._request("/email-otp/send-verification-otp", {"email": email, "type": "email-verification"})
        if not isinstance(result, dict) or result.get("success") is not True:
            raise EmailAuthUnavailable("email provider did not confirm the verification request")
        return {"email": email, "verificationSent": True}

    def verify_email(self, email: str, otp: str) -> dict:
        result, _ = self._request("/email-otp/verify-email", {"email": email, "otp": otp})
        if not isinstance(result, dict) or result.get("status") is not True:
            raise EmailAuthUnavailable("email provider did not confirm verification")
        # Ignore optional auto-login cookies: a password login is required to access Vuga.
        return {"email": email, "verified": True}

    def request_reset(self, email: str) -> dict:
        result, _ = self._request("/email-otp/request-password-reset", {"email": email})
        if not isinstance(result, dict) or result.get("success") is not True:
            raise EmailAuthUnavailable("email provider did not confirm the reset request")
        return {"sent": True}

    def reset_password(self, email: str, otp: str, password: str) -> dict:
        result, _ = self._request("/email-otp/reset-password", {"email": email, "otp": otp, "password": password})
        if not isinstance(result, dict) or result.get("success") is not True:
            raise EmailAuthUnavailable("email provider did not confirm password reset")
        try:
            return self.finish_reset(email, password)
        except (EmailAuthUnavailable, EmailProviderError, InvalidCredentials):
            raise EmailProviderError("Password changed; use the new password to finish ending earlier sessions.",
                                     "PASSWORD_RESET_COMPLETED", 503, password_reset=True) from None

    def finish_reset(self, email: str, password: str) -> dict:
        # Neon Revoke sessions on password reset must be enabled. Also verify explicit
        # revocation here; a transient failure is retried using the new password, not a used OTP.
        _, headers = self._request("/sign-in/email", {"email": email, "password": password, "rememberMe": False})
        result, _ = self._request("/revoke-sessions", {}, cookie=self._cookie(headers))
        if not isinstance(result, dict) or result.get("status") is not True:
            raise EmailAuthUnavailable("session revocation was not confirmed")
        return {"reset": True}

    def signout(self, token: str) -> None:
        claims = self._open(token)
        result, _ = self._request("/sign-out", {}, cookie=claims["cookie"])
        if not isinstance(result, dict) or result.get("success") is not True:
            raise EmailAuthUnavailable("email sign-out was not confirmed")

    def ensure_deletion_available(self) -> None:
        self._require_configuration()
        if not self.delete_enabled:
            raise EmailAuthUnavailable("Neon account deletion has not been enabled; no account data was deleted")

    def delete(self, token: str) -> None:
        self.ensure_deletion_available()
        claims = self._open(token, recent=True)
        result, _ = self._request("/delete-user", {}, cookie=claims["cookie"])
        if not isinstance(result, dict) or result.get("success") is not True or result.get("message") != "User deleted":
            raise EmailAuthUnavailable("email account deletion is not confirmed; provider cleanup is still pending")


neon_auth = NeonAuth(settings.neon_auth_url, settings.neon_auth_origin, settings.jwt_secret,
                     delete_enabled=settings.neon_delete_enabled,
                     session_seconds=settings.jwt_expire_minutes * 60)
