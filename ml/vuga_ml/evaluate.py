"""Evaluation harness: fit the statistical baselines on train, report on validation.

Usage
    python -m vuga_ml.evaluate --data ml/data/processed --split validation --out report.json

The test partition is refused unless --final is passed, which is meant to be used exactly once
after the model selection is frozen (proposal 3.3.3).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .metrics import aggregate, paired_bootstrap, score_sequence
from .models import KneserNeyTrigram, UnigramFrequency


def load_split(folder: Path, part: str) -> list[tuple[str, ...]]:
    path = folder / f"{part}.jsonl"
    seqs = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            seqs.append(tuple(json.loads(line)["symbols"]))
    return seqs


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--split", choices=["validation", "test"], default="validation")
    ap.add_argument("--final", action="store_true", help="allow evaluating on the test split")
    ap.add_argument("--out", type=Path)
    args = ap.parse_args(argv)

    if args.split == "test" and not args.final:
        print("refusing to evaluate on test without --final (selection must be frozen first)")
        return 2

    train = load_split(args.data, "train")
    eval_seqs = load_split(args.data, args.split)
    report = {"split": args.split, "n_train": len(train), "n_eval": len(eval_seqs), "models": {}}

    models = [UnigramFrequency(), KneserNeyTrigram()]
    per_model = {}
    for m in models:
        m.fit(train)
        scores = [score_sequence(m, s) for s in eval_seqs]
        per_model[m.name] = scores
        report["models"][m.name] = aggregate(scores)
    report["kn_trigram_vs_unigram"] = paired_bootstrap(per_model["kn_trigram"], per_model["unigram"])

    text = json.dumps(report, indent=2, ensure_ascii=False)
    if args.out:
        args.out.write_text(text, encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
