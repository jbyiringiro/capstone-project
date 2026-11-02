from pathlib import Path

import pytest

from vuga_ml.sentences import build, clip_name, corpus_prefers_ra, hand_forms, review_rows

VOCAB = Path(__file__).resolve().parents[2] / "vocab"


@pytest.fixture(scope="module")
def grammar():
    return build(VOCAB)


def test_study_verbs_have_the_forms_on_the_cards(grammar):
    verbs = grammar["verbs"]
    assert verbs["WANT"]["before"]["1sg"] == "ndashaka"
    assert verbs["LIKE"]["before"]["1sg"] == "nkunda" and verbs["LIKE"]["final"]["1sg"] == "ndakunda"
    assert verbs["LIKE"]["neg"]["1sg"] == "sinkunda"
    assert verbs["HURT"]["before"]["1sg"] == "ndababara"
    assert verbs["TIRED"]["final"]["1sg"] == "ndananiwe" and verbs["HUNGRY"]["final"]["1sg"] == "ndashonje"
    assert verbs["COME"]["imperative"] == "ngwino" and verbs["HELP"]["imperative_me"] == "mfasha"
    assert verbs["GO"]["with_place"]["infinitive"] == "kujya"


def test_the_corpus_decides_the_form_before_an_object_from_first_person_counts():
    lexicon = [
        {"symbols": "I+WANT", "note": "generated:pres_ra:1sg", "corpus_count": "40"},
        {"symbols": "I+WANT", "note": "generated:pres:1sg", "corpus_count": "10"},
        {"symbols": "HE_SHE+WANT", "note": "generated:pres:3sg", "corpus_count": "900"},
        {"symbols": "I+LIKE", "note": "generated:pres:1sg", "corpus_count": "5"},
    ]
    assert corpus_prefers_ra(lexicon) == {"WANT": True, "LIKE": False}


def test_hand_forms_split_affirmative_and_negative_and_keep_the_first():
    aff, neg = hand_forms("nzi=I|uzi=YOU|nari=I|sinzi=I+NOT|ntuzi=YOU+NOT")
    assert aff == {"1sg": "nzi", "2sg": "uzi"} and neg == {"1sg": "sinzi", "2sg": "ntuzi"}


def test_nouns_agree_by_class_and_people_can_be_called(grammar):
    nouns = grammar["nouns"]
    assert nouns["TOILET"]["where"] == "uri he" and nouns["DAD"]["where"] == "ari he"
    assert nouns["SCHOOL"]["where"] == "riri he" and nouns["SCHOOL"]["locative"] == "ku ishuri"
    assert nouns["FRIEND"]["vocative"] == "nshuti"


def test_clips_cover_every_generated_word_and_no_picture_label(grammar):
    labels = {line.split(",")[1] for line in (VOCAB / "symbols.csv").read_text(encoding="utf-8").splitlines()[1:]}
    clips = set(grammar["clips"])
    assert {"ndashaka", "nkunda", "sinkunda", "ngwino", "mfasha", "uri he", "mu rugo", "nshuti", "kujya"} <= clips
    assert not clips & labels
    assert clip_name("uri he") == "uri_he"
    assert len({clip_name(c) for c in clips}) == len(clips)


def test_every_generated_form_is_listed_for_review(grammar):
    rows = review_rows(grammar)
    texts = {row["text"] for row in rows}
    assert set(grammar["clips"]) <= texts
    assert {"symbol_id", "kind", "form", "person", "text"} == set(rows[0])
