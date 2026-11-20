"""Child profiles, their enabled vocabulary (FR2) and the caregiver summary (FR8)."""
from fastapi import APIRouter

from .. import schemas
from ..dependencies import CurrentUser, DbSession, OwnedProfile
from ..services import ProfileService, SummaryService

router = APIRouter(prefix="/profiles", tags=["profiles"])


@router.post("", response_model=schemas.ProfileOut, status_code=201)
def create_profile(body: schemas.ProfileCreate, db: DbSession, user: CurrentUser):
    return ProfileService(db).create(user, body)


@router.get("", response_model=list[schemas.ProfileOut])
def list_profiles(db: DbSession, user: CurrentUser):
    return ProfileService(db).list_for(user)


@router.patch("/{profile_id}", response_model=schemas.ProfileOut)
def update_profile(body: schemas.ProfileUpdate, db: DbSession, profile: OwnedProfile):
    """A new code or age band; the id, words and synced messages stay the child's (409 if another
    child has the code)."""
    return ProfileService(db).update(profile, body)


@router.delete("/{profile_id}", status_code=204)
def delete_profile(db: DbSession, profile: OwnedProfile):
    """Erases the child and all the server keeps for them; another account's child is 404."""
    ProfileService(db).delete(profile)


@router.put("/{profile_id}/vocabulary")
def set_vocabulary(body: schemas.VocabularyUpdate, db: DbSession, profile: OwnedProfile):
    enabled = ProfileService(db).replace_vocabulary(profile, body.symbol_ids)
    return {"profile_id": profile.profile_id, "enabled": enabled}


@router.get("/{profile_id}/vocabulary", response_model=list[schemas.SymbolOut])
def get_vocabulary(db: DbSession, profile: OwnedProfile):
    return ProfileService(db).vocabulary(profile)


@router.get("/{profile_id}/summary")
def summary(db: DbSession, profile: OwnedProfile):
    return SummaryService(db).for_profile(profile)
