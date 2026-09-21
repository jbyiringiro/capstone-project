"""Expand vocab/lemmas.csv into vocab/lexicon_draft.csv and vocab/symbols_draft.csv.

  * verb rows are conjugated with vuga_ml.morphology (regular paradigms only) plus any explicit
    `forms`; noun/word rows add the lemma and the explicit forms; drop rows become DROP entries.
  * every generated row carries a `note` (generated:<paradigm>:<person> or explicit) and, when
    ml/data/processed/token_frequency.csv exists, its corpus count so reviewers see what matters.
  * ambiguous surfaces (same surface, different symbols) are reported, not silently resolved.

The drafts are reviewed by the native-speaker collaborators; accepted rows are copied to
vocab/lexicon.csv and vocab/symbols.csv with the decision recorded in vocab/decision_log.md.

Usage: python ml/scripts/build_lexicon.py
"""
from __future__ import annotations

import csv
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vuga_ml.morphology import SUBJECT, conjugate  # noqa: E402
from vuga_ml.normalise import tokenise  # noqa: E402

VOCAB = ROOT.parent / "vocab"
FREQ = ROOT / "data" / "processed" / "token_frequency.csv"

PERSON_SYMBOLS = {
    "I": ("njye", "I", "people"), "YOU": ("wowe", "you", "people"),
    "HE_SHE": ("we", "he / she", "people"), "WE": ("twe", "we", "people"),
    "YOU_PL": ("mwe", "you (plural)", "people"), "THEY": ("bo", "they", "people"),
    "NOT": ("ntabwo", "not", "core"),
}
CATEGORY_BY_POS = {"verb": "actions", "noun": "things", "word": "core", "drop": None}
CATEGORY_OVERRIDE = {
    **{s: "people" for s in ["MUM", "DAD", "TEACHER", "CHILD", "FRIEND", "GIRL", "BOY", "DOCTOR"]},
    **{s: "food_drink" for s in ["WATER", "MILK", "FOOD", "BREAD", "FRUIT", "BANANA", "TEA", "RICE", "BEANS", "POTATOES", "MEAT", "SUGAR"]},
    **{s: "places" for s in ["SCHOOL", "HOME", "HOUSE", "TOILET", "PLAYGROUND", "ROAD"]},
    **{s: "animals" for s in ["DOG", "CAT", "COW", "CHICKEN", "BIRD"]},
    **{s: "body" for s in ["HEAD", "HAND", "LEG", "EYE", "EAR", "STOMACH", "TOOTH", "MOUTH", "NOSE", "HAIR"]},
    **{s: "clothes" for s in ["SHIRT", "SHOES", "TROUSERS", "CLOTHES"]},
    **{s: "feelings" for s in ["HAPPY", "SICK", "HURT", "HUNGRY", "COLD", "HOT", "TIRED", "AFRAID", "ANGRY", "CRY", "LAUGH"]},
    **{s: "describe" for s in ["GOOD", "BAD", "VERY", "SLOWLY", "QUICKLY", "MANY", "FEW", "BIG", "SMALL", "NEW", "ALL", "ONLY"]},
    **{s: "questions" for s in ["WHERE", "WHAT", "WHO", "WHEN", "WHY", "HOW"]},
    **{s: "time_place" for s in ["HERE", "THERE", "NOW", "TOMORROW", "AGAIN", "NIGHT", "MORNING", "EVENING", "RAIN", "SUN", "TIME", "BEFORE", "AFTER"]},
    **{s: "people" for s in ["PERSON"]}, **{s: "core" for s in ["PROBLEM", "BE"]},
    **{s: "social" for s in ["YES", "NO", "THANK_YOU", "HELLO", "GOOD_MORNING", "GOOD_AFTERNOON", "GOODBYE", "HELP"]},
}


def load_counts() -> dict[str, int]:
    if not FREQ.exists():
        return {}
    with open(FREQ, encoding="utf-8", newline="") as fh:
        return {r["surface"]: int(r["count"]) for r in csv.DictReader(fh)}


def main() -> None:
    counts = load_counts()
    rows: list[dict] = []
    symbols: dict[str, tuple[str, str, str]] = {}

    def add(surface: str, lemma: str, syms: str, neg: bool, note: str) -> None:
        toks = tokenise(surface)
        if len(toks) != 1:
            # multi-word forms (mu rugo) are not single tokens; kept for the record but skipped
            note += "; SKIPPED multiword"
            rows.append({"surface": surface, "lemma": lemma, "symbols": syms, "negation": int(neg),
                         "note": note, "corpus_count": ""})
            return
        surface = toks[0]
        rows.append({"surface": surface, "lemma": lemma, "symbols": syms, "negation": int(neg),
                     "note": note, "corpus_count": counts.get(surface, 0)})

    with open(VOCAB / "lemmas.csv", encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh):
            lemma, pos = r["lemma"].strip(), r["pos"].strip()
            syms = r["symbols"].strip()
            forms = [f.strip() for f in (r.get("forms") or "").split("|") if f.strip()]
            neg = syms == "NOT"
            if pos == "verb":
                sym = syms
                add(lemma, lemma, sym, False, "infinitive")
                for f in conjugate(lemma, sym, stem=r.get("stem") or None):
                    add(f.surface, lemma, "+".join(f.symbols), f.negation,
                        f"generated:{f.paradigm}:{f.person}")
                for f in forms:
                    # explicit forms: "surface=I" or "surface=I+NOT" prefixes person (and negation)
                    if "=" in f:
                        surface, prefix = f.split("=", 1)
                        add(surface, lemma, prefix + "+" + sym, "NOT" in prefix.split("+"), "explicit form")
                    else:
                        add(f, lemma, sym, False, "explicit form (no person encoded; review)")
                symbols.setdefault(sym, (lemma, sym.lower().replace("_", " "), "actions"))
            elif pos == "drop":
                add(lemma, lemma, "DROP", False, r.get("note") or "function word")
            else:
                add(lemma, lemma, syms, neg, "lemma")
                for f in forms:
                    add(f, lemma, syms, neg, "explicit form")
                symbols.setdefault(syms, (lemma, syms.lower().replace("_", " "),
                                          CATEGORY_BY_POS[pos]))
    for sym, (rw, en, cat) in PERSON_SYMBOLS.items():
        symbols.setdefault(sym, (rw, en, cat))

    # a generated verb form never overrides a hand-written row for the same surface (rya, za)
    explicit = {r["surface"] for r in rows if not r["note"].startswith("generated")}
    rows = [r for r in rows if not (r["note"].startswith("generated") and r["surface"] in explicit)]

    # ambiguity report
    by_surface: dict[str, set[str]] = defaultdict(set)
    for r in rows:
        if r["corpus_count"] != "":
            by_surface[r["surface"]].add(r["symbols"])
    ambiguous = {s: v for s, v in by_surface.items() if len(v) > 1}

    with open(VOCAB / "lexicon_draft.csv", "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["surface", "lemma", "symbols", "negation", "note", "corpus_count"])
        w.writeheader(); w.writerows(rows)
    # keep pictogram ids already chosen (fetch_pictograms.py or the collaborators)
    keep: dict[str, tuple[str, str]] = {}
    for name in ("symbols.csv", "symbols_draft.csv"):
        if (VOCAB / name).exists():
            for x in csv.DictReader(open(VOCAB / name, encoding="utf-8", newline="")):
                if x.get("arasaac_id"):
                    keep.setdefault(x["symbol_id"], (x["arasaac_id"], x["image_path"]))
    with open(VOCAB / "symbols_draft.csv", "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["symbol_id", "label_rw", "label_en", "category", "arasaac_id", "image_path"])
        for sym in sorted(symbols):
            rw, en, cat = symbols[sym]
            aid, img = keep.get(sym, ("", ""))
            w.writerow([sym, rw, en, CATEGORY_OVERRIDE.get(sym, cat), aid, img])

    single = [r for r in rows if r["corpus_count"] != ""]
    total = sum(counts.values()) or 1
    covered = sum(counts.get(s, 0) for s in {r["surface"] for r in single})
    print(f"lexicon_draft.csv: {len(single)} single-token rows ({len(rows) - len(single)} multiword skipped)")
    print(f"symbols_draft.csv: {len(symbols)} symbols")
    print(f"coverage of token occurrences in 2-8 token sentences: {covered / total:.1%}")
    zero = sum(1 for r in single if r["corpus_count"] == 0)
    print(f"generated forms never seen in the corpus: {zero} (review these first)")
    if ambiguous:
        print(f"AMBIGUOUS surfaces ({len(ambiguous)}): " + ", ".join(f"{s}={sorted(v)}" for s, v in list(ambiguous.items())[:20]))


if __name__ == "__main__":
    main()
