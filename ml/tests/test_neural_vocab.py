"""Regression: symbols that never occur in training must still have an output slot."""
import os

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
import pytest

torch = pytest.importorskip("torch")

from vuga_ml.metrics import score_sequence
from vuga_ml.models.neural import GRUPredictor


def test_unseen_symbol_is_scored_not_dropped():
    train = [("I", "WANT", "WATER")] * 20 + [("I", "EAT", "BREAD")] * 10
    m = GRUPredictor(emb=8, hidden=16, epochs=2, batch_size=16, seed=0)
    m.fit(train, symbols=["I", "WANT", "WATER", "EAT", "BREAD", "BUY"])
    dist = m.predict(("I",))
    assert "BUY" in dist and dist["BUY"] > 0
    # a validation sentence with BUY is scored (counted as a miss), never skipped
    s = score_sequence(m, ("I", "BUY", "BREAD"))
    assert s.n == 3


def test_without_symbol_list_unseen_target_is_still_counted_by_metrics():
    m = GRUPredictor(emb=8, hidden=16, epochs=1, batch_size=16, seed=0)
    m.fit([("I", "WANT", "WATER")] * 10)
    s = score_sequence(m, ("I", "BUY"))
    assert s.n == 2 and s.hits[1] <= 1
