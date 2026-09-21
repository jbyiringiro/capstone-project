"""Deduplication and stratified 80/10/10 split (proposal 3.3.2).

  * Exact duplicates: identical normalised sentences are collapsed to one example.
  * Template variants: examples sharing the same symbol sequence are kept in ONE partition, so
    a sequence seen in training cannot reappear verbatim in validation or test.
  * Stratification: groups are bucketed by symbol-sequence length before a seeded shuffle, so
    each partition has a similar length distribution.
The seed and the resulting partition assignment are written with the data, so a later
vocabulary revision produces a documented new split rather than a silent one.
"""
from __future__ import annotations

import random
from collections import defaultdict
from dataclasses import dataclass

from .mapping import MappingResult

RATIOS = (0.8, 0.1, 0.1)
PARTS = ("train", "validation", "test")


@dataclass
class SplitResult:
    train: list[MappingResult]
    validation: list[MappingResult]
    test: list[MappingResult]
    seed: int
    n_input: int
    n_unique: int
    n_groups: int

    def as_dict(self) -> dict[str, list[MappingResult]]:
        return {"train": self.train, "validation": self.validation, "test": self.test}


def deduplicate(results: list[MappingResult]) -> list[MappingResult]:
    seen: set[str] = set()
    out: list[MappingResult] = []
    for r in results:
        if r.sentence in seen:
            continue
        seen.add(r.sentence)
        out.append(r)
    return out


def split(results: list[MappingResult], seed: int = 20260921, ratios=RATIOS) -> SplitResult:
    unique = deduplicate(results)
    groups: dict[tuple[str, ...], list[MappingResult]] = defaultdict(list)
    for r in unique:
        groups[r.symbols].append(r)

    by_length: dict[int, list[tuple[str, ...]]] = defaultdict(list)
    for key in groups:
        by_length[len(key)].append(key)

    rng = random.Random(seed)
    parts: dict[str, list[MappingResult]] = {p: [] for p in PARTS}
    for length in sorted(by_length):
        keys = sorted(by_length[length])
        rng.shuffle(keys)
        n = len(keys)
        n_train = round(n * ratios[0])
        n_val = round(n * ratios[1])
        cuts = [(0, n_train), (n_train, n_train + n_val), (n_train + n_val, n)]
        for part, (a, b) in zip(PARTS, cuts):
            for key in keys[a:b]:
                parts[part].extend(groups[key])
    return SplitResult(parts["train"], parts["validation"], parts["test"],
                       seed, len(results), len(unique), len(groups))
