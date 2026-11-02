"""Composition root: builds the FastAPI app, wires routers, services and error mapping."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .db import Base, SessionLocal, engine
from .routers import auth, backup, health, predict, profiles, symbols, sync
from .services import (
    AfricasTalkingSms,
    Conflict,
    InvalidCode,
    InvalidCredentials,
    InvalidInput,
    LogSms,
    ModelRegistry,
    NotFound,
    NotOwned,
    RetryLater,
    ServiceError,
    SmsFailed,
    SymbolCatalogue,
    TooLarge,
    TooManyCodes,
    TooManyTries,
)

# Starlette renamed the 422 and 413 constants; fall back for older releases.
_UNPROCESSABLE = getattr(status, "HTTP_422_UNPROCESSABLE_CONTENT", 422)
TOO_LARGE = getattr(status, "HTTP_413_CONTENT_TOO_LARGE", 413)
_STATUS_BY_ERROR = {
    InvalidCode: status.HTTP_400_BAD_REQUEST,
    InvalidCredentials: status.HTTP_401_UNAUTHORIZED,
    NotOwned: status.HTTP_403_FORBIDDEN,
    NotFound: status.HTTP_404_NOT_FOUND,
    Conflict: status.HTTP_409_CONFLICT,
    InvalidInput: _UNPROCESSABLE,
    TooLarge: TOO_LARGE,
    TooManyCodes: status.HTTP_429_TOO_MANY_REQUESTS,
    TooManyTries: status.HTTP_429_TOO_MANY_REQUESTS,
    SmsFailed: status.HTTP_502_BAD_GATEWAY,
}

model_registry = ModelRegistry(settings.model_dir, settings.default_model)
sms = (AfricasTalkingSms(settings.africastalking_username, settings.africastalking_api_key,
                         settings.africastalking_sender_id)
       if settings.africastalking_api_key else LogSms())


def load_model():
    """Model provider behind /health and /predict (tests replace it)."""
    return model_registry.get()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        SymbolCatalogue(db).import_csv()
    yield


app = FastAPI(title="Vuga AAC API", version="1.0.0", lifespan=lifespan,
              description="Kinyarwanda-first predictive picture-to-speech: "
                          "profiles, vocabulary, sync, prediction")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(ServiceError)
async def service_error(_: Request, error: ServiceError) -> JSONResponse:
    code = _STATUS_BY_ERROR.get(type(error), status.HTTP_400_BAD_REQUEST)
    if isinstance(error, RetryLater):
        # In the body as well, because a browser app cannot read Retry-After across origins.
        return JSONResponse({"detail": error.detail, "retry_after": error.retry_after},
                            status_code=code, headers={"Retry-After": str(error.retry_after)})
    return JSONResponse({"detail": error.detail}, status_code=code)


for module in (health, auth, symbols, profiles, sync, predict, backup):
    app.include_router(module.router)
