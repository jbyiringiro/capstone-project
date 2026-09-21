"""Fetch an ARASAAC pictogram for every symbol in vocab/symbols.csv (CC BY-NC-SA 4.0).

For each row without an arasaac_id, searches the ARASAAC API by the English gloss (with a few
manual query overrides), downloads the 300 px PNG to app/public/symbols/<KEY>.png, and writes
arasaac_id + image_path back into symbols.csv and symbols_draft.csv. Attribution is written to
app/public/symbols/ATTRIBUTION.txt as the licence requires. Re-running only fills gaps; pass
--force to refetch everything. The collaborators can replace any pictogram by editing arasaac_id.

Usage: python ml/scripts/fetch_pictograms.py [--force] [--only WATER,WHERE]
"""
from __future__ import annotations

import argparse
import csv
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
VOCAB = REPO / "vocab"
OUT = REPO / "app" / "public" / "symbols"
UA = {"User-Agent": "vuga-aac/0.1 (ALU capstone; assistive communication)"}

# symbol -> better English search term than the gloss
QUERY = {
    "I": "I", "YOU": "you", "HE_SHE": "he", "WE": "we", "YOU_PL": "you", "THEY": "they",
    "NOT": "no", "THIS": "this", "BE": "be", "WHAT": "what", "GOOD": "good", "BAD": "bad",
    "THANK_YOU": "thank you", "GOOD_MORNING": "good morning", "GOOD_AFTERNOON": "good afternoon",
    "GOODBYE": "goodbye", "HELLO": "hello", "HELP": "help", "WASH_HANDS": "wash",
    "GO_HOME": "home", "GO_OUT": "go out", "WAKE_UP": "wake up", "ASK_FOR": "ask",
    "MUM": "mother", "DAD": "father", "TEACHER": "teacher", "HE_SHE_": "she", "TIME": "time",
    "TOMORROW": "tomorrow", "AGAIN": "again", "VERY": "very", "MANY": "many", "FEW": "few",
    "ONLY": "alone", "ALL": "all", "EVERY": "all", "BEFORE": "before", "AFTER": "after",
    "NOW": "now", "EVENING": "dusk", "ALSO": "and", "HURRY": "run", "MUST": "have to", "CAN": "be able", "WATER": "glass of water", "WHERE": "where", "HERE": "here", "THERE": "there", "PROBLEM": "problem", "PERSON": "person",
    "THING": "object", "DAY": "day", "TV": "television", "PHONE": "telephone", "CAR": "car",
    "POTATOES": "potato", "BEANS": "beans", "SHOES": "shoes", "TROUSERS": "trousers",
    "CLOTHES": "clothes", "PLAYGROUND": "playground", "TOILET": "toilet", "HURT": "pain",
    "SICK": "sick", "HUNGRY": "hungry", "COLD": "cold", "HOT": "hot", "TIRED": "tired",
    "AFRAID": "fear", "ANGRY": "angry", "HAPPY": "happy", "CRY": "cry", "LAUGH": "laugh",
    "CAN": "can", "MUST": "must", "KNOW": "know", "LIKE": "like", "WANT": "want", "NEED": "need",
    "HAVE": "have", "SAY": "say", "DO": "do", "SEE": "see", "LOOK": "look", "HEAR": "hear",
}


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def search(term: str) -> int | None:
    url = f"https://api.arasaac.org/api/pictograms/en/bestsearch/{urllib.parse.quote(term)}"
    try:
        data = json.loads(get(url))
    except Exception:
        return None
    if not data:
        return None
    # prefer pictograms flagged for AAC use when available
    data.sort(key=lambda d: (not d.get("aac", False), not d.get("aacColor", False)))
    return int(data[0]["_id"])


def main() -> None:
    ap = argparse.ArgumentParser(); ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", help="comma-separated symbol keys to (re)fetch")
    args = ap.parse_args()
    only = set(args.only.split(",")) if args.only else None
    OUT.mkdir(parents=True, exist_ok=True)
    rows = list(csv.DictReader(open(VOCAB / "symbols.csv", encoding="utf-8", newline="")))
    attribution = []
    missing = []
    for r in rows:
        key = r["symbol_id"]
        refetch = args.force or (only is not None and key in only)
        if r.get("arasaac_id") and not refetch and (OUT / f"{key}.png").exists():
            attribution.append((key, r["arasaac_id"])); continue
        term = QUERY.get(key, r["label_en"])
        pid = int(r["arasaac_id"]) if (r.get("arasaac_id") and not refetch) else search(term)
        if pid is None:
            missing.append((key, term)); continue
        try:
            png = get(f"https://static.arasaac.org/pictograms/{pid}/{pid}_300.png")
        except Exception as e:
            missing.append((key, f"{term} (download failed: {e})")); continue
        (OUT / f"{key}.png").write_bytes(png)
        r["arasaac_id"] = str(pid); r["image_path"] = f"/symbols/{key}.png"
        attribution.append((key, str(pid)))
        print(f"{key:16s} {term:18s} -> {pid}")
        time.sleep(0.15)
    fields = ["symbol_id", "label_rw", "label_en", "category", "arasaac_id", "image_path"]
    for name in ("symbols.csv", "symbols_draft.csv"):
        path = VOCAB / name
        if not path.exists():
            continue
        existing = {x["symbol_id"]: x for x in csv.DictReader(open(path, encoding="utf-8", newline=""))}
        by_key = {r["symbol_id"]: r for r in rows}
        for k, x in existing.items():
            if k in by_key:
                x["arasaac_id"] = by_key[k]["arasaac_id"]; x["image_path"] = by_key[k]["image_path"]
        with open(path, "w", encoding="utf-8", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=fields); w.writeheader(); w.writerows(existing.values())
    (OUT / "ATTRIBUTION.txt").write_text(
        "Pictographic symbols used are the property of the Government of Aragon and have been created by\n"
        "Sergio Palao for ARASAAC (https://arasaac.org), which distributes them under Creative Commons\n"
        "License BY-NC-SA 4.0. Symbol key -> ARASAAC id:\n" + "\n".join(f"{k} {i}" for k, i in attribution) + "\n",
        encoding="utf-8")
    print(f"\n{len(attribution)} pictograms; {len(missing)} missing: {missing}")


if __name__ == "__main__":
    main()
