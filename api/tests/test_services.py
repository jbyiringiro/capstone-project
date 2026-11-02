"""Service-layer unit tests: business rules checked directly on a session, without HTTP."""
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import models, schemas
from app.db import Base
from app.services import (
    Conflict,
    InvalidInput,
    ModelRegistry,
    NotFound,
    NotOwned,
    ProfileService,
    SummaryService,
    SymbolCatalogue,
    SyncService,
)
from app.services.sync import composition_ms

T0 = datetime(2026, 10, 20, 9, 0, tzinfo=UTC)


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        SymbolCatalogue(session).import_csv()
        yield session
    engine.dispose()


def _user(db, phone="0780000001"):
    user = models.User(name="T", phone=phone, role="teacher", password_hash="x")
    db.add(user)
    db.commit()
    return user


def _profile(db, user, code="P-01"):
    return ProfileService(db).create(user, schemas.ProfileCreate(code=code))


def _message(profile_id, mode="static", actions=(("select", "I"), ("navigate", None),
                                                 ("select", "WATER"), ("speak", None)),
             speak_after_ms=4000, playback_ms=2500, spoken=True):
    events = []
    for index, (action, symbol) in enumerate(actions):
        ts = T0 + timedelta(milliseconds=speak_after_ms if action == "speak" else index * 1000)
        events.append(schemas.TapEventIn(event_id=str(uuid.uuid4()), action_index=index,
                                         action_type=action, symbol_key=symbol, ts=ts))
    return schemas.MessageIn(
        message_id=str(uuid.uuid4()), profile_id=profile_id, started_at=T0,
        spoken_at=T0 + timedelta(milliseconds=speak_after_ms + playback_ms) if spoken else None,
        tap_count=len(events), duration_ms=None, board_mode=mode, events=events)


def _count(db, model):
    return db.scalar(select(func.count()).select_from(model))


def test_catalogue_import_is_idempotent(db, tmp_path):
    shipped = _count(db, models.Symbol)
    assert shipped >= 100 and SymbolCatalogue(db).import_csv() == 0
    extra = tmp_path / "symbols.csv"
    extra.write_text("symbol_id,label_rw,label_en,category,arasaac_id,image_path\n"
                     "WATER,amazi,water,food,,\nKITE,igikoni,kite,play,123,\n", encoding="utf-8")
    assert SymbolCatalogue(db, extra).import_csv() == 1
    assert SymbolCatalogue(db, extra).import_csv() == 0
    assert _count(db, models.Symbol) == shipped + 1


def test_vocabulary_replacement_validates_before_mutating(db):
    profile = _profile(db, _user(db))
    service, ids = ProfileService(db), SymbolCatalogue(db).ids_by_key()
    original = [ids["I"], ids["WANT"], ids["WATER"]]
    assert service.replace_vocabulary(profile, original) == 3
    with pytest.raises(InvalidInput):
        service.replace_vocabulary(profile, [ids["I"], 999_999])
    db.refresh(profile)
    assert {s.key for s in service.vocabulary(profile)} == {"I", "WANT", "WATER"}
    assert service.replace_vocabulary(profile, [ids["HELP"]]) == 1
    db.refresh(profile)
    assert [s.key for s in service.vocabulary(profile)] == ["HELP"]


def test_profiles_are_scoped_to_their_creator(db):
    owner, other = _user(db), _user(db, "0780000002")
    profile = _profile(db, owner)
    service = ProfileService(db)
    assert service.owned(profile.profile_id, owner) is profile
    assert service.owned(profile.profile_id, other) is None
    assert service.list_for(other) == []
    with pytest.raises(Conflict):
        _profile(db, other, code="P-01")


def test_duration_measures_composition_not_playback():
    message = _message("p", speak_after_ms=4000, playback_ms=2500)
    assert composition_ms(message) == 4000
    draft = _message("p", actions=(("select", "I"),), spoken=False)
    assert composition_ms(draft) is None


def test_sync_counts_identical_resend_as_duplicate_and_rejects_changed_reuse(db):
    user = _user(db)
    profile = _profile(db, user)
    message = _message(profile.profile_id)
    service = SyncService(db, user)
    first = service.sync(schemas.SyncRequest(messages=[message]))
    assert (first.accepted_messages, first.accepted_events, first.duplicates) == (1, 4, 0)
    assert db.get(models.Message, message.message_id).duration_ms == 4000
    again = service.sync(schemas.SyncRequest(messages=[message]))
    assert (again.accepted_messages, again.duplicates) == (0, 1)
    changed = message.model_copy(update={"board_mode": "predictive"})
    with pytest.raises(Conflict, match="message ID already used"):
        service.sync(schemas.SyncRequest(messages=[changed]))
    reused = _message(profile.profile_id)
    reused.events[0].event_id = message.events[0].event_id
    with pytest.raises(Conflict, match="event ID already used"):
        service.sync(schemas.SyncRequest(messages=[reused]))
    assert _count(db, models.Message) == 1 and _count(db, models.TapEvent) == 4


@pytest.mark.parametrize("problem", ["foreign_profile", "unknown_symbol"])
def test_sync_rejects_whole_batch_before_writing(db, problem):
    user, other = _user(db), _user(db, "0780000002")
    own = _profile(db, user)
    good = _message(own.profile_id)
    if problem == "foreign_profile":
        bad, error = _message(_profile(db, other, "P-02").profile_id), NotOwned
    else:
        bad = _message(own.profile_id, actions=(("select", "NO_SUCH_SYMBOL"), ("speak", None)))
        error = InvalidInput
    with pytest.raises(error):
        SyncService(db, user).sync(schemas.SyncRequest(messages=[good, bad]))
    assert _count(db, models.Message) == 0 and _count(db, models.TapEvent) == 0


def test_sync_refuses_another_accounts_device(db):
    owner, other = _user(db), _user(db, "0780000002")
    profile = _profile(db, owner)
    db.add(models.Device(device_id="tablet-1", profile_id=profile.profile_id))
    db.commit()
    with pytest.raises(NotFound, match="device not found"):
        SyncService(db, other).sync(schemas.SyncRequest(device_id="tablet-1", messages=[]))
    assert db.get(models.Device, "tablet-1").last_sync is None
    SyncService(db, owner).sync(schemas.SyncRequest(device_id="tablet-1", messages=[]))
    assert db.get(models.Device, "tablet-1").last_sync is not None


def test_summary_separates_selections_from_all_action_taps_per_mode(db):
    user = _user(db)
    profile = _profile(db, user)
    static = _message(profile.profile_id, "static",
                      (("select", "I"), ("navigate", None), ("select", "WATER"),
                       ("correct", None), ("select", "WANT"), ("speak", None)))
    predictive = _message(profile.profile_id, "predictive",
                          (("select", "I"), ("select", "WANT"), ("speak", None)))
    draft = _message(profile.profile_id, "static", (("select", "HELP"),), spoken=False)
    SyncService(db, user).sync(schemas.SyncRequest(messages=[static, predictive, draft]))
    summary = SummaryService(db).for_profile(profile)
    assert summary["profile"] == "P-01"
    assert summary["by_board_mode"]["static"]["taps_per_message"] == 6
    assert summary["by_board_mode"]["predictive"]["taps_per_message"] == 3
    assert summary["by_board_mode"]["static"]["messages"] == 1  # the draft is not counted
    # The corrected WATER still counts as a selection; navigation and Speak never do.
    assert summary["symbol_frequency"] == {"I": 2, "WANT": 2, "WATER": 1}
    assert list(summary["symbol_frequency"])[-1] == "WATER"


def test_model_registry_returns_none_until_an_artefact_exists(tmp_path):
    from vuga_ml.models import KneserNeyTrigram

    registry = ModelRegistry(tmp_path, "kn_trigram.json")
    assert registry.get() is None
    model = KneserNeyTrigram()
    model.fit([("I", "WANT", "WATER"), ("I", "WANT", "PLAY"), ("YOU", "WANT", "WATER")])
    model.save(tmp_path / "kn_trigram.json")
    loaded = registry.get()
    assert loaded.name == "kn_trigram" and registry.get() is loaded
    assert loaded.top_k(("I", "WANT"), 1) == ["WATER"]
    (tmp_path / "odd.json").write_text('{"type": "lstm"}', encoding="utf-8")
    with pytest.raises(ValueError, match="unsupported model type"):
        registry.get("odd.json")
