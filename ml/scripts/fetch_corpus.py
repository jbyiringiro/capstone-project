"""Download and pin the Digital Umuganda Common Voice Kinyarwanda sentence corpus (MPL-2.0).

Writes ml/data/raw/digital_umuganda/*.txt plus PROVENANCE.json recording the commit SHA,
access date, file sizes and SHA-256 hashes (proposal 3.3.2: "frozen to a recorded commit and
file hashes on acquisition").

Usage: python ml/scripts/fetch_corpus.py [--commit SHA]
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import urllib.request
from pathlib import Path

REPO = "Digital-Umuganda/common_voice_dataset_rw"
RAW = Path(__file__).resolve().parents[1] / "data" / "raw" / "digital_umuganda"
UA = {"User-Agent": "vuga-aac-fetch/0.1"}


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", help="pin to this commit SHA (default: current HEAD of main)")
    args = ap.parse_args()

    if args.commit:
        sha = args.commit
    else:
        data = json.loads(get(f"https://api.github.com/repos/{REPO}/commits?per_page=1"))
        sha = data[0]["sha"]
    listing = json.loads(get(f"https://api.github.com/repos/{REPO}/contents/?ref={sha}"))
    RAW.mkdir(parents=True, exist_ok=True)

    prov = {"repository": f"https://github.com/{REPO}", "commit": sha,
            "licence": "MPL-2.0", "accessed": dt.date.today().isoformat(), "files": []}
    for item in listing:
        name = item["name"]
        if not (name.endswith(".txt") or name in {"LICENSE", "README.md"}):
            continue
        blob = get(f"https://raw.githubusercontent.com/{REPO}/{sha}/{name}")
        (RAW / name).write_bytes(blob)
        prov["files"].append({"name": name, "bytes": len(blob),
                              "sha256": hashlib.sha256(blob).hexdigest()})
        print(f"{name:20s} {len(blob):>12,d} bytes")
    (RAW / "PROVENANCE.json").write_text(json.dumps(prov, indent=2), encoding="utf-8")
    print(f"pinned {len(prov['files'])} files at commit {sha}")


if __name__ == "__main__":
    main()
