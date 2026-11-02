"""Export the sentence grammar the app uses and the list of forms for native-speaker review.

Usage: python ml/scripts/export_grammar.py
Writes app/src/grammar/grammar_rw.json (read by app/src/grammar/sentence.js) and
vocab/grammar_forms_review.csv (one row per generated form). Then generate the voice clips with
python scripts/generate_kinyarwanda_audio.py --forms
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
sys.path.insert(0, str(ROOT))
from vuga_ml.sentences import build, review_rows  # noqa: E402


def main() -> None:
    grammar = build(REPO / "vocab")
    out = REPO / "app" / "src" / "grammar" / "grammar_rw.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(grammar, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    rows = review_rows(grammar)
    with open(REPO / "vocab" / "grammar_forms_review.csv", "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=[*rows[0], "correct?", "better form"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"{len(grammar['verbs'])} verbs, {len(grammar['nouns'])} nouns, {len(grammar['clips'])} clips, {len(rows)} review rows")


if __name__ == "__main__":
    main()
