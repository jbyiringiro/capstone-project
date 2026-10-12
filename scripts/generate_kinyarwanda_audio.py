"""Generate and verify Vuga's synthetic Kinyarwanda word clips locally.

Uses only the official Meta MMS Kinyarwanda checkpoint, pinned to an immutable
revision, with safetensors and no remote Python code. Model weights and caches
stay under this repository's ignored .venv directory. No vocabulary, microphone
recording, or participant information is uploaded to a service.
"""

from __future__ import annotations

import argparse
import array
import csv
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import wave
import zlib

ROOT = Path(__file__).resolve().parents[1]
VOCAB = ROOT / "vocab" / "symbols.csv"
OUTPUT = ROOT / "app" / "public" / "audio" / "rw"
CACHE = ROOT / ".venv" / "tts-model-cache"
MODEL = "facebook/mms-tts-kin"
REVISION = "71d00a03419b9bfd203a6bfa4d6bc565cbe3c4e0"
MODEL_URL = f"https://huggingface.co/{MODEL}"
LICENSE_URL = "https://creativecommons.org/licenses/by-nc/4.0/"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_symbols() -> list[dict[str, str]]:
    with VOCAB.open(encoding="utf-8-sig", newline="") as handle:
        symbols = list(csv.DictReader(handle))
    keys = [row["symbol_id"] for row in symbols]
    if len(set(keys)) != len(keys):
        raise ValueError("Vocabulary symbol IDs must be unique.")
    for row in symbols:
        key = row["symbol_id"]
        if not key or any(c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_" for c in key):
            raise ValueError(f"Unsafe symbol ID: {key!r}")
        if not row["label_rw"].strip():
            raise ValueError(f"Missing Kinyarwanda label: {key}")
    return symbols


def inspect_wav(path: Path) -> dict:
    with wave.open(str(path), "rb") as handle:
        if handle.getnchannels() != 1 or handle.getsampwidth() != 2:
            raise ValueError(f"Expected mono 16-bit PCM: {path}")
        rate, count = handle.getframerate(), handle.getnframes()
        samples = array.array("h", handle.readframes(count))
    if sys.byteorder != "little":
        samples.byteswap()
    if rate != 16000 or not samples or not any(samples):
        raise ValueError(f"Empty, silent, or unexpected sample rate: {path}")
    peak = max(abs(sample) for sample in samples)
    rms = (sum(sample * sample for sample in samples) / len(samples)) ** 0.5
    if peak < 32 or rms < 5:
        raise ValueError(f"Audio signal too quiet: {path}")
    return {
        "file": path.name,
        "url": f"/audio/rw/{path.name}",
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
        "sample_rate": rate,
        "channels": 1,
        "bits_per_sample": 16,
        "frames": count,
        "duration_seconds": round(count / rate, 4),
        "peak_pcm": peak,
        "rms_pcm": round(rms, 3),
    }


def verify(symbols: list[dict[str, str]], selected: set[str] | None = None) -> dict:
    manifest = json.loads((OUTPUT / "manifest.json").read_text(encoding="utf-8"))
    if manifest["model"]["id"] != MODEL or manifest["model"]["revision"] != REVISION:
        raise ValueError("Unexpected speech model provenance.")
    if manifest["vocabulary_sha256"] != sha256(VOCAB):
        raise ValueError("Vocabulary changed: regenerate clips and provenance.")
    rows = {entry["symbol_id"]: entry for entry in manifest["clips"]}
    total_bytes = 0
    checked = []
    for row in symbols:
        key = row["symbol_id"]
        if selected and key not in selected:
            continue
        item = rows[key]
        if item["text"] != row["label_rw"] or item["language"] != "rw":
            raise ValueError(f"Audio text/language mismatch: {key}")
        actual = inspect_wav(OUTPUT / f"{key}.wav")
        for field in ("sha256", "bytes", "frames", "sample_rate", "channels", "bits_per_sample"):
            if actual[field] != item[field]:
                raise ValueError(f"Audio manifest mismatch: {key}.{field}")
        total_bytes += actual["bytes"]
        checked.append(actual)
    if not selected and (set(rows) != {row["symbol_id"] for row in symbols}):
        raise ValueError("Manifest must cover the complete vocabulary exactly.")
    if not selected and {path.stem for path in OUTPUT.glob("*.wav")} != set(rows):
        raise ValueError("WAV filenames must match the manifest exactly.")
    return {
        "verified_clips": len(checked),
        "bytes": total_bytes,
        "seconds": round(sum(item["duration_seconds"] for item in checked), 3),
        "longest_seconds": max(item["duration_seconds"] for item in checked),
        "minimum_peak_pcm": min(item["peak_pcm"] for item in checked),
        "language": "rw",
        "pronunciation_review": "not_reviewed",
    }


def generate(symbols: list[dict[str, str]], selected: set[str] | None, threads: int) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(CACHE)
    os.environ["HF_HUB_CACHE"] = str(CACHE / "hub")
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    os.environ["HF_HUB_DISABLE_XET"] = "1"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    import numpy as np
    import torch
    from huggingface_hub import snapshot_download
    from transformers import AutoTokenizer, VitsModel

    print(f"Loading official {MODEL}@{REVISION} (CPU; safetensors only).", flush=True)
    snapshot = Path(snapshot_download(
        MODEL,
        revision=REVISION,
        cache_dir=str(CACHE / "hub"),
        allow_patterns=["*.json", "model.safetensors", "README.md"],
        token=False,
    ))
    torch.set_num_threads(threads)
    model = VitsModel.from_pretrained(
        snapshot, local_files_only=True, use_safetensors=True, trust_remote_code=False
    ).eval().cpu()
    tokenizer = AutoTokenizer.from_pretrained(
        snapshot, local_files_only=True, trust_remote_code=False
    )
    if tokenizer.language != "kin" or model.config.sampling_rate != 16000:
        raise ValueError("The loaded checkpoint is not the expected Kinyarwanda model.")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    previous = {}
    manifest_path = OUTPUT / "manifest.json"
    if selected and manifest_path.exists():
        old = json.loads(manifest_path.read_text(encoding="utf-8"))
        if old["vocabulary_sha256"] == sha256(VOCAB) and old["model"]["revision"] == REVISION:
            previous = {item["symbol_id"]: item for item in old["clips"]}
    todo = [row for row in symbols if not selected or row["symbol_id"] in selected]
    for index, row in enumerate(todo, 1):
        key, text = row["symbol_id"], row["label_rw"]
        seed = 42 + zlib.crc32(key.encode("ascii"))
        torch.manual_seed(seed)
        inputs = tokenizer(text, return_tensors="pt")
        with torch.inference_mode():
            waveform = model(**inputs).waveform[0].cpu().numpy()
        if not len(waveform) or not np.isfinite(waveform).all():
            raise ValueError(f"Invalid generated waveform: {key}")
        peak = float(np.max(np.abs(waveform)))
        if peak < 0.001:
            raise ValueError(f"Generated audio is silent: {key}")
        # Normalize peak to 85% of PCM range without clipping or altering the text.
        pcm = np.rint(waveform * (0.85 / peak) * 32767).astype("<i2")
        path = OUTPUT / f"{key}.wav"
        temporary = path.with_suffix(".wav.tmp")
        with wave.open(str(temporary), "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(model.config.sampling_rate)
            handle.writeframes(pcm.tobytes())
        temporary.replace(path)
        clip = {
            "symbol_id": key,
            "text": text,
            "language": "rw",
            "seed": seed,
            "synthetic": True,
            "pronunciation_review": "not_reviewed",
            **inspect_wav(path),
        }
        previous[key] = clip
        print(f"[{index}/{len(todo)}] {key}: {clip['duration_seconds']:.2f}s, {clip['bytes']} bytes", flush=True)
    manifest = {
        "format": "vuga-kinyarwanda-synthetic-audio-v1",
        "language": "rw",
        "model_language": "kin",
        "synthetic": True,
        "human_recordings": False,
        "pronunciation_review": "not_reviewed",
        "model": {
            "id": MODEL,
            "revision": REVISION,
            "source": MODEL_URL,
            "publisher": "Meta AI",
            "license": "CC-BY-NC-4.0",
            "license_url": LICENSE_URL,
            "weights_format": "safetensors",
            "weights_sha256": sha256(snapshot / "model.safetensors"),
            "weights_in_app": False,
        },
        "generation": {
            "script": "scripts/generate_kinyarwanda_audio.py",
            "device": "cpu",
            "threads": threads,
            "seed_algorithm": "42 + crc32(symbol_id)",
            "normalization": "Peak normalized to 0.85; converted to mono PCM16 WAV.",
            "dependencies": {name: importlib.metadata.version(name) for name in ("torch", "transformers", "numpy", "safetensors", "huggingface-hub")},
        },
        "vocabulary_source": "vocab/symbols.csv",
        "vocabulary_sha256": sha256(VOCAB),
        "clip_count": len(previous),
        "clips": [previous[key] for key in sorted(previous)],
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(verify(symbols, selected), indent=2), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", nargs="+", help="Generate/check specified vocabulary IDs first.")
    parser.add_argument("--check", action="store_true", help="Verify existing WAVs without ML dependencies or network.")
    parser.add_argument("--threads", type=int, default=4, help="CPU inference threads (default 4).")
    args = parser.parse_args()
    symbols = read_symbols()
    selected = set(args.only) if args.only else None
    if selected and selected - {row["symbol_id"] for row in symbols}:
        parser.error("--only contains an unknown symbol ID")
    if not 1 <= args.threads <= 32:
        parser.error("--threads must be between 1 and 32")
    if args.check:
        print(json.dumps(verify(symbols, selected), indent=2))
    else:
        generate(symbols, selected, args.threads)


if __name__ == "__main__":
    main()
