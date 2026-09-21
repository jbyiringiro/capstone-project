"""Server-side prediction: loads a frozen model artefact exported by ml/.

The client normally predicts on device; this endpoint exists for the dashboard preview, for
devices without a runtime, and for model-comparison tooling. Only artefacts registered in
model_versions with is_frozen=True are served during the study.
"""
from __future__ import annotations

import sys
from functools import lru_cache
from pathlib import Path

from .config import settings

# make the sibling ml package importable without installing it
_ML = Path(__file__).resolve().parents[2] / "ml"
if str(_ML) not in sys.path:
    sys.path.insert(0, str(_ML))

from vuga_ml.models import KneserNeyTrigram, UnigramFrequency  # noqa: E402

_TYPES = {"kn_trigram": KneserNeyTrigram, "unigram": UnigramFrequency}


@lru_cache(maxsize=4)
def load_model(name: str | None = None):
    import json

    path = Path(settings.model_dir) / (name or settings.default_model)
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    cls = _TYPES[data["type"]]
    return cls.from_dict(data)
