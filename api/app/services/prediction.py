"""Server-side prediction: serves frozen model artefacts exported by ml/.

The client normally predicts on device; this endpoint exists for the dashboard preview, for
devices without a runtime, and for model-comparison tooling. Only artefacts registered in
model_versions with is_frozen=True are served during the study.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import ClassVar

# make the sibling ml package importable without installing it
_ML = Path(__file__).resolve().parents[3] / "ml"
if str(_ML) not in sys.path:
    sys.path.insert(0, str(_ML))

from vuga_ml.models import KneserNeyTrigram, Predictor, UnigramFrequency

__all__ = ["ModelRegistry", "Predictor"]


class ModelRegistry:
    """Loads artefacts by file name and keeps each loaded model for the process lifetime."""

    TYPES: ClassVar[dict[str, type[Predictor]]] = {"kn_trigram": KneserNeyTrigram,
                                                   "unigram": UnigramFrequency}

    def __init__(self, model_dir: str | Path, default_model: str) -> None:
        self.model_dir = Path(model_dir)
        self.default_model = default_model
        self._loaded: dict[str, Predictor] = {}

    def get(self, name: str | None = None) -> Predictor | None:
        """The named (or default) model, or None while no artefact is installed."""
        name = name or self.default_model
        if name in self._loaded:
            return self._loaded[name]
        path = self.model_dir / name
        if not path.exists():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        cls = self.TYPES.get(data.get("type"))
        if cls is None:
            raise ValueError(f"{path.name}: unsupported model type {data.get('type')!r}")
        self._loaded[name] = model = cls.from_dict(data)
        return model
