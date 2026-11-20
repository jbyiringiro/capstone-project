from __future__ import annotations

import re
import unicodedata
from itertools import pairwise
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    ValidationError,
    field_validator,
    model_validator,
)

Role = Literal["teacher", "caregiver", "administrator"]
ActionType = Literal["select", "navigate", "correct", "speak"]
BoardMode = Literal["static", "predictive"]
CodePurpose = Literal["register", "reset"]
SmsDelivery = Literal["sms", "simulator", "log"]

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
    # Where the code went: a phone (`sms`), the provider's sandbox simulator, or the server's log
    # in local development. The provider taking the text does not yet mean the phone received it.
    delivery: SmsDelivery


NAME_MAX = 120  # users.name


def _caregiver_name(value: str) -> str:
    """The adult's own name, in any script, with its spaces tidied: required, at most 120
    characters, and no control characters."""
    name = " ".join(value.split())
    if not name:
        raise ValueError("name is required")
    if len(name) > NAME_MAX:
        raise ValueError(f"name must be at most {NAME_MAX} characters")
    if any(unicodedata.category(character) == "Cc" for character in name):
        raise ValueError("name must not contain control characters")
    return name


# The caregiver who opens the account, not a child: children go by codes on the server.
CaregiverName = Annotated[str, Field(max_length=2 * NAME_MAX), AfterValidator(_caregiver_name)]


class UserCreate(BaseModel):
    name: CaregiverName
    phone: MobileNumber
    code: SmsCode  # texted to `phone`: the caregiver holds the number
    # Privileged accounts must be provisioned by the deployment operator.
    role: Literal["teacher", "caregiver"] = "teacher"
    pin: Pin


class PinReset(BaseModel):
    """A forgotten PIN replaced with the code texted to the number."""

    phone: MobileNumber
    code: SmsCode
    pin: Pin


class PinChange(BaseModel):
    phone: MobileNumber
    pin: str = Field(max_length=72)  # the current PIN, checked like a sign-in
    new_pin: Pin


class AccountDelete(BaseModel):
    """Erasing the account, with its number and current PIN."""

    phone: MobileNumber
    pin: str = Field(max_length=72)  # checked like a sign-in


class UserOut(BaseModel):
    user_id: str
    name: str  # empty for accounts opened before a name was asked for
    phone: str | None
    email: str | None = None
    auth_provider: Literal["phone", "firebase", "neon"] = "phone"
    role: Role
    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class EmailSessionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id_token: str = Field(min_length=1, max_length=16384)
    name: CaregiverName | None = None


class EmailSessionOut(Token):
    user: UserOut


class EmailDelete(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id_token: str = Field(min_length=1, max_length=16384)
    user_id: str = Field(min_length=1, max_length=36)


def _email_address(value: str) -> str:
    email = value.strip().casefold()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise ValueError("a valid email address is required")
    return email


EmailAddress = Annotated[str, Field(min_length=3, max_length=254), AfterValidator(_email_address)]
EmailPassword = Annotated[str, Field(min_length=8, max_length=128,
                                    json_schema_extra={"format": "password", "writeOnly": True})]


class NeonEmailIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailAddress


class NeonLoginIn(NeonEmailIn):
    password: EmailPassword


class NeonRegisterIn(NeonLoginIn):
    name: CaregiverName


class NeonVerifyIn(NeonEmailIn):
    otp: str = Field(pattern=r"^\d{6}$")


class NeonResetIn(NeonVerifyIn):
    password: EmailPassword


class NeonSignoutIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id_token: str = Field(min_length=1, max_length=16384)


# An age or age band such as 7, 6-8 or 12+, and how the child reaches the screen. Neither can hold
# a name, so a profile can go into the account copy as it is.
AgeBand = Annotated[str, Field(pattern=r"^\d{1,2}(-\d{1,2}|\+)?$")]
AccessMethod = Literal["touch", "switch", "keyboard", "eye-gaze"]


class ProfileCreate(BaseModel):
    code: str = Field(pattern=r"^[A-Z]-\d{2,3}$", description="pseudonymous code such as P-07")
    age_band: AgeBand | None = None
    access_method: AccessMethod = "touch"


class ProfileUpdate(BaseModel):
    """A child's new code or age band; what is left out stays as it is. The id stays, so the
    child's words and synced messages stay theirs."""

    model_config = ConfigDict(extra="forbid")
    code: str | None = Field(default=None, pattern=r"^[A-Z]-\d{2,3}$")
    age_band: AgeBand | None = None

    @model_validator(mode="after")
    def code_is_never_cleared(self):
        if "code" in self.model_fields_set and self.code is None:
            raise ValueError("a child keeps a code")
        return self


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


# The account copy of a device (NFR4: no child names or media on the server). Every field has the
# shape the app writes (app/src/storage/backup.js) and nothing else: a child goes by a pseudonymous
# code and a generated id, a word by its key, and a setting is a switch, a size, a short id or a list
# of words. Unknown fields and free text are refused, so custom-word names and photos, voice
# recordings, messages and a child the family calls by name stay on the device.
PSEUDONYM = r"^[A-Z]-\d{2,3}$"
BackupFormat = Literal["vuga-account-backup-v2"]
_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
# A child on the account (its uuid) or on one device only (local- and a uuid).
ProfileId = Annotated[str, Field(pattern=rf"^(local-)?{_UUID}$")]
# A catalogue word (WANT, THANK_YOU) or a custom word's generated id (CUSTOM-1A2B3C4D).
WordKey = Annotated[str, Field(pattern=r"^([A-Z][A-Z0-9_]{0,47}|CUSTOM-[0-9A-F]{8})$")]
# A place, a section, a ready-made board or the speech choice: meal, food_drink, essentials.
ChoiceId = Annotated[str, Field(pattern=r"^[a-z][a-z_]{0,31}$")]
_BACKED_UP_SETTING = re.compile(rf"(appearance:((local-)?{_UUID}|demo)|vocabulary:(local-)?{_UUID}|mode|profile"
                                r"|speech-mode)")


class BackupProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile_id: ProfileId
    code: str = Field(pattern=PSEUDONYM)
    age_band: AgeBand | None = None
    access_method: AccessMethod | None = None
    local_only: bool | None = None


class BackupWord(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile_id: ProfileId
    key: WordKey


class BoardSettings(BaseModel):
    """One child's board, place, next-word and child-mode settings (app/src/storage/
    board-preferences.js). Strict: a switch is true or false, never "yes"."""

    model_config = ConfigDict(extra="forbid", strict=True)
    motion: bool | None = None
    largeTiles: bool | None = None
    realisticImages: bool | None = None
    gridSize: Literal["auto", 4, 6, 9, 12, 20, 24, 40] | None = None
    personalSuggestions: bool | None = None
    sentenceSpeech: bool | None = None
    childMode: bool | None = None
    childPreset: ChoiceId | None = None
    childBoard: list[WordKey] | None = Field(default=None, max_length=12)
    relatedWords: bool | None = None
    relatedLists: dict[WordKey, Annotated[list[WordKey], Field(max_length=24)]] | None = Field(
        default=None, max_length=1_000)
    speakOnTap: bool | None = None
    environment: ChoiceId | None = None
    environmentLists: dict[ChoiceId, Annotated[list[WordKey], Field(max_length=80)]] | None = Field(
        default=None, max_length=32)
    section: ChoiceId | None = None
    sectionTabs: bool | None = None
    showLabels: bool | None = None
    swipePages: bool | None = None


# Each kept setting's value, by the part of its key before the colon.
_SETTING_VALUE = {
    "appearance": TypeAdapter(BoardSettings),
    "vocabulary": TypeAdapter(Literal[True]),  # the child's words were picked by hand
    "mode": TypeAdapter(Literal["static", "predictive"]),
    "profile": TypeAdapter(BackupProfile | None),  # the open child, if any
    "speech-mode": TypeAdapter(ChoiceId),
}


class BackupSetting(BaseModel):
    """A board, place, next-word or child-mode setting, a word-list flag, the board mode, the open
    child or the speech choice. The value is checked against its key's shape and kept as sent."""

    model_config = ConfigDict(extra="forbid")
    key: str = Field(max_length=80)
    value: Any = None

    @model_validator(mode="after")
    def backed_up_in_its_shape(self):
        if not _BACKED_UP_SETTING.fullmatch(self.key):
            raise ValueError("this setting is not kept on the account")
        try:
            _SETTING_VALUE[self.key.split(":")[0]].validate_python(self.value, strict=True)
        except ValidationError as error:
            problem = error.errors(include_url=False)[0]
            where = ".".join(str(part) for part in problem["loc"])
            raise ValueError(f"{self.key}{' ' + where if where else ''}: {problem['msg']}") from None
        return self


class BackupData(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profiles: list[BackupProfile] = Field(max_length=200)
    vocabulary: list[BackupWord] = Field(max_length=20_000)
    settings: list[BackupSetting] = Field(max_length=2_000)
    # Children the caregiver deleted, by id only. The account remembers them, so a copy saved
    # later from a device that still had one of them cannot bring it back (services/backups.py).
    deleted: list[ProfileId] | None = Field(default=None, max_length=1_000)


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
