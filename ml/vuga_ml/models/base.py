from __future__ import annotations

import json
from abc import ABC, abstractmethod
from pathlib import Path

from .. import EOS


class Predictor(ABC):
    name: str = "base"

    @abstractmethod
    def fit(self, sequences: list[tuple[str, ...]]) -> None: ...

    @abstractmethod
    def scores(self, prefix: tuple[str, ...]) -> dict[str, float]:
        """Unnormalised, non-negative scores over the full training vocabulary (incl. EOS)."""

    def predict(self, prefix: tuple[str, ...], allowed: set[str] | None = None) -> dict[str, float]:
        raw = self.scores(prefix)
        if allowed is not None:
            mask = set(allowed) | {EOS}
            raw = {k: v for k, v in raw.items() if k in mask}
            # symbols enabled on the board but unseen in training still get a floor so the
            # distribution covers the whole enabled vocabulary
            floor = min((v for v in raw.values() if v > 0), default=1.0) * 1e-3
            for k in mask:
                raw.setdefault(k, floor)
        total = sum(raw.values())
        if total <= 0:
            n = len(raw) or 1
            return {k: 1.0 / n for k in raw}
        return {k: v / total for k, v in raw.items()}

    def top_k(self, prefix: tuple[str, ...], k: int = 3, allowed: set[str] | None = None,
              exclude_eos: bool = True) -> list[str]:
        dist = self.predict(prefix, allowed)
        items = [(s, p) for s, p in dist.items() if not (exclude_eos and s == EOS)]
        items.sort(key=lambda kv: (-kv[1], kv[0]))
        return [s for s, _ in items[:k]]

    # --- persistence -------------------------------------------------------------------
    def to_dict(self) -> dict:
        raise NotImplementedError

    @classmethod
    def from_dict(cls, data: dict) -> "Predictor":
        raise NotImplementedError

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.to_dict(), ensure_ascii=False), encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> "Predictor":
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))
