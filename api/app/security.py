from datetime import UTC, datetime, timedelta
from typing import Annotated

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import User

oauth2 = OAuth2PasswordBearer(tokenUrl="/auth/login")


def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except ValueError:
        return False


def create_token(user: User) -> str:
    exp = datetime.now(UTC) + timedelta(minutes=settings.jwt_expire_minutes)
    # `ver` ties the session to the PIN it was opened with (User.token_version).
    return jwt.encode({"sub": user.user_id, "role": user.role, "ver": user.token_version, "exp": exp},
                      settings.jwt_secret, algorithm=settings.jwt_algorithm)


def current_user(token: Annotated[str, Depends(oauth2)],
                 db: Annotated[Session, Depends(get_db)]) -> User:
    # Email accounts use Google's ID token directly. Only their provider's fixed RS256
    # verifier can accept it; phone accounts continue using Vuga's HS256 tokens.
    if token.startswith("neon."):
        if settings.email_auth_provider != "neon":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token")
        from .services.email_accounts import EmailAccountService

        return EmailAccountService(db).authenticate(token)
    try:
        if jwt.get_unverified_header(token).get("alg") == "RS256":
            if settings.email_auth_provider != "firebase":
                raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token")
            from .services.email_accounts import EmailAccountService

            return EmailAccountService(db).authenticate(token)
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token") from None
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        subject = payload.get("sub")
        user = db.get(User, subject) if isinstance(subject, str) and subject else None
    except JWTError:
        user = None
    # A session opened before the PIN last changed is over.
    if user is None or user.firebase_uid is not None or user.neon_uid is not None or payload.get("ver") != user.token_version:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token")
    return user


def require_role(*roles: str):
    def dep(user: Annotated[User, Depends(current_user)]) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")
        return user
    return dep
