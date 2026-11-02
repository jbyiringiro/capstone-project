from pathlib import Path

import pytest

from vuga_ml.vocab_review import ReviewDataError, analyse, decision_rows, load_review_words, load_symbols

VOCAB = Path(__file__).resolve().parents[2] / "vocab"
SYMBOLS = {"WATER": "amazi", "FOOD": "ibiryo", "HELP": "mfasha", "SICK": "ndarwaye"}


def row(participant, symbol_id, picture="yes", word="yes", decision="K", better_word=""):
    return {"participant": participant, "symbol_id": symbol_id, "picture": picture, "word": word,
            "better_word": better_word, "decision": decision}


def statuses(reviews, mentions=None):
    return {w["symbol_id"]: w["proposed"] for w in analyse(reviews, SYMBOLS, mentions)["words"]}


def test_majority_rule_proposes_each_status():
    reviews = [
        row("A-01", "WATER"), row("A-02", "WATER"), row("A-03", "WATER", decision="C"),
        row("A-01", "FOOD", decision="R"), row("A-02", "FOOD", decision="R"), row("A-03", "FOOD"),
        row("A-01", "HELP", word="no", decision="C", better_word="Mfasha  "), row("A-02", "HELP", word="no", better_word="mfasha"),
        row("A-03", "HELP"),
        row("A-01", "SICK"), row("A-02", "SICK", decision="C"),
    ]
    assert statuses(reviews) == {"WATER": "accept", "FOOD": "exclude", "HELP": "revise", "SICK": "unresolved"}


def test_answers_from_the_kinyarwanda_sheet_count_the_same_as_english_ones():
    reviews = [row("A-01", "WATER", picture="Yego", word="yego", decision="rigumeho"),
               row("A-02", "WATER", picture="sinzi  neza", word="oya", decision="Rihindurwe"),
               row("A-03", "WATER", picture="oya", word="yes", decision="rikurweho")]
    water = analyse(reviews, SYMBOLS)["words"][0]
    assert water["picture"] == {"yes": 1, "unsure": 1, "no": 1}
    assert water["word"] == {"yes": 2, "no": 1}
    assert water["decision"] == {"K": 1, "C": 1, "R": 1}


def test_a_keep_majority_is_not_accepted_when_half_say_the_picture_is_wrong():
    reviews = [row("A-01", "WATER", picture="no"), row("A-02", "WATER"), row("A-03", "WATER", picture="unsure"),
               row("A-04", "WATER", picture="no")]
    assert statuses(reviews) == {"WATER": "revise"}


def test_blank_answers_are_left_out_and_a_word_without_decisions_stays_unresolved():
    report = analyse([row("A-01", "WATER", picture="", word="", decision=""), row("A-02", "FOOD", picture="")], SYMBOLS)
    words = {w["symbol_id"]: w for w in report["words"]}
    assert words["WATER"]["proposed"] == "unresolved" and words["WATER"]["reviewers"] == 1
    assert words["FOOD"]["picture"] == {"yes": 0, "unsure": 0, "no": 0}
    assert words["FOOD"]["proposed"] == "accept"
    assert report["summary"] == {"accept": 1, "revise": 0, "exclude": 0, "unresolved": 1}


def test_mentions_count_people_not_repeats_and_flag_words_already_on_the_board():
    mentions = [{"participant": "A-01", "kind": "hard", "item": "HELP"}, {"participant": "A-01", "kind": "hard", "item": "HELP"},
                {"participant": "A-02", "kind": "hard", "item": "HELP"}, {"participant": "A-03", "kind": "hard", "item": "FOOD"},
                {"participant": "A-01", "kind": "add", "item": "Umupira"}, {"participant": "A-02", "kind": "add", "item": " umupira "},
                {"participant": "A-03", "kind": "add", "item": "Amazi"}]
    report = analyse([row("A-01", "HELP")], SYMBOLS, mentions)
    assert report["hard_to_find"] == [["HELP", 2], ["FOOD", 1]]
    assert report["words"][0]["hard_mentions"] == 2
    assert report["additions"] == [{"word": "umupira", "participants": 2, "already_on_board": False},
                                   {"word": "amazi", "participants": 1, "already_on_board": True}]


@pytest.mark.parametrize("bad, message", [
    (row("A-01", "PIZZA"), "unknown symbol_id"),
    (row("A-01", "WATER", picture="maybe"), "picture must be"),
    (row("A-01", "WATER", decision="X"), "decision must be"),
    (row("", "WATER"), "participant code is empty"),
])
def test_bad_rows_are_refused_with_their_line(bad, message):
    with pytest.raises(ReviewDataError, match=message) as error:
        analyse([row("A-01", "FOOD"), bad], SYMBOLS)
    assert "line 3" in str(error.value)


def test_a_participant_cannot_review_a_word_twice():
    with pytest.raises(ReviewDataError, match="already reviewed WATER"):
        analyse([row("A-01", "WATER"), row("A-01", "WATER", decision="R")], SYMBOLS)


def test_words_follow_the_sheet_order_and_unreviewed_sheet_words_are_listed():
    report = analyse([row("A-01", "WATER"), row("A-01", "HELP")], SYMBOLS, order=["HELP", "SICK", "WATER"])
    assert [w["symbol_id"] for w in report["words"]] == ["HELP", "WATER"]
    assert report["not_reviewed"] == ["SICK"]


def test_draft_log_rows_match_the_decision_log_table():
    reviews = [row("A-01", "HELP", word="no", decision="C", better_word="ntabare"), row("A-02", "HELP", word="no", decision="C", better_word="ntabare")]
    mentions = [{"participant": "A-01", "kind": "add", "item": "umupira"}]
    rows = decision_rows(analyse(reviews, SYMBOLS, mentions), "2026-11-21")
    assert rows[0].startswith("| 2026-11-21 | symbols.csv | HELP (mfasha) | Revise: label to 'ntabare'? (2 suggested) |")
    assert rows[1].startswith("| 2026-11-21 | symbols.csv | new: umupira | Consider adding | named by 1 adult(s) |")
    header = (VOCAB / "decision_log.md").read_text(encoding="utf-8").splitlines()[2]
    assert all(r.count("|") == header.count("|") for r in rows)


def test_the_review_sheet_words_are_all_in_the_bundled_vocabulary():
    words = load_review_words(VOCAB / "review_words.csv")
    symbols = load_symbols(VOCAB / "symbols.csv")
    assert len(words) == len(set(words)) == 32
    assert [w for w in words if w not in symbols] == []
