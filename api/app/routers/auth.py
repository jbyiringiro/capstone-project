"""Adult accounts (FR1): a mobile number confirmed by an SMS code, and one PIN."""
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.security import OAuth2PasswordRequestForm

from .. import schemas
from ..dependencies import CurrentUser, DbSession, Sms
from ..security import create_token
from ..services import AccountService
from ..services.email_accounts import EmailAccountService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/email/session", response_model=schemas.EmailSessionOut)
def email_session(body: schemas.EmailSessionIn, db: DbSession):
    """Link a verified Firebase Email/Password identity; name is required on first sign-in.

    The returned bearer is the Firebase ID token itself and expires with it. Passwords and
    refresh tokens stay outside Vuga's API. Existing phone accounts are kept separate.
    """
    user = EmailAccountService(db).session(body)
    return schemas.EmailSessionOut(access_token=body.id_token, user=schemas.UserOut.model_validate(user))


@router.post("/email/delete-account", status_code=204)
def delete_email_account(body: schemas.EmailDelete, db: DbSession):
    """Erase Vuga and Firebase account data after a password sign-in within five minutes.

    Retry a partial provider cleanup with the same recent token and user_id. Vuga tombstones
    prevent a deleted UID from recreating an account, including after provider outages.
    """
    EmailAccountService(db).delete_account(body)


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


@router.get("/me", response_model=schemas.UserOut)
def me(user: CurrentUser):
    """The signed-in account: its name (empty for accounts opened before names were asked for)
    and number."""
    return user


@router.post("/reset-pin", status_code=204)
def reset_pin(body: schemas.PinReset, db: DbSession):
    """Replaces a forgotten PIN, with the `reset` code texted to the number."""
    AccountService(db).reset_pin(body)


@router.post("/change-pin", status_code=204)
def change_pin(body: schemas.PinChange, db: DbSession):
    """Changes the PIN when the current one is known; it counts towards the lock like a sign-in."""
    AccountService(db).change_pin(body)


@router.post("/delete-account", status_code=204)
def delete_account(body: schemas.AccountDelete, db: DbSession):
    """Erases the account and everything it keeps on the server, with the current PIN, which counts
    towards the lock like a sign-in. Its sessions end, and the number can open a new account."""
    AccountService(db).delete_account(body)
