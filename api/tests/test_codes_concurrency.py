"""OTP request interleavings on independent SQLite connections, with a fake SMS provider.

These are database regression tests, not provider delivery or PostgreSQL load evidence.
Every database is created under pytest's temporary directory; no real number is contacted.
"""
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app import models
from app.db import Base
from app.services import codes
from app.services.errors import InvalidCode, SmsFailed, TooManyCodes

PHONE, PURPOSE, ORIGINAL = "+250780000099", "reset", "123456"


class FakeSMS:
    delivery = "sms"

    def __init__(self, during_send=None):
        self.texts = []
        self.during_send = during_send

    def send(self, phone, text):
        self.texts.append(text)
        if self.during_send:
            self.during_send(text)

    @property
    def code(self):
        return re.search(r"\b\d{6}\b", self.texts[-1]).group()


@pytest.fixture
def storage(tmp_path, monkeypatch):
    clock = [datetime(2026, 11, 5, 8, tzinfo=UTC).replace(tzinfo=None)]
    monkeypatch.setattr(codes, "_now", lambda: clock[0])
    engine = create_engine(f"sqlite:///{tmp_path / 'otp-races.db'}",
                           connect_args={"check_same_thread": False, "timeout": 10})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, autoflush=False)
    yield sessions, clock
    engine.dispose()


def seed(sessions, clock, *, attempts=0, sends=1, elapsed=61, window_elapsed=0):
    now = clock[0]
    with sessions() as db:
        db.add(models.PhoneCode(
            phone=PHONE, purpose=PURPOSE, code_hash=codes._digest(PHONE, PURPOSE, ORIGINAL),
            expires_at=now + codes.CODE_LIFETIME, attempts=attempts,
            sent_at=now - timedelta(seconds=elapsed), sends=sends,
            window_start=now - timedelta(seconds=window_elapsed)))
        db.commit()


def state(sessions):
    with sessions() as db:
        row = db.get(models.PhoneCode, (PHONE, PURPOSE))
        return ({key: getattr(row, key) for key in (
            "code_hash", "expires_at", "attempts", "sent_at", "sends", "window_start")}
                if row else None)


def accept(sessions, code):
    with sessions() as db:
        codes.PhoneCodes(db).use(PHONE, PURPOSE, code)
        db.commit()


def test_a_preloaded_session_cannot_reuse_a_consumed_code(storage):
    sessions, clock = storage
    seed(sessions, clock)
    with sessions() as first, sessions() as second:
        # Keep strong references: SQLAlchemy otherwise drops unused cached objects.
        loaded = [first.get(models.PhoneCode, (PHONE, PURPOSE)),
                  second.get(models.PhoneCode, (PHONE, PURPOSE))]
        assert all(loaded)
        codes.PhoneCodes(first).use(PHONE, PURPOSE, ORIGINAL)
        first.commit()
        with pytest.raises(InvalidCode) as denied:
            codes.PhoneCodes(second).use(PHONE, PURPOSE, ORIGINAL)
        assert denied.value.reason == "expired"


def test_two_real_transactions_can_consume_a_code_only_once(storage):
    sessions, clock = storage
    seed(sessions, clock)
    together = Barrier(2)

    def use():
        with sessions() as db:
            cached = db.get(models.PhoneCode, (PHONE, PURPOSE))
            together.wait(timeout=10)
            try:
                codes.PhoneCodes(db).use(PHONE, PURPOSE, ORIGINAL)
                db.commit()
                return "accepted"
            except InvalidCode:
                db.rollback()
                return "rejected"
            finally:
                assert cached is not None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: use(), range(2)))
    assert sorted(results) == ["accepted", "rejected"]


def test_consumption_rolls_back_with_the_callers_failed_change(storage):
    sessions, clock = storage
    seed(sessions, clock)
    with sessions() as first:
        codes.PhoneCodes(first).use(PHONE, PURPOSE, ORIGINAL)
        first.rollback()  # registration or PIN update failed before its commit
    accept(sessions, ORIGINAL)
    with pytest.raises(InvalidCode):
        accept(sessions, ORIGINAL)


def test_preloaded_wrong_attempts_do_not_lose_an_increment(storage):
    sessions, clock = storage
    seed(sessions, clock, attempts=codes.MAX_ATTEMPTS - 2)
    with sessions() as first, sessions() as second:
        cached = [first.get(models.PhoneCode, (PHONE, PURPOSE)),
                  second.get(models.PhoneCode, (PHONE, PURPOSE))]
        assert all(cached)
        for db in (first, second):
            with pytest.raises(InvalidCode):
                codes.PhoneCodes(db).use(PHONE, PURPOSE, "654321")
    assert state(sessions)["attempts"] == codes.MAX_ATTEMPTS
    assert state(sessions)["code_hash"] is None
    with pytest.raises(InvalidCode) as denied:
        accept(sessions, ORIGINAL)
    assert denied.value.reason == "spent"


def test_parallel_wrong_attempts_stop_at_the_budget(storage):
    sessions, clock = storage
    seed(sessions, clock)
    together = Barrier(8)

    def wrong():
        with sessions() as db:
            cached = db.get(models.PhoneCode, (PHONE, PURPOSE))
            together.wait(timeout=10)
            with pytest.raises(InvalidCode) as denied:
                codes.PhoneCodes(db).use(PHONE, PURPOSE, "654321")
            assert cached is not None
            return denied.value.reason, denied.value.attempts_left

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: wrong(), range(8)))
    assert sorted(left for reason, left in results if reason == "wrong") == [1, 2, 3, 4]
    assert sum(reason == "spent" for reason, _ in results) == 4
    assert state(sessions)["attempts"] == codes.MAX_ATTEMPTS
    assert state(sessions)["code_hash"] is None


@pytest.mark.parametrize("existing", [False, True])
def test_competing_initial_or_existing_reservations_call_provider_once(storage, existing):
    sessions, clock = storage
    if existing:
        seed(sessions, clock)
    together, sms = Barrier(2), FakeSMS()

    class TogetherCodes(codes.PhoneCodes):
        first_read = True

        def _state(self, phone, purpose):
            row = super()._state(phone, purpose)
            if self.first_read:
                self.first_read = False
                together.wait(timeout=10)  # both requests read before either reserves
            return row

    def send():
        with sessions() as db:
            try:
                TogetherCodes(db, sms).send(PHONE, PURPOSE)
                return "sent"
            except TooManyCodes:
                return "throttled"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: send(), range(2)))
    assert sorted(results) == ["sent", "throttled"]
    assert len(sms.texts) == 1
    assert state(sessions)["sends"] == (2 if existing else 1)
    accept(sessions, sms.code)


def test_reservation_is_durable_and_code_is_not_usable_during_provider_call(storage):
    sessions, _ = storage

    def during_send(text):
        assert state(sessions)["code_hash"] is None
        assert state(sessions)["sends"] == 1
        rival = FakeSMS()
        with sessions() as db, pytest.raises(TooManyCodes):
            codes.PhoneCodes(db, rival).send(PHONE, PURPOSE)
        assert rival.texts == []
        with pytest.raises(InvalidCode):
            accept(sessions, re.search(r"\b\d{6}\b", text).group())

    sms = FakeSMS(during_send)
    with sessions() as db:
        codes.PhoneCodes(db, sms).send(PHONE, PURPOSE)
    accept(sessions, sms.code)


@pytest.mark.parametrize("existing", [False, True])
def test_reported_delivery_failure_restores_state_and_allows_immediate_retry(storage, existing):
    sessions, clock = storage
    if existing:
        seed(sessions, clock, attempts=2, sends=3)
    before = state(sessions)

    def refuse(_):
        raise SmsFailed("synthetic provider refusal")

    with sessions() as db, pytest.raises(SmsFailed):
        codes.PhoneCodes(db, FakeSMS(refuse)).send(PHONE, PURPOSE)
    assert state(sessions) == before
    sms = FakeSMS()
    with sessions() as db:
        codes.PhoneCodes(db, sms).send(PHONE, PURPOSE)
    assert state(sessions)["sends"] == (4 if existing else 1)
    accept(sessions, sms.code)


@pytest.mark.parametrize("late_refusal", [False, True])
def test_late_provider_response_cannot_replace_or_undo_a_newer_send(storage, monkeypatch, late_refusal):
    sessions, clock = storage
    values = iter([123456, 246810])
    monkeypatch.setattr(codes.secrets, "randbelow", lambda _: next(values))
    newer = FakeSMS()

    def delayed(_):
        clock[0] += codes.RESEND_AFTER + timedelta(seconds=1)
        with sessions() as db:
            codes.PhoneCodes(db, newer).send(PHONE, PURPOSE)
        if late_refusal:
            raise SmsFailed("synthetic delayed refusal")

    with sessions() as db, pytest.raises(SmsFailed if late_refusal else TooManyCodes):
        codes.PhoneCodes(db, FakeSMS(delayed)).send(PHONE, PURPOSE)
    row = state(sessions)
    assert row["sends"] == 2
    assert row["code_hash"] == codes._digest(PHONE, PURPOSE, newer.code)
    accept(sessions, newer.code)


def test_interrupted_delivery_leaves_cooldown_and_budget_but_no_usable_code(storage):
    sessions, clock = storage

    class Interrupted(BaseException):
        pass

    def interrupt(_):
        raise Interrupted()

    with sessions() as db, pytest.raises(Interrupted):
        codes.PhoneCodes(db, FakeSMS(interrupt)).send(PHONE, PURPOSE)
    assert state(sessions)["sends"] == 1
    assert state(sessions)["code_hash"] is None
    with sessions() as db, pytest.raises(TooManyCodes):
        codes.PhoneCodes(db, FakeSMS()).send(PHONE, PURPOSE)
    clock[0] += codes.RESEND_AFTER + timedelta(seconds=1)
    sms = FakeSMS()
    with sessions() as db:
        codes.PhoneCodes(db, sms).send(PHONE, PURPOSE)
    assert state(sessions)["sends"] == 2
    accept(sessions, sms.code)


@pytest.mark.parametrize("unexpected", [False, True])
def test_unknown_delivery_outcome_cannot_bypass_cooldown_or_send_budget(storage, unexpected):
    sessions, clock = storage

    def fail(_):
        if unexpected:
            raise RuntimeError("synthetic unexpected provider error")
        raise SmsFailed("synthetic transport timeout", delivery_uncertain=True)

    sms = FakeSMS(fail)
    for count in range(1, codes.MAX_SENDS + 1):
        with sessions() as db, pytest.raises(RuntimeError if unexpected else SmsFailed):
            codes.PhoneCodes(db, sms).send(PHONE, PURPOSE)
        assert state(sessions)["sends"] == count
        assert state(sessions)["code_hash"] is None
        with sessions() as db, pytest.raises(TooManyCodes):
            codes.PhoneCodes(db, sms).send(PHONE, PURPOSE)
        assert len(sms.texts) == count  # cooldown stops even another provider call
        clock[0] += codes.RESEND_AFTER + timedelta(seconds=1)
    with sessions() as db, pytest.raises(TooManyCodes) as denied:
        codes.PhoneCodes(db, sms).send(PHONE, PURPOSE)
    assert denied.value.reason == "limit"
    assert len(sms.texts) == codes.MAX_SENDS


def test_database_failure_after_provider_acceptance_keeps_the_durable_reservation(storage):
    sessions, _ = storage
    sms, commits = FakeSMS(), []

    def fail_activation_commit(_):
        commits.append(True)
        if len(commits) == 2:
            raise RuntimeError("synthetic database failure")

    with sessions() as db:
        event.listen(db, "before_commit", fail_activation_commit)
        with pytest.raises(RuntimeError):
            codes.PhoneCodes(db, sms).send(PHONE, PURPOSE)
        db.rollback()
    assert len(sms.texts) == 1
    assert state(sessions)["sends"] == 1
    assert state(sessions)["code_hash"] is None
    with pytest.raises(InvalidCode):
        accept(sessions, sms.code)


def test_hourly_budget_is_preserved_and_resets_at_the_next_window(storage):
    sessions, clock = storage
    seed(sessions, clock, sends=codes.MAX_SENDS - 1)
    sms = FakeSMS()
    with sessions() as db:
        codes.PhoneCodes(db, sms).send(PHONE, PURPOSE)
    assert state(sessions)["sends"] == codes.MAX_SENDS
    clock[0] += codes.RESEND_AFTER + timedelta(seconds=1)
    with sessions() as db, pytest.raises(TooManyCodes) as denied:
        codes.PhoneCodes(db, sms).send(PHONE, PURPOSE)
    assert denied.value.reason == "limit"
    assert len(sms.texts) == 1
    clock[0] += codes.SEND_WINDOW
    with sessions() as db:
        codes.PhoneCodes(db, sms).send(PHONE, PURPOSE)
    assert state(sessions)["sends"] == 1
    assert len(sms.texts) == 2


def test_expired_code_is_not_consumed_or_counted_as_a_wrong_attempt(storage):
    sessions, clock = storage
    seed(sessions, clock)
    clock[0] += codes.CODE_LIFETIME
    with pytest.raises(InvalidCode) as denied:
        accept(sessions, ORIGINAL)
    assert denied.value.reason == "expired"
    assert state(sessions)["attempts"] == 0
