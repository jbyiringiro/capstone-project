"""Caregiver summary (FR8): symbol-selection frequency reported separately from all-action taps.

Only completed (spoken) messages count; taps per message include navigation, corrections and
the Speak tap, grouped by board mode so static and predictive sessions are never mixed.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import models
from .catalogue import SymbolCatalogue


class SummaryService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def for_profile(self, profile: models.ChildProfile) -> dict:
        keys = SymbolCatalogue(self.db).keys_by_id()
        spoken = self.db.scalars(
            select(models.Message)
            .where(models.Message.profile_id == profile.profile_id,
                   models.Message.spoken_at.is_not(None))
            .options(selectinload(models.Message.events)))
        frequency: dict[str, int] = {}
        per_mode: dict[str, dict] = {}
        for message in spoken:
            totals = per_mode.setdefault(message.board_mode,
                                         {"messages": 0, "taps": 0, "duration_ms": 0})
            totals["messages"] += 1
            totals["taps"] += message.tap_count
            totals["duration_ms"] += message.duration_ms or 0
            for event in message.events:
                if event.action_type == "select" and event.symbol_id is not None:
                    key = keys.get(event.symbol_id, str(event.symbol_id))
                    frequency[key] = frequency.get(key, 0) + 1
        for totals in per_mode.values():
            n = totals["messages"] or 1
            totals["taps_per_message"] = totals["taps"] / n
            totals["seconds_per_message"] = totals["duration_ms"] / n / 1000
        return {"profile": profile.code,
                "symbol_frequency": dict(sorted(frequency.items(), key=lambda kv: -kv[1])),
                "by_board_mode": per_mode}
