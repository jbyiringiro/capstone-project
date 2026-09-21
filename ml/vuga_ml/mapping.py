"""Sentence -> symbol-sequence mapping with explicit exclusion reasons (proposal 3.3.2).

A sentence is retained only when
  * it has between MIN_TOKENS and MAX_TOKENS tokens,
  * at least CORE_RATIO of its tokens are resolved by the core-vocabulary lexicon,
  * every token is resolved by the lexicon (mapped to symbols or explicitly DROP),
  * no token is ambiguous,
  * negation is preserved: a token flagged as negated must emit a negation symbol,
  * the resulting symbol sequence is non-empty.
Nothing is dropped silently; every exclusion is counted by reason.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Iterable

from .lexicon import NEGATION_SYMBOLS, Lexicon
from .normalise import tokenise

MIN_TOKENS = 2
MAX_TOKENS = 8
CORE_RATIO = 0.80


@dataclass(frozen=True)
class MappingResult:
    sentence: str             # normalised sentence text
    tokens: tuple[str, ...]
    symbols: tuple[str, ...]  # empty when excluded
    status: str               # "mapped" or an exclusion reason
    detail: str = ""

    @property
    def ok(self) -> bool:
        return self.status == "mapped"


def map_sentence(text: str, lexicon: Lexicon) -> MappingResult:
    tokens = tuple(tokenise(text))
    sentence = " ".join(tokens)
    n = len(tokens)
    if n < MIN_TOKENS:
        return MappingResult(sentence, tokens, (), "too_short")
    if n > MAX_TOKENS:
        return MappingResult(sentence, tokens, (), "too_long")

    # A token counts towards the core ratio when the lexicon resolves it, either to symbols or
    # to an explicit DROP (function word with no cell). Unknown tokens are the only non-core ones.
    core_hits = sum(1 for tok in tokens if lexicon.lookup(tok))
    if core_hits / n < CORE_RATIO:
        return MappingResult(sentence, tokens, (), "low_core_ratio", f"{core_hits}/{n}")

    symbols: list[str] = []
    for tok in tokens:
        rows = lexicon.lookup(tok)
        if not rows:
            return MappingResult(sentence, tokens, (), "unmapped_token", tok)
        if len(rows) > 1:
            return MappingResult(sentence, tokens, (), "ambiguous_token", tok)
        entry = rows[0]
        if entry.negation and not (set(entry.symbols) & NEGATION_SYMBOLS):
            return MappingResult(sentence, tokens, (), "lost_negation", tok)
        symbols.extend(entry.symbols)
    if not symbols:
        return MappingResult(sentence, tokens, (), "empty_after_drop")
    return MappingResult(sentence, tokens, tuple(symbols), "mapped")


def map_corpus(lines: Iterable[str], lexicon: Lexicon) -> tuple[list[MappingResult], Counter]:
    """Map every line; return retained results and a Counter of all statuses (incl. 'mapped')."""
    kept: list[MappingResult] = []
    counts: Counter = Counter()
    for line in lines:
        if not line.strip():
            counts["blank"] += 1
            continue
        res = map_sentence(line, lexicon)
        counts[res.status] += 1
        if res.ok:
            kept.append(res)
    return kept, counts
