"""Request-scoped dependencies shared by the routers."""
from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from . import models
from .db import get_db
from .security import current_user
from .services import NotFound, ProfileService, SmsSender
from .services.prediction import Predictor

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[models.User, Depends(current_user)]


def owned_profile(profile_id: str, db: DbSession, user: CurrentUser) -> models.ChildProfile:
    """The path's profile if the caller created it; other accounts' profiles look missing."""
    profile = ProfileService(db).owned(profile_id, user)
    if profile is None:
        raise NotFound("profile not found")
    return profile


OwnedProfile = Annotated[models.ChildProfile, Depends(owned_profile)]


def get_model() -> Predictor | None:
    """The served predictor, resolved per request through the composition root (app.main)."""
    from . import main

    return main.load_model()


ServedModel = Annotated[Predictor | None, Depends(get_model)]


def get_sms() -> SmsSender:
    """The SMS sender for codes, chosen in the composition root (app.main); tests replace it."""
    from . import main

    return main.sms


Sms = Annotated[SmsSender, Depends(get_sms)]
