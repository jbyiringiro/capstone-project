"""Summarise the vocabulary review sheets (RQ1) and draft decision-log rows.

Usage: python ml/scripts/analyse_vocabulary_review.py --reviews study/vocab_reviews.csv
           [--mentions study/vocab_mentions.csv] [--out report.json] [--log-out draft_decisions.md]
       python ml/scripts/analyse_vocabulary_review.py --template study/vocab_reviews.csv
Column definitions and the decision rule are in vuga_ml/vocab_review.py. The template has one row per
word on the paper sheet (vocab/review_words.csv); copy it once per participant and fill in the code.
Participant files hold study codes only and stay out of the repository.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
sys.path.insert(0, str(ROOT))
from vuga_ml.vocab_review import (  # noqa: E402
    ReviewDataError, analyse, decision_rows, load_review_words, load_symbols, read_csv, template_rows,
)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reviews", type=Path); ap.add_argument("--mentions", type=Path)
    ap.add_argument("--symbols", type=Path, default=REPO / "vocab" / "symbols.csv")
    ap.add_argument("--words", type=Path, default=REPO / "vocab" / "review_words.csv")
    ap.add_argument("--out", type=Path); ap.add_argument("--log-out", type=Path)
    ap.add_argument("--template", type=Path, help="write a blank review sheet CSV and stop")
    args = ap.parse_args()
    review_words = load_review_words(args.words)
    if args.template:
        rows = template_rows(review_words)
        with open(args.template, "w", encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)
        print(f"wrote {len(rows)} rows to {args.template}")
        return
    if not args.reviews:
        ap.error("--reviews is required unless --template is given")
    try:
        report = analyse(read_csv(args.reviews), load_symbols(args.symbols),
                         read_csv(args.mentions) if args.mentions else None, review_words)
    except ReviewDataError as error:
        sys.exit(f"error: {error}")
    text = json.dumps(report, indent=2, ensure_ascii=False)
    if args.out:
        args.out.write_text(text + "\n", encoding="utf-8")
    if args.log_out:
        rows = decision_rows(report, dt.date.today().isoformat())
        args.log_out.write_text("\n".join(rows) + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
