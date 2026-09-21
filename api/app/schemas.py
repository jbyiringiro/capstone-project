from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Role = Literal["teacher", "caregiver", "administrator"]
ActionType = Literal["select", "navigate", "correct", "speak"]
BoardMode = Literal["static", "predictive"]


class UserCreate(BaseModel):
    name: str
    phone: str
    role: Role = "teacher"
    password: str = Field(min_length=6)


class UserOut(BaseModel):
    user_id: str
    name: str
    phone: str
    role: Role
    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ProfileCreate(BaseModel):
    code: str = Field(pattern=r"^[A-Z]-\d{2,3}$", description="pseudonymous code such as P-07")
    age_band: str | None = None
    access_method: str = "touch"


class ProfileOut(BaseModel):
    profile_id: str
    code: str
    age_band: str | None
    access_method: str
    model_config = {"from_attributes": True}


class SymbolOut(BaseModel):
    symbol_id: int
    key: str
    label_rw: str
    label_en: str | None
    category: str | None
    arasaac_id: int | None
    image_path: str | None
    model_config = {"from_attributes": True}


class VocabularyUpdate(BaseModel):
    symbol_ids: list[int]


class TapEventIn(BaseModel):
    event_id: str
    action_index: int
    action_type: ActionType
    symbol_key: str | None = None
    was_suggested: bool = False
    context: str | None = None
    ts: datetime


class MessageIn(BaseModel):
    message_id: str
    profile_id: str
    started_at: datetime
    spoken_at: datetime | None
    tap_count: int
    duration_ms: int | None
    board_mode: BoardMode
    events: list[TapEventIn] = []


class SyncRequest(BaseModel):
    """Upload sent only after an authorised adult presses Sync while online (FR7)."""

    device_id: str | None = None
    messages: list[MessageIn]


class SyncResult(BaseModel):
    accepted_messages: int
    accepted_events: int
    duplicates: int


class PredictRequest(BaseModel):
    prefix: list[str]
    allowed: list[str] | None = None
    k: int = 3


class PredictResponse(BaseModel):
    suggestions: list[str]
    model: str
