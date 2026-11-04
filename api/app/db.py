from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

def normalise_database_url(url: str) -> str:
    """Use the installed PostgreSQL driver without rewriting credentials or query options."""
    if url.startswith(("postgres://", "postgresql://")):
        return "postgresql+psycopg://" + url.partition("://")[2]
    return url


def make_engine(database_url: str):
    url = normalise_database_url(database_url)
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, connect_args=connect_args, pool_pre_ping=True)


engine = make_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
