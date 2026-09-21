"""Personal re-ranker: frequency, recency and context scoring applied on top of a frozen model.

score(s) = log p_model(s | prefix)
         + w_freq * log(1 + personal_count[s])
         + w_rec  * exp(-(now - last_used[s]) / tau)
         + w_ctx  * log(1 + personal_bigram[(prefix[-1], s)])

Weights are chosen on validation data and then frozen for the study (proposal 3.3.2, 3.3.4).
History is updated only from the child's own selections made *before* the prediction, never
from static-condition trials, and never from the evaluation logs being scored.
"""
from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field

from .base import Predictor


@dataclass
class PersonalHistory:
    counts: Counter = field(default_factory=Counter)
    bigrams: Counter = field(default_factory=Counter)
    last_used: dict[str, float] = field(default_factory=dict)

    def record(self, prefix: tuple[str, ...], symbol: str, t: float) -> None:
        self.counts[symbol] += 1
        if prefix:
            self.bigrams[(prefix[-1], symbol)] += 1
        self.last_used[symbol] = t


@dataclass
class PersonalReranker:
    model: Predictor
    w_freq: float = 0.3
    w_rec: float = 0.3
    w_ctx: float = 0.5
    tau: float = 3600.0  # seconds

    def predict(self, prefix: tuple[str, ...], history: PersonalHistory, now: float,
                allowed: set[str] | None = None) -> dict[str, float]:
        base = self.model.predict(prefix, allowed)
        out: dict[str, float] = {}
        for s, p in base.items():
            score = math.log(max(p, 1e-12))
            score += self.w_freq * math.log1p(history.counts[s])
            if s in history.last_used:
                score += self.w_rec * math.exp(-max(now - history.last_used[s], 0.0) / self.tau)
            if prefix:
                score += self.w_ctx * math.log1p(history.bigrams[(prefix[-1], s)])
            out[s] = score
        m = max(out.values())
        exp = {s: math.exp(v - m) for s, v in out.items()}
        z = sum(exp.values())
        return {s: v / z for s, v in exp.items()}

    def top_k(self, prefix, history, now, k=3, allowed=None, exclude_eos=True):
        from .. import EOS
        dist = self.predict(prefix, history, now, allowed)
        items = [(s, p) for s, p in dist.items() if not (exclude_eos and s == EOS)]
        items.sort(key=lambda kv: (-kv[1], kv[0]))
        return [s for s, _ in items[:k]]
