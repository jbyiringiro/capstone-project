import json
import math

import pytest

from vuga_ml import EOS
from vuga_ml.lexicon import Lexicon
from vuga_ml.mapping import map_corpus, map_sentence
from vuga_ml.metrics import BoardLayout, aggregate, score_sequence, simulate_message, simulated_ksr
from vuga_ml.models import KneserNeyTrigram, PersonalReranker, UnigramFrequency
from vuga_ml.models.reranker import PersonalHistory
from vuga_ml.normalise import tokenise
from vuga_ml.splits import split

LEX = Lexicon.from_rows([
    ("ndashaka", "gushaka", "I+WANT"),
    ("sinshaka", "gushaka", "I+NOT+WANT", True),
    ("amazi", "amazi", "WATER"),
    ("kurya", "kurya", "EAT"),
    ("gukina", "gukina", "PLAY"),
    ("na", "na", "DROP"),
    ("n'abana", "umwana", "WITH+CHILDREN"),
    ("mama", "mama", "MUM"),
    ("ndumva", "kumva", "I+FEEL"),
    ("nabi", "nabi", "BAD"),
    ("neza", "neza", "GOOD"),
])


def test_tokenise_keeps_elision_apostrophe_and_drops_punctuation():
    assert tokenise("Ndashaka amazi, n’abana!") == ["ndashaka", "amazi", "n'abana"]
    assert tokenise("Mfite imyaka 12.") == ["mfite", "imyaka"]


def test_mapping_statuses():
    assert map_sentence("ndashaka amazi", LEX).symbols == ("I", "WANT", "WATER")
    assert map_sentence("sinshaka kurya", LEX).symbols == ("I", "NOT", "WANT", "EAT")
    assert map_sentence("amazi", LEX).status == "too_short"
    assert map_sentence("ndashaka amata", LEX).status == "low_core_ratio"
    assert map_sentence("ndashaka gukina na mama", LEX).symbols == ("I", "WANT", "PLAY", "MUM")
    long = " ".join(["amazi"] * 9)
    assert map_sentence(long, LEX).status == "too_long"


def test_lost_negation_is_excluded():
    lex = Lexicon.from_rows([("sinshaka", "gushaka", "I+WANT", True), ("amazi", "amazi", "WATER")])
    assert map_sentence("sinshaka amazi", lex).status == "lost_negation"


def test_ambiguous_token_is_excluded():
    lex = Lexicon.from_rows([("neza", "neza", "GOOD"), ("neza", "neza", "WELL"), ("ndumva", "kumva", "I+FEEL")])
    assert map_sentence("ndumva neza", lex).status == "ambiguous_token"


def test_split_keeps_symbol_groups_together_and_dedupes():
    lines = []
    for i in range(50):
        lines += ["ndashaka amazi", "ndashaka kurya", "ndumva nabi", "ndumva neza",
                  "ndashaka gukina", "sinshaka kurya", "ndashaka gukina na mama",
                  f"ndashaka amazi{'' if i % 2 else ','}"]  # punctuation variant -> same sentence
    kept, counts = map_corpus(lines, LEX)
    res = split(kept, seed=1)
    assert res.n_unique == 7
    parts = res.as_dict()
    seen = {}
    for part, rows in parts.items():
        for r in rows:
            assert seen.setdefault(r.symbols, part) == part
    assert len(res.train) + len(res.validation) + len(res.test) == res.n_unique


def test_models_predict_distribution_and_mask():
    train = [("I", "WANT", "WATER"), ("I", "WANT", "EAT"), ("I", "WANT", "WATER"),
             ("I", "FEEL", "BAD"), ("MUM", "PLAY")]
    for model in (UnigramFrequency(), KneserNeyTrigram()):
        model.fit(train)
        dist = model.predict(("I", "WANT"))
        assert math.isclose(sum(dist.values()), 1.0, rel_tol=1e-9)
        assert EOS in dist
        masked = model.predict(("I", "WANT"), allowed={"WATER", "EAT"})
        assert set(masked) == {"WATER", "EAT", EOS}
        assert math.isclose(sum(masked.values()), 1.0, rel_tol=1e-9)
    kn = KneserNeyTrigram(); kn.fit(train)
    assert kn.top_k(("I", "WANT"), 1) == ["WATER"]
    assert kn.top_k(("I",), 1) == ["WANT"]
    # persistence round trip
    kn2 = KneserNeyTrigram.from_dict(kn.to_dict())
    assert kn2.predict(("I",)) == pytest.approx(kn.predict(("I",)))


def test_metrics_and_bootstrap_shape():
    train = [("I", "WANT", "WATER")] * 5 + [("I", "WANT", "EAT")] * 2
    kn = KneserNeyTrigram(); kn.fit(train)
    scores = [score_sequence(kn, s) for s in [("I", "WANT", "WATER"), ("I", "WANT", "EAT")]]
    agg = aggregate(scores)
    assert 0 <= agg["top1"] <= agg["top3"] <= 1
    assert agg["perplexity"] > 1


def test_simulated_ksr_counts_section_tabs_page_turns_and_speak(tmp_path):
    # As on the board: it opens at the first section, a tab opens a section at its first page in
    # one tap, each page turn is a tap, a hidden word keeps its slot and an empty page is skipped.
    sections = {"core": ["I", "WANT", None, None, "HELP", "MUM"],
                "food": ["EAT", "WATER", "MILK", "BREAD", "TEA", "I"]}
    layout = BoardLayout(sections, page_size=2)
    # core: [I, WANT] [HELP, MUM]; food: [EAT, WATER] [MILK, BREAD] [TEA, I]
    assert layout.places["HELP"] == [("core", 1)] and layout.places["I"] == [("core", 0), ("food", 2)]
    # static: I (1), WANT (1), WATER (its tab, the word: 2), Speak (1)
    assert simulate_message(None, layout, ("I", "WANT", "WATER")) == 5
    # MILK: the tab, a page turn and the word (3); TEA: a page turn and the word (2); Speak
    assert simulate_message(None, layout, ("MILK", "TEA")) == 6
    # MUM from the food section: the tab back to core's first page, a page turn, the word
    assert simulate_message(None, layout, ("WATER", "MUM")) == 2 + 3 + 1
    # After TEA, I is on the same page, so no tab back to core is needed
    assert simulate_message(None, layout, ("TEA", "I")) == 4 + 1 + 1
    kn = KneserNeyTrigram(); kn.fit([("I", "WANT", "WATER")] * 10)
    # predictive: each word is suggested, one tap that leaves the section and page as they were
    assert simulate_message(kn, layout, ("I", "WANT", "WATER")) == 4
    r = simulated_ksr(kn, layout, [("I", "WANT", "WATER")])
    assert r["ksr"] == pytest.approx(0.2)
    # The app's own sections come from app/scripts/export-board-layout.mjs.
    (tmp_path / "layout.json").write_text(json.dumps({"sections": sections}), encoding="utf-8")
    assert BoardLayout.from_json(tmp_path / "layout.json", page_size=2).places == layout.places
    with pytest.raises(KeyError):
        simulate_message(None, layout, ("CAT",))


def test_reranker_prefers_personal_history():
    train = [("I", "WANT", "WATER")] * 10 + [("I", "WANT", "EAT")] * 3
    kn = KneserNeyTrigram(); kn.fit(train)
    rr = PersonalReranker(kn, w_freq=1.0, w_rec=1.0, w_ctx=2.0)
    hist = PersonalHistory()
    assert rr.top_k(("I", "WANT"), hist, now=0.0, k=1) == ["WATER"]
    for t in range(5):
        hist.record(("I", "WANT"), "EAT", t=float(t))
    assert rr.top_k(("I", "WANT"), hist, now=5.0, k=1) == ["EAT"]
