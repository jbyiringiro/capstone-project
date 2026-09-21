"""Reproduce one development iteration end to end and write a dated summary.

    python ml/scripts/run_pipeline.py --lexicon vocab/lexicon_draft.csv [--families gru transformer] [--seeds 0 1 2]

Steps (each is the same script a human would run, in order):
  1. build_lexicon        lemmas.csv -> lexicon_draft.csv / symbols_draft.csv (only if --lexicon is the draft)
  2. prepare_data         corpus -> split (train/validation/test), exclusions, near misses, manifest
  3. evaluate             unigram + KN trigram on validation
  4. train_neural         GRU (and transformer) with the given seeds on validation
  5. export_artifacts     KN JSON, PWA model, parity fixture, device table, GRU ONNX
  6. bench_latency        local latency screen
Writes ml/artifacts/iteration_<date>_<lexicon-hash8>.json with every number, ready to paste into
docs/results_log.md. Never touches the test split.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
PY = sys.executable


def run(*args: str, cwd: Path = REPO) -> None:
    print("+", " ".join(args), flush=True)
    subprocess.run([PY, *args], cwd=cwd, check=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lexicon", type=Path, default=REPO / "vocab" / "lexicon_draft.csv")
    ap.add_argument("--families", nargs="*", default=["gru"], choices=["gru", "transformer"])
    ap.add_argument("--seeds", nargs="*", type=int, default=[0, 1, 2])
    ap.add_argument("--skip-build", action="store_true")
    args = ap.parse_args()

    if not args.skip_build and args.lexicon.name == "lexicon_draft.csv":
        run("ml/scripts/build_lexicon.py")
        (REPO / "vocab" / "symbols.csv").write_bytes((REPO / "vocab" / "symbols_draft.csv").read_bytes())
    run("ml/scripts/prepare_data.py", "--lexicon", str(args.lexicon))
    run("-m", "vuga_ml.evaluate", "--data", "data/processed", "--out", "artifacts/baselines_validation.json", cwd=ROOT)
    for fam in args.families:
        run("ml/scripts/train_neural.py", "--family", fam, "--seeds", *map(str, args.seeds))
    gru = ROOT / "artifacts" / f"gru_h128_seed{args.seeds[0]}.json"
    run("ml/scripts/export_artifacts.py", *(["--gru", str(gru.with_suffix(""))] if gru.exists() else []))
    run("ml/scripts/bench_latency.py")

    art = ROOT / "artifacts"
    summary = {
        "date": dt.date.today().isoformat(),
        "lexicon": str(args.lexicon), "lexicon_sha256": hashlib.sha256(args.lexicon.read_bytes()).hexdigest(),
        "split_manifest": json.loads((ROOT / "data" / "processed" / "split_manifest.json").read_text()),
        "exclusions": json.loads((ROOT / "data" / "processed" / "exclusions.json").read_text()),
        "baselines": json.loads((art / "baselines_validation.json").read_text()),
        "latency_local": json.loads((art / "latency_local.json").read_text()),
    }
    for fam in args.families:
        f = art / f"{fam}_validation.json"
        if f.exists():
            summary[fam] = json.loads(f.read_text())
    tag = summary["lexicon_sha256"][:8]
    out = art / f"iteration_{summary['date']}_{tag}.json"
    out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    m = summary["split_manifest"]; b = summary["baselines"]["models"]
    print(f"\niteration {tag}: train/val/test {m['train']}/{m['validation']}/{m['test']}; "
          f"KN top-3 {b['kn_trigram']['top3']:.3f}; unigram top-3 {b['unigram']['top3']:.3f}"
          + (f"; GRU top-3 {summary['gru']['top3_mean']:.3f} ± {summary['gru']['top3_sd']:.3f}" if "gru" in summary else "")
          + (f"; transformer top-3 {summary['transformer']['top3_mean']:.3f} ± {summary['transformer']['top3_sd']:.3f}" if "transformer" in summary else ""))
    print("written", out)


if __name__ == "__main__":
    main()
