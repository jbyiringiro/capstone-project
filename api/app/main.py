from __future__ import annotations

import csv
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models, schemas
from .config import settings
from .db import Base, SessionLocal, engine, get_db
from .prediction import load_model
from .security import create_token, current_user, hash_password, require_role, verify_password

@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        _import_symbols(db)
    yield


app = FastAPI(title="Vuga AAC API", version="0.1.0", lifespan=lifespan,
              description="Kinyarwanda-first predictive picture-to-speech: profiles, vocabulary, sync, prediction")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model_loaded": load_model() is not None}


# ---- auth (FR1) ---------------------------------------------------------------------------
@app.post("/auth/register", response_model=schemas.UserOut, status_code=201)
def register(body: schemas.UserCreate, db: Session = Depends(get_db)):
    if db.scalar(select(models.User).where(models.User.phone == body.phone)):
        raise HTTPException(status.HTTP_409_CONFLICT, "phone already registered")
    user = models.User(name=body.name, phone=body.phone, role=body.role,
                       password_hash=hash_password(body.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "phone already registered")
    db.refresh(user)
    return user


@app.post("/auth/login", response_model=schemas.Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.scalar(select(models.User).where(models.User.phone == form.username))
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "wrong phone or password")
    return schemas.Token(access_token=create_token(user))


# ---- symbols and vocabulary (FR2, FR3) --------------------------------------------------------
@app.get("/symbols", response_model=list[schemas.SymbolOut])
def list_symbols(db: Session = Depends(get_db)):
    return db.scalars(select(models.Symbol).order_by(models.Symbol.category, models.Symbol.key)).all()


@app.post("/symbols/import", status_code=201, dependencies=[Depends(require_role("administrator"))])
def import_symbols(db: Session = Depends(get_db)):
    """Load vocab/symbols.csv (idempotent by key)."""
    return {"added": _import_symbols(db)}


def _import_symbols(db: Session) -> int:
    """Seed the shipped catalogue so a new install has usable vocabulary."""
    path = Path(__file__).resolve().parents[2] / "vocab" / "symbols.csv"
    existing = set(db.scalars(select(models.Symbol.key)).all())
    added = 0
    with open(path, encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            if row["symbol_id"] in existing:
                continue
            db.add(models.Symbol(key=row["symbol_id"], label_rw=row["label_rw"], label_en=row["label_en"],
                                 category=row["category"],
                                 arasaac_id=int(row["arasaac_id"]) if row["arasaac_id"] else None,
                                 image_path=row["image_path"] or None))
            added += 1
            existing.add(row["symbol_id"])
    db.commit()
    return added


@app.post("/profiles", response_model=schemas.ProfileOut, status_code=201)
def create_profile(body: schemas.ProfileCreate, db: Session = Depends(get_db),
                   user: models.User = Depends(current_user)):
    if db.scalar(select(models.ChildProfile).where(models.ChildProfile.code == body.code)):
        raise HTTPException(status.HTTP_409_CONFLICT, "code already used")
    prof = models.ChildProfile(code=body.code, age_band=body.age_band,
                               access_method=body.access_method, created_by=user.user_id)
    db.add(prof); db.commit(); db.refresh(prof)
    return prof


@app.get("/profiles", response_model=list[schemas.ProfileOut])
def list_profiles(db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    return db.scalars(select(models.ChildProfile).where(models.ChildProfile.created_by == user.user_id)).all()


@app.put("/profiles/{profile_id}/vocabulary")
def set_vocabulary(profile_id: str, body: schemas.VocabularyUpdate, db: Session = Depends(get_db),
                   user: models.User = Depends(current_user)):
    prof = db.get(models.ChildProfile, profile_id)
    if not prof or prof.created_by != user.user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "profile not found")
    requested = set(body.symbol_ids)
    known = set(db.scalars(select(models.Symbol.symbol_id).where(
        models.Symbol.symbol_id.in_(requested)
    )).all())
    if requested != known:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "unknown symbol IDs")
    current = {pv.symbol_id for pv in prof.vocabulary}
    for pv in list(prof.vocabulary):
        if pv.symbol_id not in requested:
            db.delete(pv)
    for sid in requested - current:
        db.add(models.ProfileVocabulary(profile_id=profile_id, symbol_id=sid))
    db.commit()
    return {"profile_id": profile_id, "enabled": len(body.symbol_ids)}


@app.get("/profiles/{profile_id}/vocabulary", response_model=list[schemas.SymbolOut])
def get_vocabulary(profile_id: str, db: Session = Depends(get_db),
                   user: models.User = Depends(current_user)):
    prof = db.get(models.ChildProfile, profile_id)
    if not prof or prof.created_by != user.user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "profile not found")
    return [pv.symbol for pv in prof.vocabulary]


# ---- sync of messages and all-action tap events (FR7) ----------------------------------------
def _utc(value: datetime | None) -> datetime | None:
    """Store and compare UTC consistently with SQLite's timezone-naive DateTime."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _duration(message: schemas.MessageIn) -> int | None:
    if message.spoken_at is None or not message.events:
        return None
    events = sorted(message.events, key=lambda event: event.action_index)
    # Measure composition until the Speak tap, excluding audio playback latency.
    return round((events[-1].ts - events[0].ts).total_seconds() * 1000)


def _same_upload(stored: models.Message, incoming: schemas.MessageIn, keys: dict) -> bool:
    if (stored.profile_id, stored.started_at, stored.spoken_at, stored.tap_count,
            stored.duration_ms, stored.board_mode) != (
            incoming.profile_id, _utc(incoming.started_at), _utc(incoming.spoken_at),
            incoming.tap_count, _duration(incoming), incoming.board_mode):
        return False
    stored_events = {
        (e.event_id, e.action_index, e.action_type, e.symbol_id, e.was_suggested, e.context, e.ts)
        for e in stored.events
    }
    incoming_events = {
        (e.event_id, e.action_index, e.action_type, keys.get(e.symbol_key), e.was_suggested,
         e.context, _utc(e.ts)) for e in incoming.events
    }
    return stored_events == incoming_events


@app.post("/sync", response_model=schemas.SyncResult)
def sync(body: schemas.SyncRequest, db: Session = Depends(get_db),
         user: models.User = Depends(current_user)):
    keys = {s.key: s.symbol_id for s in db.scalars(select(models.Symbol)).all()}
    pending = []
    dup = 0
    dev = None
    # Validate every object before writing any of the batch.
    if body.device_id:
        dev = db.get(models.Device, body.device_id)
        device_profile = db.get(models.ChildProfile, dev.profile_id) if dev else None
        if not device_profile or device_profile.created_by != user.user_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "device not found")
    for m in body.messages:
        prof = db.get(models.ChildProfile, m.profile_id)
        if not prof or prof.created_by != user.user_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"profile {m.profile_id} not owned")
        for e in m.events:
            if e.symbol_key is not None and e.symbol_key not in keys:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "unknown symbol key")
        existing = db.get(models.Message, m.message_id)
        if existing:
            if not _same_upload(existing, m, keys):
                raise HTTPException(status.HTTP_409_CONFLICT, "message ID already used")
            dup += 1
            continue
        event_ids = [e.event_id for e in m.events]
        if event_ids and db.scalar(select(models.TapEvent.event_id).where(
                models.TapEvent.event_id.in_(event_ids)).limit(1)):
            raise HTTPException(status.HTTP_409_CONFLICT, "event ID already used")
        pending.append(m)

    acc_e = 0
    for m in pending:
        msg = models.Message(message_id=m.message_id, profile_id=m.profile_id,
                             started_at=_utc(m.started_at), spoken_at=_utc(m.spoken_at),
                             tap_count=len(m.events), duration_ms=_duration(m),
                             board_mode=m.board_mode)
        db.add(msg)
        for e in m.events:
            db.add(models.TapEvent(event_id=e.event_id, message_id=m.message_id,
                                   symbol_id=keys.get(e.symbol_key) if e.symbol_key else None,
                                   action_index=e.action_index, action_type=e.action_type,
                                   was_suggested=e.was_suggested, context=e.context, ts=_utc(e.ts)))
            acc_e += 1
    if dev:
        dev.last_sync = _utc(datetime.now(timezone.utc))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "sync IDs conflict; refresh and retry")
    return schemas.SyncResult(accepted_messages=len(pending), accepted_events=acc_e, duplicates=dup)


# ---- dashboard summary (FR8): frequency of selections separately from all-action taps ----------
@app.get("/profiles/{profile_id}/summary")
def summary(profile_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    prof = db.get(models.ChildProfile, profile_id)
    if not prof or prof.created_by != user.user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "profile not found")
    keys = {s.symbol_id: s.key for s in db.scalars(select(models.Symbol)).all()}
    freq: dict[str, int] = {}
    per_mode: dict[str, dict] = {}
    for m in prof.messages:
        if m.spoken_at is None:
            continue
        pm = per_mode.setdefault(m.board_mode, {"messages": 0, "taps": 0, "duration_ms": 0})
        pm["messages"] += 1; pm["taps"] += m.tap_count; pm["duration_ms"] += m.duration_ms or 0
        for e in m.events:
            if e.action_type == "select" and e.symbol_id is not None:
                k = keys.get(e.symbol_id, str(e.symbol_id))
                freq[k] = freq.get(k, 0) + 1
    for pm in per_mode.values():
        n = pm["messages"] or 1
        pm["taps_per_message"] = pm["taps"] / n
        pm["seconds_per_message"] = pm["duration_ms"] / n / 1000
    return {"profile": prof.code, "symbol_frequency": dict(sorted(freq.items(), key=lambda kv: -kv[1])),
            "by_board_mode": per_mode}


# ---- prediction ------------------------------------------------------------------------------
@app.post("/predict", response_model=schemas.PredictResponse)
def predict(body: schemas.PredictRequest):
    model = load_model()
    if model is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "no model artefact available")
    allowed = set(body.allowed) if body.allowed is not None else None
    return schemas.PredictResponse(suggestions=model.top_k(tuple(body.prefix), body.k, allowed),
                                   model=model.name)
