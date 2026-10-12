"""Capture train/validation evidence for the model notebook; never open test data.

Run from the repository root after an explicitly chosen development iteration:
    python ml/notebooks/capture_evidence.py
No downloads or model training are performed. Natural-language corpus sentences are omitted.
"""
from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "ml" / "data" / "processed"
ART = ROOT / "ml" / "artifacts"
OUT = Path(__file__).resolve().parent / "evidence"


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    manifest = read_json(DATA / "split_manifest.json")
    assert sha256(ROOT / "vocab" / "lexicon_draft.csv") == manifest["lexicon_sha256"]
    seqs = {}
    for part in ("train", "validation"):
        rows = [json.loads(line) for line in (DATA / f"{part}.jsonl").read_text(
            encoding="utf-8").splitlines() if line.strip()]
        assert len(rows) == manifest[part]
        seqs[part] = [tuple(row["symbols"]) for row in rows]
    assert not (set(seqs["train"]) & set(seqs["validation"]))
    report = read_json(ART / "gru_validation.json")
    assert report["n_train"] == manifest["train"] and report["n_val"] == manifest["validation"]
    OUT.mkdir(parents=True, exist_ok=True)
    for part, sequences in seqs.items():
        (OUT / f"{part}.jsonl").write_text("".join(
            json.dumps({"symbols": list(seq)}, separators=(",", ":")) + "\n"
            for seq in sequences), encoding="utf-8")
    copies = {
        "split_manifest.json": DATA / "split_manifest.json",
        "exclusions.json": DATA / "exclusions.json",
        "baselines_validation.json": ART / "baselines_validation.json",
        "gru_validation.json": ART / "gru_validation.json",
        "gru_seed0.json": ART / "gru_h128_seed0.json",
        "LICENSE.corpus": ROOT / "ml" / "data" / "raw" / "digital_umuganda" / "LICENSE",
    }
    for name, source in copies.items():
        (OUT / name).write_bytes(source.read_bytes())
    raw_provenance = read_json(ROOT / "ml" / "data" / "raw" / "digital_umuganda" / "PROVENANCE.json")
    provenance = {
        "captured_utc": datetime.now(UTC).isoformat(),
        "corpus_repository": raw_provenance["repository"],
        "corpus_commit": raw_provenance["commit"],
        "corpus_licence_as_recorded": raw_provenance["licence"],
        "corpus_accessed": raw_provenance["accessed"],
        "transformations": [
            "Existing draft-v3 preprocessing and frozen group split; no repartitioning",
            "Copy all train/validation symbol sequences in their existing order",
            "Remove natural-language sentence fields; no examples generated",
        ],
        "test_data": "Not opened or included; count in split_manifest is historical metadata only",
        "optional_local_model_sha256": {
            path.relative_to(ROOT).as_posix(): sha256(path)
            for path in (ART / "gru.onnx", ART / "gru.vocab.json") if path.is_file()
        },
        "source_sha256": {
            f"ml/data/processed/{part}.jsonl": sha256(DATA / f"{part}.jsonl")
            for part in ("train", "validation")
        },
        "files_sha256": {
            name: sha256(OUT / name)
            for name in ["train.jsonl", "validation.jsonl", *copies]
        },
    }
    (OUT / "PROVENANCE.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
    print(f"Captured {len(seqs['train'])} training and {len(seqs['validation'])} validation sequences.")
    print("Test partition was not read.")


if __name__ == "__main__":
    main()
