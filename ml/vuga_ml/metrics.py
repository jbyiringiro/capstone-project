"""Evaluation metrics (proposal 3.2.3 and 3.2.5).

  * top-k accuracy: the next symbol is among the k suggestions (k = 1, 3, 5).
  * perplexity: exp(mean negative log probability of the true next symbol, incl. EOS).
  * simulated KSR: 1 - predictive_actions / static_actions over the same messages, using a
    board layout simulator that reproduces the board's section tabs, its fixed pages and
    suggestion selection.
  * paired bootstrap of complete test sentences for accuracy-difference intervals.
"""
from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass
from pathlib import Path

from . import EOS
from .models.base import Predictor


@dataclass
class SequenceScore:
    hits: dict[int, int]     # k -> number of correct predictions
    n: int                   # number of prediction events
    nll: float               # summed negative log prob


def score_sequence(model: Predictor, seq: tuple[str, ...], ks=(1, 3, 5),
                   allowed: set[str] | None = None) -> SequenceScore:
    hits = {k: 0 for k in ks}
    nll = 0.0
    targets = tuple(seq) + (EOS,)
    for i, target in enumerate(targets):
        prefix = tuple(seq[:i])
        dist = model.predict(prefix, allowed)
        p = dist.get(target, 1e-12)
        nll += -math.log(max(p, 1e-12))
        if target != EOS:
            ranked = sorted(((s, q) for s, q in dist.items() if s != EOS),
                            key=lambda kv: (-kv[1], kv[0]))
            for k in ks:
                if target in [s for s, _ in ranked[:k]]:
                    hits[k] += 1
    return SequenceScore(hits, len(seq), nll)


def aggregate(scores: list[SequenceScore], ks=(1, 3, 5)) -> dict:
    n = sum(s.n for s in scores) or 1
    n_tok = sum(s.n + 1 for s in scores) or 1  # includes EOS events
    out = {f"top{k}": sum(s.hits[k] for s in scores) / n for k in ks}
    out["perplexity"] = math.exp(sum(s.nll for s in scores) / n_tok)
    out["n_events"] = n
    return out


def paired_bootstrap(a: list[SequenceScore], b: list[SequenceScore], k: int = 3,
                     iters: int = 2000, seed: int = 0) -> dict:
    """95% interval for top-k(a) - top-k(b), resampling whole sentences."""
    assert len(a) == len(b)
    rng = random.Random(seed)
    idx = list(range(len(a)))
    diffs = []
    for _ in range(iters):
        sample = [rng.choice(idx) for _ in idx]
        na = sum(a[i].n for i in sample) or 1
        ha = sum(a[i].hits[k] for i in sample) / na
        hb = sum(b[i].hits[k] for i in sample) / na
        diffs.append(ha - hb)
    diffs.sort()
    lo = diffs[int(0.025 * iters)]
    hi = diffs[int(0.975 * iters) - 1]
    point = aggregate(a, (k,))[f"top{k}"] - aggregate(b, (k,))[f"top{k}"]
    return {"k": k, "diff": point, "ci95": [lo, hi], "iters": iters}


# ---- simulated keystroke savings -----------------------------------------------------------
Place = tuple[str, int]  # (section, page) on the board


@dataclass
class BoardLayout:
    """The child's board as the app draws it (app/src/board/): section tabs above a grid of fixed
    pages of `page_size` keys. A tab opens its section at the first page with one tap, from any
    section, and each page arrow or swipe turns one page. A hidden word keeps its slot (None) and
    a page with nothing to show is skipped, as in grid-pages.js. The board opens at the first
    section, and Speak takes it back there. app/scripts/export-board-layout.mjs writes the app's
    own sections for `from_json`."""

    sections: dict[str, list[str | None]]
    page_size: int = 20  # columns x rows: 4 to 40 keys (NFR3)

    def __post_init__(self) -> None:
        self.start: Place = (next(iter(self.sections)), 0)
        self.places: dict[str, list[Place]] = {}
        for section, slots in self.sections.items():
            pages = [slots[i:i + self.page_size] for i in range(0, len(slots), self.page_size)]
            shown = [page for page in pages if any(key is not None for key in page)]
            for number, page in enumerate(shown):
                for key in page:
                    if key is not None:
                        self.places.setdefault(key, []).append((section, number))

    @classmethod
    def from_json(cls, path: str | Path, page_size: int = 20) -> BoardLayout:
        return cls(json.loads(Path(path).read_text(encoding="utf-8"))["sections"], page_size)

    def moves(self, symbol: str, at: Place) -> list[tuple[int, Place]]:
        """Each way to select `symbol` with the board at `at`: (taps, where the board is after)."""
        if symbol not in self.places:
            raise KeyError(symbol)

        def taps(place: Place) -> int:
            section, page = place
            if section == at[0]:
                return abs(page - at[1]) + 1  # page turns, then the word
            return 1 + page + 1  # the tab, page turns from its first page, the word
        return [(taps(place), place) for place in self.places[symbol]]


def simulate_message(model: Predictor | None, layout: BoardLayout, seq: tuple[str, ...],
                     k: int = 3, allowed: set[str] | None = None) -> int:
    """Fewest all-action taps to compose `seq` and press Speak, from the board's first section.

    Static board: model is None. Predictive board: a word in the top-k suggestions can be selected
    with one tap that leaves the open section and page as they were (it bypasses navigation,
    proposal 3.2.3); going to the word stays possible. A word on several sections may be reached
    from any of them, so the fewest taps are kept for each section page the board can be on
    (dynamic programming), as app/scripts/study-message-sets.mjs does for the study's messages.
    """
    states: dict[Place, int] = {layout.start: 0}
    for i, sym in enumerate(seq):
        suggested = model is not None and sym in model.top_k(tuple(seq[:i]), k, allowed)
        reached: dict[Place, int] = {}
        for at, taps in states.items():
            for cost, place in layout.moves(sym, at) + ([(1, at)] if suggested else []):
                if taps + cost < reached.get(place, math.inf):
                    reached[place] = taps + cost
        states = reached
    return min(states.values()) + 1  # Speak


def simulated_ksr(model: Predictor, layout: BoardLayout, seqs: list[tuple[str, ...]],
                  k: int = 3, allowed: set[str] | None = None) -> dict:
    static = sum(simulate_message(None, layout, s, k, allowed) for s in seqs)
    pred = sum(simulate_message(model, layout, s, k, allowed) for s in seqs)
    return {"static_actions": static, "predictive_actions": pred,
            "ksr": 1 - pred / static if static else 0.0, "messages": len(seqs)}
