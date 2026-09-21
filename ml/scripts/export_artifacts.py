"""Fit the statistical baselines on train and export every artefact the app, API and device use.

  ml/artifacts/kn_trigram.json, unigram.json        served by the API (/predict)
  app/public/models/kn_trigram.json                 loaded by the PWA on-device predictor
  app/tests/fixtures/kn_fixture.json                parity fixture: artefact + expected top-3
  device/bundle/suggestions.json                    precomputed top-3 per bigram context for the talker
  [--gru <artifact stem>] app/public/models/gru.onnx + gru.vocab.json (onnxruntime-web)

Usage: python ml/scripts/export_artifacts.py [--gru ml/artifacts/gru_h128_seed0]
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
sys.path.insert(0, str(ROOT))

from vuga_ml import BOS  # noqa: E402
from vuga_ml.evaluate import load_split  # noqa: E402
from vuga_ml.models import KneserNeyTrigram, UnigramFrequency  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=ROOT / "data" / "processed")
    ap.add_argument("--gru", type=Path, help="GRU artefact stem to export to ONNX")
    args = ap.parse_args()

    train = load_split(args.data, "train")
    val = load_split(args.data, "validation")
    art = ROOT / "artifacts"; art.mkdir(exist_ok=True)
    kn = KneserNeyTrigram(); kn.fit(train); kn.save(art / "kn_trigram.json")
    uni = UnigramFrequency(); uni.fit(train); uni.save(art / "unigram.json")

    models_dir = REPO / "app" / "public" / "models"; models_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(art / "kn_trigram.json", models_dir / "kn_trigram.json")

    # parity fixture: prefixes from validation, expected top-3 with and without a mask
    prefixes = []
    for s in val[:40]:
        for i in range(min(len(s), 3) + 1):
            prefixes.append(list(s[:i]))
    allowed = sorted(kn.vocab - {"</s>"})[: max(5, len(kn.vocab) // 2)]
    fixture = {"artifact": kn.to_dict(),
               "cases": [{"prefix": p, "top3": kn.top_k(tuple(p), 3),
                          "top3_masked": kn.top_k(tuple(p), 3, set(allowed))} for p in prefixes],
               "allowed": allowed}
    fx = REPO / "app" / "tests" / "fixtures"; fx.mkdir(parents=True, exist_ok=True)
    (fx / "kn_fixture.json").write_text(json.dumps(fixture, ensure_ascii=False), encoding="utf-8")

    # device table: top-3 for every observed bigram context plus unigram fallback
    contexts = {}
    for (w1, w2) in kn.tri:
        prefix = tuple(w for w in (w1, w2) if w != BOS)
        contexts[" ".join((w1, w2))] = kn.top_k(prefix, 3)
    bundle = REPO / "device" / "bundle"; bundle.mkdir(parents=True, exist_ok=True)
    (bundle / "suggestions.json").write_text(json.dumps({"fallback": uni.top_k((), 3), "contexts": contexts},
                                                        ensure_ascii=False), encoding="utf-8")

    if args.gru:
        from vuga_ml.models.neural import GRUPredictor
        g = GRUPredictor.load(args.gru)
        g.export_onnx(models_dir / "gru.onnx")
        shutil.copy(models_dir / "gru.vocab.json", art / "gru.vocab.json")
        shutil.copy(models_dir / "gru.onnx", art / "gru.onnx")

    print(f"train sequences: {len(train)}; KN vocab: {len(kn.vocab)}; "
          f"kn_trigram.json: {(art / 'kn_trigram.json').stat().st_size:,} bytes; "
          f"device contexts: {len(contexts)}; fixture cases: {len(prefixes)}")


if __name__ == "__main__":
    main()
