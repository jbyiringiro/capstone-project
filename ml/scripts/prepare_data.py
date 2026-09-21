"""Map the raw corpus to symbol sequences and write the frozen train/validation/test split.

Usage: python ml/scripts/prepare_data.py --lexicon vocab/lexicon.csv [--seed 20260921] [--limit N]

Outputs in ml/data/processed/:
  train.jsonl, validation.jsonl, test.jsonl   {"sentence": ..., "symbols": [...]}
  exclusions.json                             counts per exclusion reason (reported in Ch. 4)
  split_manifest.json                         seed, counts, lexicon hash, corpus provenance
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from vuga_ml.lexicon import Lexicon  # noqa: E402
from vuga_ml.mapping import map_corpus  # noqa: E402
from vuga_ml.splits import split  # noqa: E402

RAW = ROOT / "data" / "raw" / "digital_umuganda"
OUT = ROOT / "data" / "processed"


def iter_lines(limit: int | None):
    n = 0
    for path in sorted(RAW.glob("*.txt")):
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                yield line
                n += 1
                if limit and n >= limit:
                    return


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lexicon", type=Path, required=True)
    ap.add_argument("--seed", type=int, default=20260921)
    ap.add_argument("--limit", type=int, help="read only the first N lines (for smoke tests)")
    args = ap.parse_args()

    lex = Lexicon.from_csv(args.lexicon)
    kept, counts = map_corpus(iter_lines(args.limit), lex)
    result = split(kept, seed=args.seed)

    OUT.mkdir(parents=True, exist_ok=True)
    for part, rows in result.as_dict().items():
        with open(OUT / f"{part}.jsonl", "w", encoding="utf-8") as fh:
            for r in rows:
                fh.write(json.dumps({"sentence": r.sentence, "symbols": list(r.symbols)},
                                    ensure_ascii=False) + "\n")
    (OUT / "exclusions.json").write_text(json.dumps(dict(counts), indent=2), encoding="utf-8")

    prov_path = RAW / "PROVENANCE.json"
    manifest = {
        "seed": result.seed,
        "lines_read": sum(counts.values()),
        "mapped": result.n_input,
        "unique_sentences": result.n_unique,
        "symbol_sequence_groups": result.n_groups,
        "train": len(result.train), "validation": len(result.validation), "test": len(result.test),
        "lexicon_sha256": hashlib.sha256(args.lexicon.read_bytes()).hexdigest(),
        "corpus_commit": json.loads(prov_path.read_text())["commit"] if prov_path.exists() else None,
        "symbols_in_lexicon": len(lex.symbol_ids),
    }
    (OUT / "split_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))
    print("exclusions:", dict(counts))


if __name__ == "__main__":
    main()
