"""Token frequency of the pinned corpus, restricted to sentences of 2-8 tokens.

Purpose: decide which surface forms to translate and map first when growing vocab/lexicon.csv
towards 300-500 symbols. Output: ml/data/processed/token_frequency.csv (surface, count,
cumulative_share, in_lexicon).

Usage: python ml/scripts/token_frequency.py [--lexicon vocab/lexicon.csv] [--top 2000]
"""
from __future__ import annotations

import argparse
import csv
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from vuga_ml.lexicon import Lexicon  # noqa: E402
from vuga_ml.mapping import MAX_TOKENS, MIN_TOKENS  # noqa: E402
from vuga_ml.normalise import tokenise  # noqa: E402

RAW = ROOT / "data" / "raw" / "digital_umuganda"
OUT = ROOT / "data" / "processed" / "token_frequency.csv"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lexicon", type=Path, default=ROOT.parent / "vocab" / "lexicon.csv")
    ap.add_argument("--top", type=int, default=2000)
    args = ap.parse_args()
    lex = Lexicon.from_csv(args.lexicon)

    counts: Counter = Counter()
    n_sent = 0
    for path in sorted(RAW.glob("*.txt")):
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                toks = tokenise(line)
                if MIN_TOKENS <= len(toks) <= MAX_TOKENS:
                    counts.update(toks)
                    n_sent += 1
    total = sum(counts.values())
    OUT.parent.mkdir(parents=True, exist_ok=True)
    cum = 0
    with open(OUT, "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["rank", "surface", "count", "share", "cumulative_share", "in_lexicon"])
        for i, (tok, c) in enumerate(counts.most_common(args.top), 1):
            cum += c
            w.writerow([i, tok, c, f"{c / total:.5f}", f"{cum / total:.4f}", int(bool(lex.lookup(tok)))])
    covered = sum(c for t, c in counts.items() if lex.lookup(t))
    print(f"sentences 2-8 tokens: {n_sent:,}; token occurrences: {total:,}; distinct: {len(counts):,}")
    print(f"current lexicon covers {covered / total:.1%} of occurrences")
    for k in (100, 300, 500, 1000, 2000):
        share = sum(c for _, c in counts.most_common(k)) / total
        print(f"top {k:>5} surface forms cover {share:.1%}")
    print("top 30:", ", ".join(t for t, _ in counts.most_common(30)))
    print("written", OUT)


if __name__ == "__main__":
    main()
