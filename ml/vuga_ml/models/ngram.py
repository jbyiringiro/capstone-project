"""Statistical baselines: unigram frequency and interpolated Kneser-Ney trigram.

Both operate on symbol sequences padded with two BOS tokens and one EOS token. The trigram
implements interpolated Kneser-Ney smoothing with a single absolute discount (Kneser & Ney, 1995;
Chen & Goodman, 1999). It is intentionally small and dependency-free so the same model can be
exported to the talker device (proposal Table 6: "< 2 MB, all devices incl. ESP32").
"""
from __future__ import annotations

from collections import Counter, defaultdict

from .. import BOS, EOS
from .base import Predictor


def _pad(seq: tuple[str, ...], order: int) -> tuple[str, ...]:
    return (BOS,) * (order - 1) + tuple(seq) + (EOS,)


class UnigramFrequency(Predictor):
    """Baseline 1: rank symbols by training frequency regardless of context."""

    name = "unigram"

    def __init__(self) -> None:
        self.counts: Counter = Counter()

    def fit(self, sequences: list[tuple[str, ...]]) -> None:
        self.counts = Counter()
        for seq in sequences:
            self.counts.update(seq)
            self.counts[EOS] += 1

    def scores(self, prefix: tuple[str, ...]) -> dict[str, float]:
        return dict(self.counts)

    def to_dict(self) -> dict:
        return {"type": self.name, "counts": dict(self.counts)}

    @classmethod
    def from_dict(cls, data: dict) -> "UnigramFrequency":
        m = cls()
        m.counts = Counter(data["counts"])
        return m


class KneserNeyTrigram(Predictor):
    """Baseline 2: interpolated Kneser-Ney trigram."""

    name = "kn_trigram"
    order = 3

    def __init__(self, discount: float = 0.75) -> None:
        self.discount = discount
        self.tri: dict[tuple[str, str], Counter] = defaultdict(Counter)   # (w1,w2) -> w3 count
        self.bi_cont: dict[str, Counter] = defaultdict(Counter)          # w2 -> {w3: n distinct w1}
        self.uni_cont: Counter = Counter()                               # w3 -> n distinct (w1?,w2)
        self.vocab: set[str] = set()

    def fit(self, sequences: list[tuple[str, ...]]) -> None:
        self.tri = defaultdict(Counter)
        for seq in sequences:
            p = _pad(seq, self.order)
            self.vocab.update(seq)
            for i in range(2, len(p)):
                self.tri[(p[i - 2], p[i - 1])][p[i]] += 1
        self.vocab.add(EOS)
        # continuation counts
        self.bi_cont = defaultdict(Counter)
        bi_pairs: set[tuple[str, str]] = set()
        for (w1, w2), nxt in self.tri.items():
            for w3 in nxt:
                self.bi_cont[w2][w3] += 1
                bi_pairs.add((w2, w3))
        self.uni_cont = Counter(w3 for _, w3 in bi_pairs)

    # ---- probabilities ------------------------------------------------------------------
    def _p_cont_uni(self, w: str) -> float:
        total = sum(self.uni_cont.values())
        if total == 0:
            return 1.0 / max(len(self.vocab), 1)
        return (self.uni_cont[w] + 1e-9) / (total + 1e-9 * len(self.vocab))

    def _p_bi(self, w2: str, w3: str) -> float:
        nxt = self.bi_cont.get(w2)
        p_uni = self._p_cont_uni(w3)
        if not nxt:
            return p_uni
        total = sum(nxt.values())
        d = self.discount
        lam = d * len(nxt) / total
        return max(nxt[w3] - d, 0) / total + lam * p_uni

    def _p_tri(self, w1: str, w2: str, w3: str) -> float:
        nxt = self.tri.get((w1, w2))
        p_bi = self._p_bi(w2, w3)
        if not nxt:
            return p_bi
        total = sum(nxt.values())
        d = self.discount
        lam = d * len(nxt) / total
        return max(nxt[w3] - d, 0) / total + lam * p_bi

    def scores(self, prefix: tuple[str, ...]) -> dict[str, float]:
        p = _pad(prefix, self.order)[:-1]  # drop the EOS pad; keep BOS padding
        w1, w2 = p[-2], p[-1]
        return {w: self._p_tri(w1, w2, w) for w in self.vocab}

    def to_dict(self) -> dict:
        return {
            "type": self.name,
            "discount": self.discount,
            "vocab": sorted(self.vocab),
            "tri": [[w1, w2, dict(nxt)] for (w1, w2), nxt in self.tri.items()],
        }

    @classmethod
    def from_dict(cls, data: dict) -> "KneserNeyTrigram":
        m = cls(discount=data["discount"])
        m.vocab = set(data["vocab"])
        m.tri = defaultdict(Counter)
        for w1, w2, nxt in data["tri"]:
            m.tri[(w1, w2)] = Counter(nxt)
        # rebuild continuation counts
        m.bi_cont = defaultdict(Counter)
        bi_pairs: set[tuple[str, str]] = set()
        for (w1, w2), nxt in m.tri.items():
            for w3 in nxt:
                m.bi_cont[w2][w3] += 1
                bi_pairs.add((w2, w3))
        m.uni_cont = Counter(w3 for _, w3 in bi_pairs)
        return m
