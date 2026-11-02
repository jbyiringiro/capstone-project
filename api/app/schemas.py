from __future__ import annotations

import re
from itertools import pairwise
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

Role = Literal["teacher", "caregiver", "administrator"]
ActionType = Literal["select", "navigate", "correct", "speak"]
BoardMode = Literal["static", "predictive"]
CodePurpose = Literal["register", "reset"]

# A Rwandan mobile number (MTN 078 and 079, Airtel 072 and 073) in any usual spelling. It is kept
# as +2507XXXXXXXX, the form SMS services take, so 0788 123 456 and +250 788 123 456 are one account.
_RWANDAN_MOBILE = re.compile(r"7[2389]\d{7}")


def normalise_phone(value: str) -> str:
    digits = re.sub(r"[\s().-]", "", value)
    for prefix in ("+250", "00250", "250", "0"):
        if digits.startswith(prefix) and len(digits) == len(prefix) + 9:
            digits = digits[len(prefix):]
            break
    if not _RWANDAN_MOBILE.fullmatch(digits):
        raise ValueError("phone must be a Rwandan mobile number, such as 0788 123 456")
    return f"+250{digits}"


MobileNumber = Annotated[str, Field(max_length=32), AfterValidator(normalise_phone)]
# One PIN of four to six digits opens the caregiver area on each device and signs in to the
# account; five wrong tries lock the number for a while (services/accounts.py).
Pin = Annotated[str, Field(pattern=r"^\d{4,6}$")]
SmsCode = Annotated[str, Field(pattern=r"^\d{6}$")]


class CodeRequest(BaseModel):
    phone: MobileNumber
    purpose: CodePurpose


class CodeSent(BaseModel):
    resend_after: int  # seconds before another code may be asked for
    expires_in: int  # seconds the code works


class UserCreate(BaseModel):
    name: str = Field(default="", max_length=120)  # optional: the number identifies the account
    phone: MobileNumber
    code: SmsCode  # texted to `phone`: the caregiver holds the number
    # Privileged accounts must be provisioned by the deployment operator.
    role: Literal["teacher", "caregiver"] = "teacher"
    pin: Pin

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value


class PinReset(BaseModel):
    """A forgotten PIN replaced with the code texted to the number."""

    phone: MobileNumber
    code: SmsCode
    pin: Pin


class PinChange(BaseModel):
    phone: MobileNumber
    pin: str = Field(max_length=72)  # the current PIN, checked like a sign-in
    new_pin: Pin


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
        if any(later < earlier for earlier, later in pairwise(timestamps)):
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


# The account copy of a device (NFR4: no child names or media on the server). Unknown fields are
# refused, so custom-word photos, voice recordings and messages cannot be stored with it, and a
# child appears only by a pseudonymous code: a child the family calls by name stays on the device.
PSEUDONYM = r"^[A-Z]-\d{2,3}$"
BackupFormat = Literal["vuga-account-backup-v2"]
_BACKED_UP_SETTING = re.compile(r"(appearance|vocabulary):[\w-]{1,64}|mode|profile|speech-mode")


class BackupProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile_id: str = Field(min_length=1, max_length=64)
    code: str = Field(pattern=PSEUDONYM)
    age_band: str | None = Field(default=None, max_length=16)
    access_method: str | None = Field(default=None, max_length=16)
    local_only: bool | None = None


class BackupWord(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile_id: str = Field(min_length=1, max_length=64)
    key: str = Field(min_length=1, max_length=48)


class BackupSetting(BaseModel):
    """A board, place, next-word or child-mode setting, a word-list flag, the board mode, the open
    child or the speech choice."""

    model_config = ConfigDict(extra="forbid")
    key: str = Field(max_length=80)
    value: Any = None

    @model_validator(mode="after")
    def backed_up_and_pseudonymous(self):
        if not _BACKED_UP_SETTING.fullmatch(self.key):
            raise ValueError("this setting is not kept on the account")
        code = self.value.get("code") if isinstance(self.value, dict) else None
        if self.key == "profile" and self.value is not None and not re.fullmatch(PSEUDONYM, str(code)):
            raise ValueError("the open child must go by a code such as P-01")
        return self


class BackupData(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profiles: list[BackupProfile] = Field(max_length=200)
    vocabulary: list[BackupWord] = Field(max_length=20_000)
    settings: list[BackupSetting] = Field(max_length=2_000)


class BackupIn(BaseModel):
    """A caregiver's device set-up, written by the app and returned to it unchanged."""

    format: BackupFormat
    # The revision of the account copy this device last saved or received; 0 before the first.
    base_revision: int = Field(ge=0)
    data: BackupData


class BackupStatus(BaseModel):
    saved_at: AwareDatetime | None
    size: int = 0
    revision: int = 0  # saves so far; 0 while the account has no copy


class BackupOut(BaseModel):
    format: BackupFormat
    saved_at: AwareDatetime
    revision: int
    data: BackupData
