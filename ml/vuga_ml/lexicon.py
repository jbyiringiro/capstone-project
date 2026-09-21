"""Lexicon: maps Kinyarwanda surface forms to core-vocabulary symbols.

CSV columns (UTF-8, header row):
  surface   normalised surface form as produced by normalise.tokenise (required)
  lemma     dictionary form used for the core-vocabulary ratio (required)
  symbols   one or more symbol ids separated by '+' (e.g. "NOT+WANT" for sinshaka);
            the literal value DROP marks a token that may be omitted (pure function words)
  negation  1 if the surface form carries negation, otherwise 0 or empty
  note      free text

A surface form that appears in more than one row with different symbol strings is ambiguous,
and every sentence containing it is excluded by mapping (proposal 3.3.2).
"""
from __future__ import annotations

import csv
from dataclasses import dataclass, field
from pathlib import Path

DROP = "DROP"
NEGATION_SYMBOLS = {"NOT"}


@dataclass(frozen=True)
class Entry:
    surface: str
    lemma: str
    symbols: tuple[str, ...]  # empty tuple means DROP
    negation: bool = False


@dataclass
class Lexicon:
    entries: dict[str, list[Entry]] = field(default_factory=dict)
    core_lemmas: set[str] = field(default_factory=set)

    def add(self, entry: Entry) -> None:
        rows = self.entries.setdefault(entry.surface, [])
        if all(r.symbols != entry.symbols for r in rows):
            rows.append(entry)
        if entry.symbols:
            self.core_lemmas.add(entry.lemma)

    def lookup(self, surface: str) -> list[Entry]:
        return self.entries.get(surface, [])

    @property
    def symbol_ids(self) -> set[str]:
        out: set[str] = set()
        for rows in self.entries.values():
            for r in rows:
                out.update(r.symbols)
        return out

    @classmethod
    def from_csv(cls, path: str | Path) -> "Lexicon":
        lex = cls()
        with open(path, encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh):
                surface = (row.get("surface") or "").strip().lower()
                if not surface:
                    continue
                raw = (row.get("symbols") or "").strip()
                if raw.upper() == DROP:
                    symbols: tuple[str, ...] = ()
                else:
                    symbols = tuple(s.strip() for s in raw.split("+") if s.strip())
                    if not symbols:
                        raise ValueError(f"bad symbols cell for {surface!r}: {raw!r}")
                neg = (row.get("negation") or "").strip().lower() in {"1", "true", "yes"}
                lemma = (row.get("lemma") or surface).strip().lower()
                lex.add(Entry(surface, lemma, symbols, neg))
        return lex

    @classmethod
    def from_rows(cls, rows: list[tuple]) -> "Lexicon":
        """Convenience for tests: rows of (surface, lemma, symbols_str[, negation])."""
        lex = cls()
        for row in rows:
            surface, lemma, raw = row[0], row[1], row[2]
            neg = bool(row[3]) if len(row) > 3 else False
            symbols = () if raw.upper() == DROP else tuple(raw.split("+"))
            lex.add(Entry(surface, lemma, symbols, neg))
        return lex
