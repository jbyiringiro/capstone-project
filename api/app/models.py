"""ORM models: one class per table in the proposal ERD (Figure 7, eleven tables).

Privacy rules from NFR4 are enforced at the schema level: child_profiles carries a pseudonymous
`code` and age band only, never a name, photo or date of birth.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"
    user_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(32), unique=True)
    role: Mapped[str] = mapped_column(String(16))  # teacher | caregiver | administrator
    password_hash: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    profiles: Mapped[list[ChildProfile]] = relationship(back_populates="creator")


class ChildProfile(Base):
    __tablename__ = "child_profiles"
    profile_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    code: Mapped[str] = mapped_column(String(16), unique=True)  # pseudonymous, e.g. P-07
    age_band: Mapped[str | None] = mapped_column(String(16))
    access_method: Mapped[str] = mapped_column(String(16), default="touch")
    created_by: Mapped[str] = mapped_column(ForeignKey("users.user_id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    creator: Mapped[User] = relationship(back_populates="profiles")
    vocabulary: Mapped[list[ProfileVocabulary]] = relationship(back_populates="profile")
    boards: Mapped[list[Board]] = relationship(back_populates="profile")
    messages: Mapped[list[Message]] = relationship(back_populates="profile")


class Symbol(Base):
    __tablename__ = "symbols"
    symbol_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(48), unique=True)  # e.g. WANT, THANK_YOU
    arasaac_id: Mapped[int | None] = mapped_column(Integer)
    label_rw: Mapped[str] = mapped_column(String(80))
    label_en: Mapped[str | None] = mapped_column(String(80))
    category: Mapped[str | None] = mapped_column(String(40))
    image_path: Mapped[str | None] = mapped_column(String(255))

    clips: Mapped[list[AudioClip]] = relationship(back_populates="symbol")


class AudioClip(Base):
    __tablename__ = "audio_clips"
    clip_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    symbol_id: Mapped[int] = mapped_column(ForeignKey("symbols.symbol_id"))
    path: Mapped[str] = mapped_column(String(255))
    speaker: Mapped[str | None] = mapped_column(String(32))
    duration_ms: Mapped[int | None] = mapped_column(Integer)

    symbol: Mapped[Symbol] = relationship(back_populates="clips")


class ProfileVocabulary(Base):
    __tablename__ = "profile_vocabulary"
    profile_id: Mapped[str] = mapped_column(ForeignKey("child_profiles.profile_id"), primary_key=True)
    symbol_id: Mapped[int] = mapped_column(ForeignKey("symbols.symbol_id"), primary_key=True)
    is_favourite: Mapped[bool] = mapped_column(Boolean, default=False)
    custom_clip_id: Mapped[str | None] = mapped_column(ForeignKey("audio_clips.clip_id"))

    profile: Mapped[ChildProfile] = relationship(back_populates="vocabulary")
    symbol: Mapped[Symbol] = relationship()


class Board(Base):
    __tablename__ = "boards"
    board_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    profile_id: Mapped[str] = mapped_column(ForeignKey("child_profiles.profile_id"))
    name: Mapped[str | None] = mapped_column(String(80))
    grid_rows: Mapped[int] = mapped_column(Integer, default=4)
    grid_cols: Mapped[int] = mapped_column(Integer, default=5)

    profile: Mapped[ChildProfile] = relationship(back_populates="boards")
    cells: Mapped[list[BoardCell]] = relationship(back_populates="board", cascade="all, delete-orphan")


class BoardCell(Base):
    __tablename__ = "board_cells"
    board_id: Mapped[str] = mapped_column(ForeignKey("boards.board_id"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol_id: Mapped[int] = mapped_column(ForeignKey("symbols.symbol_id"))
    colour: Mapped[str | None] = mapped_column(String(16))

    board: Mapped[Board] = relationship(back_populates="cells")


class Message(Base):
    """A draft is persisted before its first TapEvent (proposal 3.2.3, FR7)."""

    __tablename__ = "messages"
    message_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    profile_id: Mapped[str] = mapped_column(ForeignKey("child_profiles.profile_id"))
    started_at: Mapped[datetime] = mapped_column(DateTime)
    spoken_at: Mapped[datetime | None] = mapped_column(DateTime)
    tap_count: Mapped[int] = mapped_column(Integer, default=0)  # all task actions incl. Speak
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    board_mode: Mapped[str] = mapped_column(String(16))  # static | predictive

    profile: Mapped[ChildProfile] = relationship(back_populates="messages")
    events: Mapped[list[TapEvent]] = relationship(back_populates="message", cascade="all, delete-orphan")


class TapEvent(Base):
    __tablename__ = "tap_events"
    event_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    message_id: Mapped[str] = mapped_column(ForeignKey("messages.message_id"))
    symbol_id: Mapped[int | None] = mapped_column(ForeignKey("symbols.symbol_id"))  # selection only
    action_index: Mapped[int] = mapped_column(Integer)
    action_type: Mapped[str] = mapped_column(String(16))  # select | navigate | correct | speak
    was_suggested: Mapped[bool] = mapped_column(Boolean, default=False)
    context: Mapped[str | None] = mapped_column(String(255))
    ts: Mapped[datetime] = mapped_column(DateTime)

    message: Mapped[Message] = relationship(back_populates="events")


class Device(Base):
    __tablename__ = "devices"
    device_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    profile_id: Mapped[str] = mapped_column(ForeignKey("child_profiles.profile_id"))
    serial: Mapped[str | None] = mapped_column(String(64))
    firmware: Mapped[str | None] = mapped_column(String(32))
    last_sync: Mapped[datetime | None] = mapped_column(DateTime)


class ModelVersion(Base):
    __tablename__ = "model_versions"
    model_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str | None] = mapped_column(String(80))
    trained_at: Mapped[datetime | None] = mapped_column(DateTime)
    artifact_path: Mapped[str | None] = mapped_column(String(255))
    is_frozen: Mapped[bool] = mapped_column(Boolean, default=False)  # study models never change
