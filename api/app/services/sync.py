"""Upload of completed messages and their all-action tap logs (FR7).

A batch is validated as a whole before anything is written, so a rejected upload leaves the
server unchanged and the tablet keeps every message pending. Re-sending an identical message is
counted as a duplicate; re-using its ID for different content is a conflict.
"""
from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from .. import models, schemas
from .catalogue import SymbolCatalogue
from .errors import Conflict, InvalidInput, NotFound, NotOwned

# Keeps IN (...) lists well under SQLite's bound-parameter limit for a 1,000-message batch.
_IN_CHUNK = 900


def to_utc_naive(value: datetime | None) -> datetime | None:
    """Store and compare UTC consistently with SQLite's timezone-naive DateTime."""
    if value is None or value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def composition_ms(message: schemas.MessageIn) -> int | None:
    """Time from the first action to the Speak tap, excluding audio playback."""
    if message.spoken_at is None or not message.events:
        return None
    events = sorted(message.events, key=lambda event: event.action_index)
    return round((events[-1].ts - events[0].ts).total_seconds() * 1000)


def _chunks(values: list[str]) -> Iterator[list[str]]:
    for start in range(0, len(values), _IN_CHUNK):
        yield values[start:start + _IN_CHUNK]


@dataclass
class _Plan:
    new: list[schemas.MessageIn] = field(default_factory=list)
    duplicates: int = 0
    device: models.Device | None = None


class SyncService:
    def __init__(self, db: Session, user: models.User) -> None:
        self.db = db
        self.user = user

    def sync(self, body: schemas.SyncRequest) -> schemas.SyncResult:
        ids_by_key = SymbolCatalogue(self.db).ids_by_key()
        plan = self._plan(body, ids_by_key)
        events = self._write(plan, ids_by_key)
        return schemas.SyncResult(accepted_messages=len(plan.new), accepted_events=events,
                                  duplicates=plan.duplicates)

    # ---- validation: every check runs before the first write ------------------------------
    def _plan(self, body: schemas.SyncRequest, ids_by_key: dict[str, int]) -> _Plan:
        plan = _Plan(device=self._owned_device(body.device_id))
        owned = self._owned_profile_ids({m.profile_id for m in body.messages})
        stored = self._stored_messages([m.message_id for m in body.messages])
        taken_events = self._stored_event_ids(
            [e.event_id for m in body.messages for e in m.events])
        for message in body.messages:
            if message.profile_id not in owned:
                raise NotOwned(f"profile {message.profile_id} not owned")
            if any(e.symbol_key is not None and e.symbol_key not in ids_by_key
                   for e in message.events):
                raise InvalidInput("unknown symbol key")
            existing = stored.get(message.message_id)
            if existing is not None:
                if not self._same_upload(existing, message, ids_by_key):
                    raise Conflict("message ID already used")
                plan.duplicates += 1
                continue
            if any(e.event_id in taken_events for e in message.events):
                raise Conflict("event ID already used")
            plan.new.append(message)
        return plan

    def _owned_device(self, device_id: str | None) -> models.Device | None:
        if not device_id:
            return None
        device = self.db.get(models.Device, device_id)
        profile = self.db.get(models.ChildProfile, device.profile_id) if device else None
        if not profile or profile.created_by != self.user.user_id:
            raise NotFound("device not found")
        return device

    def _owned_profile_ids(self, profile_ids: set[str]) -> set[str]:
        owned: set[str] = set()
        for chunk in _chunks(sorted(profile_ids)):
            owned.update(self.db.scalars(select(models.ChildProfile.profile_id).where(
                models.ChildProfile.profile_id.in_(chunk),
                models.ChildProfile.created_by == self.user.user_id)))
        return owned

    def _stored_messages(self, message_ids: list[str]) -> dict[str, models.Message]:
        stored: dict[str, models.Message] = {}
        for chunk in _chunks(message_ids):
            query = (select(models.Message).where(models.Message.message_id.in_(chunk))
                     .options(selectinload(models.Message.events)))
            stored.update((m.message_id, m) for m in self.db.scalars(query))
        return stored

    def _stored_event_ids(self, event_ids: list[str]) -> set[str]:
        taken: set[str] = set()
        for chunk in _chunks(event_ids):
            taken.update(self.db.scalars(select(models.TapEvent.event_id).where(
                models.TapEvent.event_id.in_(chunk))))
        return taken

    @staticmethod
    def _same_upload(stored: models.Message, incoming: schemas.MessageIn,
                     ids_by_key: dict[str, int]) -> bool:
        if (stored.profile_id, stored.started_at, stored.spoken_at, stored.tap_count,
                stored.duration_ms, stored.board_mode) != (
                incoming.profile_id, to_utc_naive(incoming.started_at),
                to_utc_naive(incoming.spoken_at), incoming.tap_count, composition_ms(incoming),
                incoming.board_mode):
            return False
        stored_events = {
            (e.event_id, e.action_index, e.action_type, e.symbol_id, e.was_suggested, e.context,
             e.ts) for e in stored.events
        }
        incoming_events = {
            (e.event_id, e.action_index, e.action_type, ids_by_key.get(e.symbol_key),
             e.was_suggested, e.context, to_utc_naive(e.ts)) for e in incoming.events
        }
        return stored_events == incoming_events

    # ---- write ----------------------------------------------------------------------------
    def _write(self, plan: _Plan, ids_by_key: dict[str, int]) -> int:
        events = 0
        for m in plan.new:
            self.db.add(models.Message(
                message_id=m.message_id, profile_id=m.profile_id,
                started_at=to_utc_naive(m.started_at), spoken_at=to_utc_naive(m.spoken_at),
                tap_count=len(m.events), duration_ms=composition_ms(m), board_mode=m.board_mode))
            for e in m.events:
                self.db.add(models.TapEvent(
                    event_id=e.event_id, message_id=m.message_id,
                    symbol_id=ids_by_key.get(e.symbol_key) if e.symbol_key else None,
                    action_index=e.action_index, action_type=e.action_type,
                    was_suggested=e.was_suggested, context=e.context, ts=to_utc_naive(e.ts)))
                events += 1
        if plan.device:
            plan.device.last_sync = to_utc_naive(datetime.now(UTC))
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            raise Conflict("sync IDs conflict; refresh and retry")
        return events
