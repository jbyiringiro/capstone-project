"""Prepare reviewed online photographs for Vuga (requires Pillow).

Reads the two curated source catalogs; does not search or select images. All
181 words must have explicit source/creator/licence metadata and verified local
source bytes before any runtime image is replaced. Source photos remain intact.
Run from the repository: .venv/Scripts/python.exe scripts/prepare_licensed_photos.py
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import html
import io
import json
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

REPO = Path(__file__).resolve().parents[1]
WORKSPACE = REPO.parent
SOURCE = WORKSPACE / "design/licensed-photo-sources"
OUTPUT = REPO / "app/public/photos"
DATE = "2026-10-10"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true", help="restore missing originals from pinned source URLs and verify their hashes")
    args = parser.parse_args()
    with (REPO / "vocab/symbols.csv").open(encoding="utf-8-sig", newline="") as stream:
        vocabulary = list(csv.DictReader(stream))
    records = []
    catalogs = [SOURCE / filename for filename in ("catalog-a.json", "catalog-b.json")]
    if all(path.exists() for path in catalogs):
        for path in catalogs:
            records.extend(json.loads(path.read_text(encoding="utf-8-sig")))
    else:
        records = json.loads((OUTPUT / "manifest.json").read_text(encoding="utf-8"))["images"]
    ids = [row["symbol_id"] for row in records]
    assert len(ids) == len(set(ids)) == len(vocabulary), "Duplicate or missing source assignments"
    sources = {row["symbol_id"]: row for row in records}
    assert set(sources) == {row["symbol_id"] for row in vocabulary}
    prepared = []
    for symbol in vocabulary:
        record = dict(sources[symbol["symbol_id"]])
        # Commons sometimes emits the legacy HTTP form of a CC deed. Preserve
        # that evidence and publish its equivalent secure URL in the credits.
        if record.get("license_url", "").startswith("http://creativecommons.org/"):
            record["source_license_url"] = record["license_url"]
            record["license_url"] = "https://" + record["license_url"][7:]
        for field in ("title", "creator", "source_page", "download_url", "license", "license_url", "retrieved_at", "source_file", "source_sha256"):
            assert record.get(field), f"Missing {field}: {symbol['symbol_id']}"
        assert record.get("synthetic") is False, f"Generated source: {symbol['symbol_id']}"
        assert record["source_page"].startswith("https://")
        assert record["license_url"].startswith("https://")
        assert record["license_url"].startswith(("https://creativecommons.org/", "https://www.pexels.com/license", "https://commons.wikimedia.org/")), "Unreviewed licence family"
        source = (WORKSPACE / record["source_file"]).resolve()
        assert source.is_relative_to(SOURCE.resolve()), "Source path outside reviewed source folder"
        if not source.exists() and args.download:
            request = urllib.request.Request(record["download_url"], headers={"User-Agent": "VugaEducationalPrototype/1.0"})
            with urllib.request.urlopen(request, timeout=60) as response:
                downloaded = response.read()
            assert digest(downloaded) == record["source_sha256"], f"Downloaded source changed: {source.name}"
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_bytes(downloaded)
        if not source.exists():
            raise FileNotFoundError(f"Missing {source.name}. Pass --download to restore the pinned original.")
        original = source.read_bytes()
        assert digest(original) == record["source_sha256"], f"Source changed: {source.name}"
        with Image.open(io.BytesIO(original)) as opened:
            photo = ImageOps.exif_transpose(opened).convert("RGB")
            photo = ImageOps.contain(photo, (480, 480), Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", (480, 480), "#f7f5ec")
            canvas.paste(photo, ((480 - photo.width) // 2, (480 - photo.height) // 2))
            buffer = io.BytesIO()
            canvas.save(buffer, format="WEBP", quality=85, method=6)
        data = buffer.getvalue()
        metadata = {
            **record, "label_rw": symbol["label_rw"],
            "url": f"/photos/{symbol['symbol_id']}.webp",
            "width": 480, "height": 480, "format": "image/webp", "bytes": len(data),
            "sha256": digest(data), "source_original_sha256": digest(original),
            "changes": "Resized to fit a 480 × 480 cream canvas and converted to WebP; no crop, retouching or generative edits.",
        }
        prepared.append((metadata, data))
    OUTPUT.mkdir(exist_ok=True, parents=True)
    for metadata, data in prepared:
        (OUTPUT / f"{metadata['symbol_id']}.webp").write_bytes(data)
    images = [metadata for metadata, _ in prepared]
    manifest = {
        "version": 2, "prepared_at": DATE, "language": "rw", "synthetic": False,
        "description": "Online photographs with per-image reuse licences, attribution and source records. Educational communication prototype; recognition has not been validated with learners.",
        "optimisation": {"method": "Pillow contain and WebP encoding", "width": 480, "height": 480, "quality": 85, "crop": False},
        "coverage": {"expected": len(vocabulary), "available": len(images), "complete": True, "missing": [], "pending_provenance": []},
        "images": images,
    }
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    esc = html.escape
    cards = []
    for entry in images:
        notice = " · ".join(str(entry.get(field, "")) for field in ("credit", "copyright_notice") if entry.get(field))
        cards.append(f'<article><img src="{entry["symbol_id"]}.webp" alt=""><div><h2>{esc(entry["label_rw"])}</h2><p>{esc(entry["creator"])}</p><p><a href="{esc(entry["source_page"], quote=True)}">Aho ifoto yaturutse</a> · <a href="{esc(entry["license_url"], quote=True)}">{esc(entry["license"])}</a></p><small>{esc(entry["symbol_id"])}</small><details><summary>Izina ry’umwimerere</summary><p>{esc(entry["title"])}</p><p>{esc(notice)}</p></details></div></article>')
    credits = '''<!doctype html><html lang="rw"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vuga · Abafashe amafoto</title>
<style>body{max-width:1000px;margin:auto;padding:28px;background:#f7f5ec;color:#173d37;font:18px/1.6 system-ui,sans-serif}a{color:#176b62}h1{line-height:1.2}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:16px}article{display:flex;gap:16px;background:white;padding:16px;border-radius:16px;overflow-wrap:anywhere}article img{width:100px;height:100px;object-fit:contain}h2,p{margin:0 0 8px}h2{font-size:21px}small{color:#5e706a}</style>
<header><a href="/">← Subira ku kibaho</a><h1>Abafashe amafoto n’uburenganzira bwo kuyakoresha</h1>
<p>Aya mafoto yaturutse kuri interineti. Buri foto ifite uwafashe ifoto, aho yaturutse n’uruhushya rwo kuyikoresha. Yagabanyijwe mu bunini, ishyirwa ku buso bwa kare kandi ibikwa mu buryo bwa WebP; nta gice cyayo cyaciwe.</p>
<p>Amafoto arimo abantu ntiyemeza ko abo bantu bafite ubumuga cyangwa ko bakoresha Vuga. Amashusho n’amagambo biracyakeneye gusuzumwa n’abazabikoresha.</p>
<p><a href="manifest.json">Amakuru yose y’amafoto</a></p></header><main>'''
    (OUTPUT / "credits.html").write_text(credits + "\n".join(cards) + "</main></html>\n", encoding="utf-8")
    print(json.dumps({"photos": len(images), "bytes": sum(row["bytes"] for row in images), "licenses": sorted({row["license"] for row in images}), "synthetic": False}))


if __name__ == "__main__":
    main()
