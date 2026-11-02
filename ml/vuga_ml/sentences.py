"""Grammar table that lets the app speak a picture sequence as a Kinyarwanda sentence.

The board speaks one word per picture, so I + WANT + WATER came out as "njye gushaka amazi". This
module builds, from the same morphology rules that map text to pictures (morphology.py), the forms
the app needs to say "Ndashaka amazi." instead: subject + verb as one inflected word, negatives,
states (ndananiwe), requests (ngwino, mfasha), "where" questions (umusarani uri he) and places
(mu rugo). The app (app/src/grammar/sentence.js) applies the word-order rules; this table only
supplies words, so every form can be listed for review and given its own voice clip.

Which present form goes before an object follows the corpus: verbs whose first-person -ra- form is
more frequent there (ndashaka amazi) keep it, the others use the conjoint form (nkunda injangwe). At the end of a
clause the -ra- form is required (ndashaka). Everything here is a draft until a native speaker has
checked vocab/grammar_forms_review.csv.
"""
from __future__ import annotations

import csv
from collections import defaultdict
from pathlib import Path

from .morphology import SUBJECT, conjoint_present, disjoint_present, negative_present, stem_of

PERSONS = {symbol: person for person, (_, symbol) in SUBJECT.items()}
# Copula agreement for "where is ...?" by noun class (umusarani uri he, papa ari he, ishuri riri he).
COPULA = {1: "ari", 2: "bari", 3: "uri", 4: "iri", 5: "riri", 6: "ari", 7: "kiri", 8: "biri", 9: "iri",
          10: "ziri", 11: "ruri", 12: "kari", 13: "turi", 14: "buri", 15: "kuri", 16: "hari"}
# States are said with the perfective stem: ndananiwe (I am tired), not ndananirwa (I get tired).
STATIVE_STEMS = {"TIRED": "naniwe", "HUNGRY": "shonje", "SICK": "rwaye", "HAPPY": "ishimye",
                 "ANGRY": "rakaye", "HOT": "shyushye", "NEED": "keneye"}
# States that keep the conjoint form before an object: nkeneye amazi (I need water).
STATIVE_CONJOINT_BEFORE = {"NEED"}
# Movement said as happening now, with the perfective stem: ndaje (I'm coming), not ndaza.
NOW_STEMS = {"COME": "je"}
# Verbs whose next verb stays an infinitive: ndashaka kurya, ngiye gukina.
COMPLEMENT_VERBS = ["WANT", "NEED", "LIKE", "CAN", "MUST", "START", "FINISH", "REFUSE", "LEARN", "FORGET", "GO"]
# Verbs a child uses to ask someone to act; after a name or "you" they become a request.
REQUEST_VERBS = ["COME", "HELP", "GIVE", "LOOK", "WAIT", "STOP", "CALL", "BRING", "SIT", "OPEN", "CLOSE",
                 "REPEAT", "HURRY", "HEAR", "TAKE"]
# Requests that can take "me": mfasha (help me), mpa (give me), ndeba (look at me).
ME_REQUESTS = ["HELP", "GIVE", "LOOK", "WAIT", "CALL"]
IRREGULAR_IMPERATIVE = {"COME": "ngwino"}
INTERJECTIONS = ["HELLO", "GOODBYE", "GOOD_MORNING", "GOOD_AFTERNOON", "THANK_YOU", "YES", "NO"]
QUESTIONS = ["WHERE", "WHAT", "WHO", "WHEN", "WHY", "HOW"]
# GO with a destination or another verb uses kujya: ndashaka kujya mu rugo, ngiye gukina.
GO_WITH_PLACE = {
    "infinitive": "kujya",
    "final": {"1sg": "ngiye", "2sg": "ugiye", "3sg": "agiye", "1pl": "tugiye", "2pl": "mugiye", "3pl": "bagiye"},
    "neg": {"1sg": "sinjya", "2sg": "ntujya", "3sg": "ntajya", "1pl": "ntitujya", "2pl": "ntimujya", "3pl": "ntibajya"},
}
VERB_CATEGORIES = {"actions", "feelings", "social"}


def read_csv(path: Path) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def corpus_prefers_ra(lexicon: list[dict]) -> dict[str, bool]:
    """Per verb symbol: is the first-person -ra- present (ndashaka) more frequent than the conjoint
    one (nshaka) in the corpus? First person only: other persons' conjoint forms double as relative
    and subjunctive-like forms (ashaka), which would swamp the count."""
    counts: dict[str, dict[str, int]] = defaultdict(lambda: {"pres": 0, "pres_ra": 0})
    for row in lexicon:
        parts = row["note"].split(":")
        if len(parts) == 3 and parts[0] == "generated" and parts[1] in ("pres", "pres_ra") and parts[2] == "1sg":
            symbols = row["symbols"].split("+")
            if len(symbols) == 2 and symbols[0] == "I":
                counts[symbols[1]][parts[1]] += int(row["corpus_count"] or 0)
    return {verb: c["pres_ra"] > c["pres"] for verb, c in counts.items()}


def hand_forms(spec: str) -> tuple[dict[str, str], dict[str, str]]:
    """lemmas.csv 'forms' such as 'nzi=I|sinzi=I+NOT' -> (affirmative, negative) by person; first wins."""
    aff: dict[str, str] = {}
    neg: dict[str, str] = {}
    for item in filter(None, spec.split("|")):
        surface, symbols = item.split("=")
        parts = symbols.split("+")
        if parts[0] not in PERSONS:
            continue
        target = neg if parts[1:] == ["NOT"] else aff if len(parts) == 1 else None
        if target is not None:
            target.setdefault(PERSONS[parts[0]], surface)
    return aff, neg


def verb_entry(symbol: str, infinitive: str, stem: str | None, forms: str, prefers_ra: bool) -> dict:
    persons = list(SUBJECT)
    if symbol in STATIVE_STEMS:
        perfective = STATIVE_STEMS[symbol]
        final = {p: disjoint_present(p, perfective) for p in persons}
        before = {p: conjoint_present(p, perfective) for p in persons} if symbol in STATIVE_CONJOINT_BEFORE else final
        entry = {"kind": "stative", "final": final, "before": before,
                 "neg": {p: negative_present(p, perfective) for p in persons}}
    elif forms:
        aff, neg = hand_forms(forms)
        entry = {"kind": "irregular", "final": aff, "before": aff, "neg": neg}
    else:
        root = stem_of(infinitive, stem or None)
        final = {p: disjoint_present(p, root) for p in persons}
        before = final if prefers_ra else {p: conjoint_present(p, root) for p in persons}
        entry = {"kind": "regular", "final": final, "before": before, "neg": {p: negative_present(p, root) for p in persons}}
        entry["imperative"] = IRREGULAR_IMPERATIVE.get(symbol, root)
        if symbol in ME_REQUESTS:
            entry["imperative_me"] = conjoint_present("1sg", root)
    if symbol in NOW_STEMS:
        now = {p: disjoint_present(p, NOW_STEMS[symbol]) for p in persons}
        entry["final"], entry["before"] = now, now
    if symbol == "GO":
        # going now (ngiye, ngiye ku ishuri); the bare imperative is genda, from the board's kugenda
        entry["final"], entry["before"], entry["neg"] = GO_WITH_PLACE["final"], GO_WITH_PLACE["final"], GO_WITH_PLACE["neg"]
        entry["imperative"] = "genda"
    if symbol == "HELP":
        entry["imperative_alone"] = entry["imperative_me"]   # a child asking for help means "help me"
    if symbol == "GO":
        entry["with_place"] = GO_WITH_PLACE
    return entry


def build(vocab_dir: Path) -> dict:
    symbols = {row["symbol_id"]: row for row in read_csv(vocab_dir / "symbols.csv")}
    lemmas = {row["symbols"]: row for row in read_csv(vocab_dir / "lemmas.csv") if row["pos"] == "verb" and "+" not in row["symbols"]}
    prefers_ra = corpus_prefers_ra(read_csv(vocab_dir / "lexicon_draft.csv"))
    verbs = {}
    for key, row in symbols.items():
        label = row["label_rw"]
        is_verb = key in lemmas or (row["category"] in VERB_CATEGORIES and label.startswith(("ku", "gu", "kw")))
        if not is_verb or key in PERSONS:
            continue
        lemma = lemmas.get(key, {})
        verbs[key] = verb_entry(key, lemma.get("lemma", label), lemma.get("stem"), lemma.get("forms", ""), prefers_ra.get(key, False))
    nouns = {}
    for row in read_csv(vocab_dir / "grammar_nouns.csv"):
        key = row["symbol_id"]
        if key not in symbols:
            raise ValueError(f"grammar_nouns.csv: unknown symbol {key}")
        noun_class = int(row["noun_class"])
        entry = {"class": noun_class, "where": f"{COPULA[noun_class]} he"}
        if row["vocative"]:
            entry["vocative"] = row["vocative"]
        if row["locative"]:
            entry["locative"] = row["locative"]
        nouns[key] = entry
    for name, keys in (("complement_verbs", COMPLEMENT_VERBS), ("request_verbs", REQUEST_VERBS),
                       ("interjections", INTERJECTIONS), ("questions", QUESTIONS)):
        unknown = [k for k in keys if k not in symbols]
        if unknown:
            raise ValueError(f"{name}: unknown symbols {unknown}")
    grammar = {
        "format": "vuga-kinyarwanda-grammar-v1",
        "review": "draft: generated by rules from vocab/; not yet checked by a native speaker",
        "persons": PERSONS,
        "verbs": verbs,
        "nouns": nouns,
        "complement_verbs": COMPLEMENT_VERBS,
        "request_verbs": [k for k in REQUEST_VERBS if k in verbs],
        "interjections": INTERJECTIONS,
        "questions": QUESTIONS,
    }
    grammar["clips"] = clip_texts(grammar, {row["label_rw"] for row in symbols.values()})
    return grammar


def clip_texts(grammar: dict, labels: set[str]) -> list[str]:
    """Every word or phrase the app can say that is not already a picture's own clip."""
    texts: set[str] = set()
    for entry in grammar["verbs"].values():
        for field in ("final", "before", "neg"):
            texts.update(entry[field].values())
        texts.update(entry[f] for f in ("imperative", "imperative_me", "imperative_alone") if f in entry)
        if "with_place" in entry:
            place = entry["with_place"]
            texts.add(place["infinitive"]); texts.update(place["final"].values()); texts.update(place["neg"].values())
    for entry in grammar["nouns"].values():
        texts.update(entry[f] for f in ("where", "vocative", "locative") if f in entry)
    texts -= labels
    for text in texts:
        if not text or any(c not in "abcdefghijklmnopqrstuvwxyz' " for c in text):
            raise ValueError(f"unexpected characters in generated form {text!r}")
    return sorted(texts)


def clip_name(text: str) -> str:
    """File name of a generated clip: 'uri he' -> 'uri_he'. The app uses the same rule."""
    return text.replace(" ", "_")


def review_rows(grammar: dict) -> list[dict]:
    rows = []
    for key, entry in sorted(grammar["verbs"].items()):
        for field, label in (("final", "affirmative, end of sentence"), ("before", "affirmative, before an object"), ("neg", "negative")):
            for person, form in entry[field].items():
                rows.append({"symbol_id": key, "kind": entry["kind"], "form": label, "person": person, "text": form})
        for field in ("imperative", "imperative_me", "imperative_alone"):
            if field in entry:
                rows.append({"symbol_id": key, "kind": entry["kind"], "form": field.replace("_", " "), "person": "2sg", "text": entry[field]})
        if "with_place" in entry:
            rows.append({"symbol_id": key, "kind": entry["kind"], "form": "infinitive before a place or verb", "person": "", "text": entry["with_place"]["infinitive"]})
    for key, entry in sorted(grammar["nouns"].items()):
        for field in ("where", "vocative", "locative"):
            if field in entry:
                rows.append({"symbol_id": key, "kind": f"noun class {entry['class']}", "form": field, "person": "", "text": entry[field]})
    return rows
