"""Run the pre-specified study analysis on an exported trials CSV (+ optional SUS CSV).

Usage: python ml/scripts/analyse_study.py --trials study/trials.csv [--sus study/sus.csv] [--out report.json]
SUS CSV: participant,q1,...,q10 (1-5).
Use --simulate N to generate a synthetic dataset and check the pipeline end to end.
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vuga_ml.study import analyse, load_trials  # noqa: E402


def simulate(n: int, seed: int = 1, true_reduction: float = 0.28) -> tuple[list[dict], dict]:
    rng = random.Random(seed); trials = []; sus = {}
    for i in range(n):
        p = f"A{i + 1:02d}"; base = rng.uniform(9, 14); eff = rng.gauss(true_reduction, 0.08)
        for cond in ("static", "predictive"):
            for j in range(10):
                taps = base * (1 - eff if cond == "predictive" else 1) + rng.gauss(0, 1.2)
                trials.append({"participant": p, "condition": cond, "taps": max(3.0, round(taps)),
                               "duration_ms": max(2000.0, taps * rng.uniform(900, 1400)),
                               "corrections": float(rng.random() < 0.15), "completed": True, "valid": True})
        sus[p] = [rng.choice([3, 4, 5]) if k % 2 == 0 else rng.choice([1, 2, 3]) for k in range(10)]
    return trials, sus


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=Path); ap.add_argument("--sus", type=Path)
    ap.add_argument("--simulate", type=int); ap.add_argument("--out", type=Path)
    args = ap.parse_args()
    if args.simulate:
        trials, sus = simulate(args.simulate)
    else:
        trials = load_trials(args.trials); sus = None
        if args.sus:
            with open(args.sus, encoding="utf-8", newline="") as fh:
                sus = {r["participant"]: [int(r[f"q{k}"]) for k in range(1, 11)] for r in csv.DictReader(fh)}
    report = analyse(trials, sus)
    text = json.dumps(report, indent=2)
    if args.out:
        args.out.write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
