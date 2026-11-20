"""The caregiver's account backup: save this device, or bring it back on a new one (FR1)."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from .. import schemas
from ..config import settings
from ..dependencies import CurrentUser, DbSession
from ..services import BackupService

router = APIRouter(prefix="/backup", tags=["backup"])


async def snapshot_body(request: Request) -> schemas.BackupIn:
    """The uploaded snapshot, read no further than the size limit."""
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > settings.max_backup_bytes:
            raise HTTPException(413, "backup too large")
        chunks.append(chunk)
    try:
        return schemas.BackupIn.model_validate_json(b"".join(chunks))
    except ValidationError as error:
        raise RequestValidationError(error.errors(include_url=False, include_context=False)) from None


@router.get("/status", response_model=schemas.BackupStatus)
def backup_status(user: CurrentUser, db: DbSession):
    return BackupService(db, user).status()


# Exactly as saved: `deleted` appears only when the account has deleted children.
@router.get("", response_model=schemas.BackupOut, response_model_exclude_unset=True)
def load_backup(user: CurrentUser, db: DbSession):
    return BackupService(db, user).load()


# The account is checked before the body is read.
@router.put("", response_model=schemas.BackupStatus)
def save_backup(user: CurrentUser, db: DbSession,
                body: Annotated[schemas.BackupIn, Depends(snapshot_body)]):
    """Replaces the account copy if `base_revision` is still its revision (0 before the first
    copy). Otherwise another device saved in between: 409 with that copy's `revision` and
    `saved_at`, and nothing changes. Names, photos and recordings are refused (422)."""
    return BackupService(db, user).save(body)
