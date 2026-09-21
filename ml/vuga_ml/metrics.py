"""Evaluation metrics (proposal 3.2.3 and 3.2.5).

  * top-k accuracy: the next symbol is among the k suggestions (k = 1, 3, 5).
  * perplexity: exp(mean negative log probability of the true next symbol, incl. EOS).
  * simulated KSR: 1 - predictive_actions / static_actions over the same messages, using a
    board layout simulator that reproduces category navigation and suggestion selection.
  * paired bootstrap of complete test sentences for accuracy-difference intervals.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass

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
@dataclass
class BoardLayout:
    """Category -> ordered symbol list. Home board shows categories plus any home symbols."""
    categories: dict[str, list[str]]
    home_symbols: list[str]

    def actions_to_select(self, symbol: str, current_category: str | None) -> tuple[int, str | None]:
        """Actions needed on a static board: (taps, category after selection)."""
        if symbol in self.home_symbols:
            back = 1 if current_category is not None else 0  # return home first
            return back + 1, None
        for cat, syms in self.categories.items():
            if symbol in syms:
                if current_category == cat:
                    return 1, cat
                back = 1 if current_category is not None else 0
                return back + 2, cat  # home -> category -> symbol
        raise KeyError(symbol)


def simulate_message(model: Predictor | None, layout: BoardLayout, seq: tuple[str, ...],
                     k: int = 3, allowed: set[str] | None = None) -> int:
    """Count all-action taps to compose `seq` and press Speak.

    Static board: model is None. Predictive board: a suggestion in the top-k is selected with one
    tap and does not change the current category (it bypasses navigation, proposal 3.2.3).
    """
    taps = 0
    cat: str | None = None
    for i, sym in enumerate(seq):
        if model is not None and sym in model.top_k(tuple(seq[:i]), k, allowed):
            taps += 1
            continue
        t, cat = layout.actions_to_select(sym, cat)
        taps += t
    return taps + 1  # Speak


def simulated_ksr(model: Predictor, layout: BoardLayout, seqs: list[tuple[str, ...]],
                  k: int = 3, allowed: set[str] | None = None) -> dict:
    static = sum(simulate_message(None, layout, s, k, allowed) for s in seqs)
    pred = sum(simulate_message(model, layout, s, k, allowed) for s in seqs)
    return {"static_actions": static, "predictive_actions": pred,
            "ksr": 1 - pred / static if static else 0.0, "messages": len(seqs)}
