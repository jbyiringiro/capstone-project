from __future__ import annotations

import csv
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models, schemas
from .config import settings
from .db import Base, engine, get_db
from .prediction import load_model
from .security import create_token, current_user, hash_password, require_role, verify_password

@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
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
    db.add(user); db.commit(); db.refresh(user)
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
    path = Path(__file__).resolve().parents[2] / "vocab" / "symbols.csv"
    added = 0
    with open(path, encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            if db.scalar(select(models.Symbol).where(models.Symbol.key == row["symbol_id"])):
                continue
            db.add(models.Symbol(key=row["symbol_id"], label_rw=row["label_rw"], label_en=row["label_en"],
                                 category=row["category"],
                                 arasaac_id=int(row["arasaac_id"]) if row["arasaac_id"] else None,
                                 image_path=row["image_path"] or None))
            added += 1
    db.commit()
    return {"added": added}


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
    for pv in list(prof.vocabulary):
        db.delete(pv)
    for sid in body.symbol_ids:
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
@app.post("/sync", response_model=schemas.SyncResult)
def sync(body: schemas.SyncRequest, db: Session = Depends(get_db),
         user: models.User = Depends(current_user)):
    keys = {s.key: s.symbol_id for s in db.scalars(select(models.Symbol)).all()}
    acc_m = acc_e = dup = 0
    for m in body.messages:
        prof = db.get(models.ChildProfile, m.profile_id)
        if not prof or prof.created_by != user.user_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"profile {m.profile_id} not owned")
        if db.get(models.Message, m.message_id):
            dup += 1
            continue
        msg = models.Message(message_id=m.message_id, profile_id=m.profile_id, started_at=m.started_at,
                             spoken_at=m.spoken_at, tap_count=m.tap_count, duration_ms=m.duration_ms,
                             board_mode=m.board_mode)
        db.add(msg); acc_m += 1
        for e in m.events:
            if e.action_type == "select" and e.symbol_key is None:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                    "select events require symbol_key")
            db.add(models.TapEvent(event_id=e.event_id, message_id=m.message_id,
                                   symbol_id=keys.get(e.symbol_key) if e.symbol_key else None,
                                   action_index=e.action_index, action_type=e.action_type,
                                   was_suggested=e.was_suggested, context=e.context, ts=e.ts))
            acc_e += 1
    if body.device_id:
        dev = db.get(models.Device, body.device_id)
        if dev:
            from datetime import datetime, timezone
            dev.last_sync = datetime.now(timezone.utc)
    db.commit()
    return schemas.SyncResult(accepted_messages=acc_m, accepted_events=acc_e, duplicates=dup)


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
    allowed = set(body.allowed) if body.allowed else None
    return schemas.PredictResponse(suggestions=model.top_k(tuple(body.prefix), body.k, allowed),
                                   model=model.name)
