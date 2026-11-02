"""Adult accounts (FR1)."""
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.security import OAuth2PasswordRequestForm

from .. import schemas
from ..dependencies import DbSession
from ..security import create_token
from ..services import AccountService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=schemas.UserOut, status_code=201)
def register(body: schemas.UserCreate, db: DbSession):
    return AccountService(db).register(body)


@router.post("/login", response_model=schemas.Token)
def login(form: Annotated[OAuth2PasswordRequestForm, Depends()], db: DbSession):
    user = AccountService(db).authenticate(form.username, form.password)
    return schemas.Token(access_token=create_token(user))
