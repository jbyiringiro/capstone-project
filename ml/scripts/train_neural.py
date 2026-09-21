"""Train GRU and/or transformer on the frozen split with several seeds; report validation metrics.

Usage
  python ml/scripts/train_neural.py --family gru --seeds 0 1 2 [--hidden 128] [--epochs 20]
  python ml/scripts/train_neural.py --family transformer --model castorini/afriberta_small --seeds 0
Outputs
  ml/artifacts/<family>_seed<k>.{json,pt} (GRU) or ml/artifacts/transformer_seed<k>/ (HF dir)
  ml/artifacts/<family>_validation.json  per-seed and mean/sd top-k, perplexity, size, train time
Validation only. The test split is evaluated exactly once via vuga_ml.evaluate --final.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import statistics
import sys
import time
from pathlib import Path

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from vuga_ml.evaluate import load_split  # noqa: E402
from vuga_ml.metrics import aggregate, score_sequence  # noqa: E402
from vuga_ml.models.neural import GRUPredictor, TransformerPredictor  # noqa: E402

ART = ROOT / "artifacts"


def lexical_forms() -> dict[str, str]:
    path = ROOT.parent / "vocab" / "symbols.csv"
    with open(path, encoding="utf-8", newline="") as fh:
        return {r["symbol_id"]: r["label_rw"] for r in csv.DictReader(fh)}


def size_bytes(path: Path) -> int:
    if path.is_dir():
        return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())
    return sum(p.stat().st_size for p in path.parent.glob(path.stem + ".*"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=ROOT / "data" / "processed")
    ap.add_argument("--family", choices=["gru", "transformer"], required=True)
    ap.add_argument("--seeds", type=int, nargs="+", default=[0, 1, 2])
    ap.add_argument("--hidden", type=int, default=128)
    ap.add_argument("--epochs", type=int)
    ap.add_argument("--model", default="castorini/afriberta_small")
    ap.add_argument("--limit", type=int, help="subsample training sequences (smoke runs)")
    args = ap.parse_args()

    train = load_split(args.data, "train")
    val = load_split(args.data, "validation")
    lexical = lexical_forms()
    symbols = list(lexical)  # full board vocabulary: output slots for every symbol
    if args.limit:
        train = train[:args.limit]
    ART.mkdir(exist_ok=True)
    runs = []
    for seed in args.seeds:
        t0 = time.time()
        if args.family == "gru":
            m = GRUPredictor(hidden=args.hidden, seed=seed, **({"epochs": args.epochs} if args.epochs else {}))
            m.fit(train, val, symbols=symbols)
            out = ART / f"gru_h{args.hidden}_seed{seed}"
            m.save(out)
        else:
            m = TransformerPredictor(model_name=args.model, lexical=lexical, seed=seed,
                                     **({"epochs": args.epochs} if args.epochs else {}))
            m.fit(train, val, symbols=symbols)
            out = ART / f"transformer_seed{seed}"
            m.save(out)
        secs = time.time() - t0
        agg = aggregate([score_sequence(m, s) for s in val])
        agg.update({"seed": seed, "train_seconds": round(secs, 1), "size_bytes": size_bytes(out),
                    "epochs_run": len(m.history), "artifact": str(out.relative_to(ROOT))})
        runs.append(agg)
        print(json.dumps(agg))
    summary = {"family": args.family, "n_train": len(train), "n_val": len(val), "runs": runs}
    for k in ("top1", "top3", "top5", "perplexity"):
        vals = [r[k] for r in runs]
        summary[f"{k}_mean"] = statistics.mean(vals)
        summary[f"{k}_sd"] = statistics.stdev(vals) if len(vals) > 1 else 0.0
    (ART / f"{args.family}_validation.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "runs"}, indent=2))


if __name__ == "__main__":
    main()
