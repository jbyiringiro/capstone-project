"""The shipped symbol catalogue (FR2): seeding from vocab/symbols.csv and key/id lookups."""
from __future__ import annotations

import csv
from collections.abc import Iterable
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models

SYMBOLS_CSV = Path(__file__).resolve().parents[3] / "vocab" / "symbols.csv"


class SymbolCatalogue:
    def __init__(self, db: Session, csv_path: Path = SYMBOLS_CSV) -> None:
        self.db = db
        self.csv_path = csv_path

    def all(self) -> list[models.Symbol]:
        return list(self.db.scalars(
            select(models.Symbol).order_by(models.Symbol.category, models.Symbol.key)))

    def import_csv(self) -> int:
        """Add rows whose key is not stored yet, so a new install has usable vocabulary."""
        existing = set(self.db.scalars(select(models.Symbol.key)).all())
        added = 0
        with open(self.csv_path, encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh):
                if row["symbol_id"] in existing:
                    continue
                self.db.add(models.Symbol(
                    key=row["symbol_id"], label_rw=row["label_rw"], label_en=row["label_en"],
                    category=row["category"],
                    arasaac_id=int(row["arasaac_id"]) if row["arasaac_id"] else None,
                    image_path=row["image_path"] or None))
                added += 1
                existing.add(row["symbol_id"])
        self.db.commit()
        return added

    def ids_by_key(self) -> dict[str, int]:
        return {key: sid for key, sid in self.db.execute(
            select(models.Symbol.key, models.Symbol.symbol_id))}

    def keys_by_id(self) -> dict[int, str]:
        return {sid: key for key, sid in self.ids_by_key().items()}

    def known_ids(self, symbol_ids: Iterable[int]) -> set[int]:
        requested = set(symbol_ids)
        if not requested:
            return set()
        return set(self.db.scalars(select(models.Symbol.symbol_id).where(
            models.Symbol.symbol_id.in_(requested))).all())
