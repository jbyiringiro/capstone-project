"""Hosted database URLs and connection options, without connecting to a database."""
from unittest.mock import Mock, sentinel

import pytest

from app import db


@pytest.mark.parametrize("scheme", ["postgres", "postgresql", "postgresql+psycopg"])
def test_hosted_postgres_urls_preserve_credentials_and_options(scheme):
    # Percent-encoded delimiters must not be decoded and rebuilt: they belong to credentials
    # or option values, not to the URL's separators.
    address = (
        "user%40example:p%40ss%2Fword%3A%25@db.example:5432/vuga"
        "?sslmode=verify-full&sslrootcert=%2Fetc%2Fca.pem"
        "&options=-csearch_path%3Dvuga%2Cpublic"
    )
    assert db.normalise_database_url(f"{scheme}://{address}") == f"postgresql+psycopg://{address}"


@pytest.mark.parametrize("url", [
    "sqlite:///./vuga_dev.db",
    "sqlite:///:memory:",
    "sqlite+pysqlite:///file:vuga.db?mode=ro&uri=true",
    "postgresql+psycopg2://user:password@db.example/vuga?sslmode=require",
])
def test_other_database_urls_are_left_unchanged(url):
    assert db.normalise_database_url(url) == url


@pytest.mark.parametrize(("url", "expected_url", "connect_args"), [
    ("postgres://user:password@db.example/vuga?sslmode=require",
     "postgresql+psycopg://user:password@db.example/vuga?sslmode=require", {}),
    ("sqlite:///:memory:", "sqlite:///:memory:", {"check_same_thread": False}),
    ("sqlite+pysqlite:///file:vuga.db?mode=ro&uri=true",
     "sqlite+pysqlite:///file:vuga.db?mode=ro&uri=true", {"check_same_thread": False}),
])
def test_engine_keeps_sqlite_thread_support_and_checks_pooled_connections(
    monkeypatch, url, expected_url, connect_args
):
    factory = Mock(return_value=sentinel.engine)
    monkeypatch.setattr(db, "create_engine", factory)
    assert db.make_engine(url) is sentinel.engine
    factory.assert_called_once_with(
        expected_url, connect_args=connect_args, pool_pre_ping=True
    )
