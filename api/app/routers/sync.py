"""Upload of messages and all-action tap events (FR7)."""
from fastapi import APIRouter

from .. import schemas
from ..dependencies import CurrentUser, DbSession
from ..services import SyncService

router = APIRouter(tags=["sync"])


@router.post("/sync", response_model=schemas.SyncResult)
def sync(body: schemas.SyncRequest, db: DbSession, user: CurrentUser):
    return SyncService(db, user).sync(body)
