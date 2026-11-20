"""Composition root: builds the FastAPI app, wires routers, services and error mapping."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .db import SessionLocal, engine
from .migrations import migrate_email_accounts
from .routers import auth, backup, health, predict, profiles, symbols, sync
from .services import (
    Conflict,
    InvalidCode,
    InvalidCredentials,
    InvalidInput,
    ModelRegistry,
    NotFound,
    NotOwned,
    RetryLater,
    ServiceError,
    SmsFailed,
    SmsUnavailable,
    StaleBackup,
    SymbolCatalogue,
    TooLarge,
    TooManyCodes,
    TooManyTries,
    create_sms_sender,
)
from .services.errors import (
    EmailAuthUnavailable,
    EmailDeletionPending,
    EmailNotVerified,
    EmailProviderError,
)

# Starlette renamed the 422 and 413 constants; fall back for older releases.
_UNPROCESSABLE = getattr(status, "HTTP_422_UNPROCESSABLE_CONTENT", 422)
TOO_LARGE = getattr(status, "HTTP_413_CONTENT_TOO_LARGE", 413)
_STATUS_BY_ERROR = {
    EmailAuthUnavailable: status.HTTP_503_SERVICE_UNAVAILABLE,
    EmailDeletionPending: status.HTTP_503_SERVICE_UNAVAILABLE,
    EmailNotVerified: status.HTTP_403_FORBIDDEN,
    InvalidCode: status.HTTP_400_BAD_REQUEST,
    InvalidCredentials: status.HTTP_401_UNAUTHORIZED,
    NotOwned: status.HTTP_403_FORBIDDEN,
    NotFound: status.HTTP_404_NOT_FOUND,
    Conflict: status.HTTP_409_CONFLICT,
    StaleBackup: status.HTTP_409_CONFLICT,
    InvalidInput: _UNPROCESSABLE,
    TooLarge: TOO_LARGE,
    TooManyCodes: status.HTTP_429_TOO_MANY_REQUESTS,
    TooManyTries: status.HTTP_429_TOO_MANY_REQUESTS,
    SmsFailed: status.HTTP_502_BAD_GATEWAY,
    SmsUnavailable: status.HTTP_503_SERVICE_UNAVAILABLE,
}
# Where the texted codes go, said once at startup so the host's log shows it; never the key.
_SMS_DELIVERY = {
    "sms": "SMS codes go to phones through Africa's Talking.",
    "simulator": "SMS codes go to Africa's Talking's sandbox simulator, not to phones.",
    "log": "SMS codes are written to this server's log (local development only).",
    "off": "SMS is not set up: requests for codes are refused (503).",
}

model_registry = ModelRegistry(settings.model_dir, settings.default_model)
sms = create_sms_sender(username=settings.africastalking_username,
                        api_key=settings.africastalking_api_key if settings.email_auth_provider != "neon" else None,
                        sender_id=settings.africastalking_sender_id,
                        log_enabled=settings.sms_log_enabled and settings.email_auth_provider != "neon")


def load_model():
    """Model provider behind /health and /predict (tests replace it)."""
    return model_registry.get()


@asynccontextmanager
async def lifespan(_: FastAPI):
    logging.getLogger("app.services.sms").warning(_SMS_DELIVERY[sms.delivery])
    migrate_email_accounts(engine)
    with SessionLocal() as db:
        SymbolCatalogue(db).import_csv()
    yield


app = FastAPI(title="Vuga AAC API", version="1.0.0", lifespan=lifespan,
              description="Kinyarwanda-first predictive picture-to-speech: "
                          "profiles, vocabulary, sync, prediction")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def private_auth_responses(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/auth/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, error: RequestValidationError):
    if request.url.path.startswith("/auth/neon/"):
        # FastAPI normally includes invalid input values. Passwords/codes must not be reflected.
        issues = [{key: issue[key] for key in ("loc", "msg", "type") if key in issue}
                  for issue in error.errors()]
        return JSONResponse({"detail": issues}, status_code=422, headers={"Cache-Control": "no-store"})
    return await request_validation_exception_handler(request, error)


@app.exception_handler(ServiceError)
async def service_error(request: Request, error: ServiceError) -> JSONResponse:
    if isinstance(error, EmailProviderError):
        body = {"detail": error.detail, "code": error.code}
        if error.account_created:
            body["accountCreated"] = True
        if error.password_reset:
            body["passwordReset"] = True
        if error.status == 429:
            body["retry_after"] = 60
        return JSONResponse(body, status_code=error.status, headers={"Cache-Control": "no-store"})
    code = _STATUS_BY_ERROR.get(type(error), status.HTTP_400_BAD_REQUEST)
    if isinstance(error, EmailNotVerified):
        return JSONResponse({"detail": error.detail, "code": "EMAIL_NOT_VERIFIED"}, status_code=code)
    if isinstance(error, InvalidCredentials) and request.url.path.startswith("/auth/neon/"):
        provider_code = "INVALID_EMAIL_OR_PASSWORD" if request.url.path == "/auth/neon/login" else "INVALID_SESSION"
        return JSONResponse({"detail": error.detail, "code": provider_code}, status_code=code)
    if isinstance(error, RetryLater):
        # In the body as well, because a browser app cannot read Retry-After across origins.
        body = {"detail": error.detail, "retry_after": error.retry_after}
        if isinstance(error, TooManyCodes):
            body["reason"] = error.reason
        return JSONResponse(body, status_code=code, headers={"Retry-After": str(error.retry_after)})
    if isinstance(error, InvalidCode):
        return JSONResponse({"detail": error.detail, "reason": error.reason,
                             "attempts_left": error.attempts_left}, status_code=code)
    if isinstance(error, StaleBackup):
        return JSONResponse({"detail": error.detail, "revision": error.revision,
                             "saved_at": error.saved_at.isoformat() if error.saved_at else None},
                            status_code=code)
    return JSONResponse({"detail": error.detail}, status_code=code)


for module in (health, auth, symbols, profiles, sync, predict, backup):
    app.include_router(module.router)
