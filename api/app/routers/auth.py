"""Adult accounts (FR1): a mobile number confirmed by an SMS code, and one PIN."""
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.security import OAuth2PasswordRequestForm

from .. import schemas
from ..dependencies import DbSession, Sms
from ..security import create_token
from ..services import AccountService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/code", response_model=schemas.CodeSent, status_code=202)
def send_code(body: schemas.CodeRequest, db: DbSession, sms: Sms):
    """Texts a six-digit code to the number: `register` before opening an account (409 if the
    number has one), `reset` before choosing a new PIN (404 if it has none)."""
    return AccountService(db, sms).send_code(body.phone, body.purpose)


@router.post("/register", response_model=schemas.UserOut, status_code=201)
def register(body: schemas.UserCreate, db: DbSession):
    return AccountService(db).register(body)


@router.post("/login", response_model=schemas.Token)
def login(form: Annotated[OAuth2PasswordRequestForm, Depends()], db: DbSession):
    """The username is the mobile number, in any usual spelling, and the password is the PIN.
    Five wrong PINs lock the number for 15 minutes (429)."""
    user = AccountService(db).authenticate(form.username, form.password)
    return schemas.Token(access_token=create_token(user))


@router.post("/reset-pin", status_code=204)
def reset_pin(body: schemas.PinReset, db: DbSession):
    """Replaces a forgotten PIN, with the `reset` code texted to the number."""
    AccountService(db).reset_pin(body)


@router.post("/change-pin", status_code=204)
def change_pin(body: schemas.PinChange, db: DbSession):
    """Changes the PIN when the current one is known; it counts towards the lock like a sign-in."""
    AccountService(db).change_pin(body)
