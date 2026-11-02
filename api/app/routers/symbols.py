"""The shipped symbol catalogue (FR2, FR3)."""
from fastapi import APIRouter, Depends

from .. import schemas
from ..dependencies import DbSession
from ..security import require_role
from ..services import SymbolCatalogue

router = APIRouter(prefix="/symbols", tags=["symbols"])


@router.get("", response_model=list[schemas.SymbolOut])
def list_symbols(db: DbSession):
    return SymbolCatalogue(db).all()


@router.post("/import", status_code=201, dependencies=[Depends(require_role("administrator"))])
def import_symbols(db: DbSession):
    """Load vocab/symbols.csv (idempotent by key)."""
    return {"added": SymbolCatalogue(db).import_csv()}
