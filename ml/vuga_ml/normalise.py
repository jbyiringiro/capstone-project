"""Sentence normalisation for the Kinyarwanda corpus.

Rules (recorded here because they are part of the frozen preprocessing):
  1. Unicode NFC, lower case.
  2. Curly apostrophes and backticks become a straight apostrophe; the apostrophe is kept
     inside a token because Kinyarwanda elision joins words (n'abana, y'umwana).
  3. Every other punctuation mark and every digit is a token boundary and is discarded.
  4. Tokens are maximal runs of letters joined by internal apostrophes.
"""
from __future__ import annotations

import re
import unicodedata

_APOSTROPHES = {"’": "'", "‘": "'", "ʼ": "'", "`": "'", "´": "'"}
_TOKEN = re.compile(r"[^\W\d_]+(?:'[^\W\d_]+)*", re.UNICODE)


def normalise_text(text: str) -> str:
    text = unicodedata.normalize("NFC", text).lower()
    for src, dst in _APOSTROPHES.items():
        text = text.replace(src, dst)
    return text


def tokenise(text: str) -> list[str]:
    """Return the token list of a raw sentence after normalisation."""
    return _TOKEN.findall(normalise_text(text))


def normalised_sentence(text: str) -> str:
    """Canonical single-spaced string used for exact deduplication."""
    return " ".join(tokenise(text))
