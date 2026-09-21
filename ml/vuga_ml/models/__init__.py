"""Next-symbol predictors sharing one interface (proposal 3.3.4).

Every model implements

    fit(sequences: list[tuple[str, ...]]) -> None
    predict(prefix: tuple[str, ...], allowed: set[str] | None = None) -> dict[str, float]

`predict` returns a probability distribution over symbols, renormalised over `allowed` (the
enabled vocabulary of the current profile) plus the end-of-message token. The vocabulary mask
is therefore applied identically to every family, as required for the primary comparison.
"""
from .base import Predictor
from .ngram import KneserNeyTrigram, UnigramFrequency
from .reranker import PersonalReranker

__all__ = ["Predictor", "UnigramFrequency", "KneserNeyTrigram", "PersonalReranker"]
