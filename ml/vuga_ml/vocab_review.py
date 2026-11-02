"""Vocabulary validation (RQ1): summarise the adults' review sheets into proposed decisions.

RQ1 asks how suitable the adults judge the draft vocabulary to be and which symbols they would add,
revise or remove (proposal 1.4 and 3.2.3). Inputs are transcribed from the paper forms and carry
study codes only:

    reviews.csv   participant, symbol_id, picture, word, better_word, decision
                  one row per adult and reviewed word (vocabulary review sheet)
                  picture: yes | unsure | no      word: yes | no      decision: K | C | R
                  (keep / change / remove); the Kinyarwanda sheet's words are accepted as written
                  (yego | sinzi neza | oya; rigumeho | rihindurwe | rikurweho); a blank answer is
                  left out of that question's count
    mentions.csv  participant, kind, item         (optional)
                  kind 'hard': item is a symbol_id an adult found hard to find or understand
                  (post-task interview, asked of every participant)
                  kind 'add': item is a word an adult would add first (needs and vocabulary interview)

Each reviewed word gets a proposed status from simple majorities, fixed before any data are seen:

    exclude     more than half of the decisions are R
    accept      more than half are K, and fewer than half of the answers say the picture or the
                word is wrong
    revise      more than half are C or R, or at least half say the picture or the word is wrong
    unresolved  anything else (a split), and words with no decision

The status is only a proposal. The decision log records what the native speakers and the researcher
decide, and the needs adults describe are reported as context, not as findings.
"""
from __future__ import annotations

import csv
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

PICTURE = {"yes": "yes", "unsure": "unsure", "no": "no", "yego": "yes", "sinzi neza": "unsure", "oya": "no"}
WORD = {"yes": "yes", "no": "no", "yego": "yes", "oya": "no"}
DECISION = {"k": "K", "keep": "K", "rigumeho": "K", "c": "C", "change": "C", "rihindurwe": "C",
            "r": "R", "remove": "R", "rikurweho": "R"}
STATUSES = ("accept", "revise", "exclude", "unresolved")
MENTION_KINDS = {"hard", "add"}


class ReviewDataError(ValueError):
    """A transcribed sheet does not match the expected columns or answers."""


@dataclass
class WordReview:
    symbol_id: str
    label_rw: str
    picture: Counter = field(default_factory=Counter)
    word: Counter = field(default_factory=Counter)
    decision: Counter = field(default_factory=Counter)
    better_words: Counter = field(default_factory=Counter)
    reviewers: set = field(default_factory=set)
    hard_mentions: set = field(default_factory=set)

    @property
    def status(self) -> str:
        decided = sum(self.decision.values())
        if not decided:
            return "unresolved"
        if self.decision["R"] * 2 > decided:
            return "exclude"
        problem = _at_least_half(self.picture, "no") or _at_least_half(self.word, "no")
        if self.decision["K"] * 2 > decided and not problem:
            return "accept"
        if (self.decision["C"] + self.decision["R"]) * 2 > decided or problem:
            return "revise"
        return "unresolved"

    def as_dict(self) -> dict:
        return {
            "symbol_id": self.symbol_id, "label_rw": self.label_rw, "reviewers": len(self.reviewers),
            "picture": {k: self.picture[k] for k in ("yes", "unsure", "no")},
            "word": {k: self.word[k] for k in ("yes", "no")},
            "decision": {k: self.decision[k] for k in ("K", "C", "R")},
            "better_words": self.better_words.most_common(),
            "hard_mentions": len(self.hard_mentions),
            "proposed": self.status,
        }


def _at_least_half(answers: Counter, value: str) -> bool:
    answered = sum(answers.values())
    return answered > 0 and answers[value] * 2 >= answered


def normalise_word(text: str) -> str:
    return " ".join(text.strip().lower().split())


def read_csv(path: Path) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def load_symbols(path: Path) -> dict[str, str]:
    return {row["symbol_id"]: row["label_rw"] for row in read_csv(path)}


def load_review_words(path: Path) -> list[str]:
    rows = read_csv(path)
    if rows and "symbol_id" not in rows[0]:
        raise ReviewDataError(f"{path} must have a symbol_id header")
    return [row["symbol_id"].strip() for row in rows if row["symbol_id"].strip()]


def _require(row: dict, columns: tuple[str, ...], line: int) -> None:
    missing = [c for c in columns if c not in row]
    if missing:
        raise ReviewDataError(f"line {line}: missing column(s) {', '.join(missing)}")


def collect(reviews: list[dict], symbols: dict[str, str], mentions: list[dict] | None = None,
            order: list[str] | None = None) -> tuple[list[WordReview], Counter, dict[str, set]]:
    """Validate the transcribed rows and gather counts per word. Line numbers count the header as 1."""
    words: dict[str, WordReview] = {}
    seen: set[tuple[str, str]] = set()
    for line, row in enumerate(reviews, start=2):
        _require(row, ("participant", "symbol_id", "picture", "word", "better_word", "decision"), line)
        participant, key = row["participant"].strip(), row["symbol_id"].strip()
        if not participant:
            raise ReviewDataError(f"line {line}: participant code is empty")
        if key not in symbols:
            raise ReviewDataError(f"line {line}: unknown symbol_id {key!r}")
        if (participant, key) in seen:
            raise ReviewDataError(f"line {line}: {participant} already reviewed {key}")
        seen.add((participant, key))
        picture, word = normalise_word(row["picture"]), normalise_word(row["word"])
        decision = normalise_word(row["decision"])
        if picture and picture not in PICTURE:
            raise ReviewDataError(f"line {line}: picture must be yes, unsure or no, not {row['picture']!r}")
        if word and word not in WORD:
            raise ReviewDataError(f"line {line}: word must be yes or no, not {row['word']!r}")
        if decision and decision not in DECISION:
            raise ReviewDataError(f"line {line}: decision must be K, C or R, not {row['decision']!r}")
        review = words.setdefault(key, WordReview(key, symbols[key]))
        review.reviewers.add(participant)
        if picture:
            review.picture[PICTURE[picture]] += 1
        if word:
            review.word[WORD[word]] += 1
        if decision:
            review.decision[DECISION[decision]] += 1
        if better := normalise_word(row["better_word"]):
            review.better_words[better] += 1

    hard: Counter = Counter()
    additions: dict[str, set] = defaultdict(set)
    hard_by: dict[str, set] = defaultdict(set)
    for line, row in enumerate(mentions or [], start=2):
        _require(row, ("participant", "kind", "item"), line)
        participant, kind = row["participant"].strip(), row["kind"].strip().lower()
        if not participant:
            raise ReviewDataError(f"mentions line {line}: participant code is empty")
        if kind not in MENTION_KINDS:
            raise ReviewDataError(f"mentions line {line}: kind must be hard or add, not {row['kind']!r}")
        if kind == "hard":
            key = row["item"].strip()
            if key not in symbols:
                raise ReviewDataError(f"mentions line {line}: unknown symbol_id {key!r}")
            hard_by[key].add(participant)
        elif item := normalise_word(row["item"]):
            additions[item].add(participant)
    for key, people in hard_by.items():
        hard[key] = len(people)
        if key in words:
            words[key].hard_mentions = people

    rank = {key: i for i, key in enumerate(order or [])}
    ordered = sorted(words.values(), key=lambda w: (rank.get(w.symbol_id, len(rank)), w.symbol_id))
    return ordered, hard, additions


def analyse(reviews: list[dict], symbols: dict[str, str], mentions: list[dict] | None = None,
            order: list[str] | None = None) -> dict:
    words, hard, additions = collect(reviews, symbols, mentions, order)
    labels = {normalise_word(label) for label in symbols.values()}
    status = Counter(w.status for w in words)
    missing = [key for key in (order or []) if key not in {w.symbol_id for w in words}]
    return {
        "participants": len({row["participant"].strip() for row in reviews}),
        "rule": "exclude: R > 1/2; accept: K > 1/2 and picture/word 'no' < 1/2; "
                "revise: C+R > 1/2 or picture/word 'no' >= 1/2; otherwise unresolved",
        "summary": {s: status[s] for s in STATUSES},
        "not_reviewed": missing,
        "words": [w.as_dict() for w in words],
        "hard_to_find": [[key, n] for key, n in sorted(hard.items(), key=lambda kv: (-kv[1], kv[0]))],
        "additions": [{"word": word, "participants": len(people), "already_on_board": word in labels}
                      for word, people in sorted(additions.items(), key=lambda kv: (-len(kv[1]), kv[0]))],
    }


def decision_rows(report: dict, date: str) -> list[str]:
    """Draft rows for vocab/decision_log.md, to be confirmed or changed by the reviewers."""
    by = "proposed by analyse_vocabulary_review.py; confirm"
    rows = []
    for w in report["words"]:
        d, p, word = w["decision"], w["picture"], w["word"]
        reason = (f"K {d['K']}, C {d['C']}, R {d['R']}; picture no {p['no']}/{sum(p.values())}; "
                  f"word no {word['no']}/{sum(word.values())}; hard to find {w['hard_mentions']}")
        change = {"accept": "Accept", "exclude": "Exclude", "unresolved": "Unresolved: discuss"}.get(w["proposed"], "Revise")
        if w["proposed"] == "revise" and w["better_words"]:
            best, count = w["better_words"][0]
            change = f"Revise: label to '{best}'? ({count} suggested)"
        rows.append(f"| {date} | symbols.csv | {w['symbol_id']} ({w['label_rw']}) | {change} | {reason} | {by} |")
    for a in report["additions"]:
        if not a["already_on_board"]:
            rows.append(f"| {date} | symbols.csv | new: {a['word']} | Consider adding | named by {a['participants']} adult(s) | {by} |")
    return rows


def template_rows(review_words: list[str]) -> list[dict]:
    return [{"participant": "", "symbol_id": key, "picture": "", "word": "", "better_word": "", "decision": ""}
            for key in review_words]
