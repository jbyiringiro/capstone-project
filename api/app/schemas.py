from __future__ import annotations

from typing import Literal

from pydantic import AwareDatetime, BaseModel, Field, field_validator, model_validator

Role = Literal["teacher", "caregiver", "administrator"]
ActionType = Literal["select", "navigate", "correct", "speak"]
BoardMode = Literal["static", "predictive"]


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=1, max_length=32)
    # Privileged accounts must be provisioned by the deployment operator.
    role: Literal["teacher", "caregiver"] = "teacher"
    password: str = Field(min_length=6)

    @field_validator("name", "phone", mode="before")
    @classmethod
    def trim_identity(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("password")
    @classmethod
    def bcrypt_length(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("password must be at most 72 UTF-8 bytes")
        return value


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

    @field_validator("symbol_ids")
    @classmethod
    def unique_symbols(cls, value: list[int]) -> list[int]:
        if len(value) != len(set(value)):
            raise ValueError("symbol_ids must be unique")
        if any(sid <= 0 for sid in value):
            raise ValueError("symbol_ids must be positive")
        return value


class TapEventIn(BaseModel):
    event_id: str = Field(min_length=1, max_length=36)
    action_index: int = Field(ge=0)
    action_type: ActionType
    symbol_key: str | None = Field(default=None, max_length=48)
    was_suggested: bool = False
    context: str | None = Field(default=None, max_length=255)
    ts: AwareDatetime

    @model_validator(mode="after")
    def valid_selection(self):
        if self.action_type == "select" and not self.symbol_key:
            raise ValueError("select events require symbol_key")
        if self.action_type != "select" and (self.symbol_key or self.was_suggested):
            raise ValueError("only select events may carry symbols or suggestions")
        return self


class MessageIn(BaseModel):
    message_id: str = Field(min_length=1, max_length=36)
    profile_id: str = Field(min_length=1, max_length=36)
    started_at: AwareDatetime
    spoken_at: AwareDatetime | None
    tap_count: int = Field(ge=0)
    duration_ms: int | None = Field(ge=0)
    board_mode: BoardMode
    events: list[TapEventIn] = Field(default_factory=list)

    @model_validator(mode="after")
    def valid_action_log(self):
        ordered = sorted(self.events, key=lambda event: event.action_index)
        if [e.action_index for e in ordered] != list(range(len(ordered))):
            raise ValueError("action indices must be unique and contiguous from zero")
        if len({e.event_id for e in ordered}) != len(ordered):
            raise ValueError("event IDs must be unique")
        if self.tap_count != len(ordered):
            raise ValueError("tap_count must include every logged action")
        timestamps = [self.started_at, *(e.ts for e in ordered)]
        if self.spoken_at is not None:
            timestamps.append(self.spoken_at)
            if not ordered or ordered[-1].action_type != "speak":
                raise ValueError("completed messages require a final speak action")
            if sum(e.action_type == "speak" for e in ordered) != 1:
                raise ValueError("completed messages require exactly one speak action")
        elif any(e.action_type == "speak" for e in ordered):
            raise ValueError("draft messages cannot contain a speak action")
        if any(later < earlier for earlier, later in zip(timestamps, timestamps[1:])):
            raise ValueError("message and event timestamps must be chronological")
        return self


class SyncRequest(BaseModel):
    """Upload sent only after an authorised adult presses Sync while online (FR7)."""

    device_id: str | None = None
    messages: list[MessageIn] = Field(max_length=1000)

    @model_validator(mode="after")
    def unique_ids(self):
        message_ids = [m.message_id for m in self.messages]
        event_ids = [e.event_id for m in self.messages for e in m.events]
        if len(message_ids) != len(set(message_ids)):
            raise ValueError("message IDs must be unique within a sync batch")
        if len(event_ids) != len(set(event_ids)):
            raise ValueError("event IDs must be unique within a sync batch")
        return self


class SyncResult(BaseModel):
    accepted_messages: int
    accepted_events: int
    duplicates: int


class PredictRequest(BaseModel):
    prefix: list[str]
    allowed: list[str] | None = None
    k: int = Field(default=3, ge=1, le=20)


class PredictResponse(BaseModel):
    suggestions: list[str]
    model: str
