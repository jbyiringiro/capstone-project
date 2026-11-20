"""Idempotent additive email-account migration, run before serving requests.

SQLite cannot drop NOT NULL, so its users table is rebuilt inside an explicit transaction while
preserving rows, unique constraints and existing indexes/triggers. Foreign keys are checked before
commit. PostgreSQL uses transactional ALTER TABLE. Back up a deployed database before upgrading.
Run explicitly with: python -m app.migrations (from api/, with the normal VUGA_DATABASE_URL).
"""
from sqlalchemy import Column, MetaData, String, Table, inspect, text
from sqlalchemy.schema import CreateTable

from .db import Base, engine

_ADDITIONS = {"email": 254, "firebase_uid": 128, "firebase_project_id": 128,
              "neon_uid": 128, "neon_auth_url": 512}


def migrate_email_accounts(target) -> None:
    from . import models  # noqa: F401 — populate Base metadata

    if target.dialect.name == "postgresql":
        with target.begin() as conn:
            # Lock before inspecting even an empty database. Keep all DDL, including new
            # tables, in this transaction so simultaneous API workers cannot race create_all.
            conn.execute(text("SELECT pg_advisory_xact_lock(867420611)"))
            if "users" in inspect(conn).get_table_names():
                for name, size in _ADDITIONS.items():
                    conn.execute(text(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {name} VARCHAR({size})"))
                conn.execute(text("ALTER TABLE users ALTER COLUMN phone DROP NOT NULL"))
                conn.execute(text("ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL"))
                _indexes(conn)
            Base.metadata.create_all(conn)
            _neon_deletion_confirmation(conn)
        return
    if target.dialect.name == "sqlite":
        if "users" in inspect(target).get_table_names():
            _sqlite(target)
    else:
        raise RuntimeError("Email account migration supports SQLite and PostgreSQL only")
    Base.metadata.create_all(target)
    with target.begin() as conn:
        _neon_deletion_confirmation(conn)


def _neon_deletion_confirmation(conn) -> None:
    columns = {column["name"] for column in inspect(conn).get_columns("neon_identities")}
    if "provider_deleted" not in columns:
        conn.execute(text("ALTER TABLE neon_identities ADD COLUMN provider_deleted BOOLEAN NOT NULL DEFAULT FALSE"))


def _indexes(conn) -> None:
    conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON users (email)"))
    conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_firebase_identity "
                      "ON users (firebase_project_id, firebase_uid)"))
    conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_neon_identity "
                      "ON users (neon_auth_url, neon_uid)"))


def _sqlite(target) -> None:
    with target.connect() as conn:
        foreign_keys = conn.exec_driver_sql("PRAGMA foreign_keys").scalar()
        conn.commit()
        conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
        conn.commit()
        try:
            conn.exec_driver_sql("BEGIN IMMEDIATE")
            columns = {column["name"]: column for column in inspect(conn).get_columns("users")}
            rebuild = any(not columns[name]["nullable"] for name in ("phone", "password_hash"))
            if rebuild:
                original = Table("users", MetaData(), autoload_with=conn)
                replacement = original.to_metadata(MetaData(), name="users_email_migration")
                replacement.c.phone.nullable = True
                replacement.c.password_hash.nullable = True
                for name, size in _ADDITIONS.items():
                    if name not in replacement.c:
                        replacement.append_column(Column(name, String(size), nullable=True))
                auxiliaries = conn.exec_driver_sql(
                    "SELECT sql FROM sqlite_master WHERE tbl_name='users' "
                    "AND type IN ('index', 'trigger') AND sql IS NOT NULL").scalars().all()
                conn.execute(CreateTable(replacement))
                quoted = ", ".join(conn.dialect.identifier_preparer.quote(name) for name in columns)
                conn.exec_driver_sql(f"INSERT INTO users_email_migration ({quoted}) SELECT {quoted} FROM users")
                conn.exec_driver_sql("DROP TABLE users")
                conn.exec_driver_sql("ALTER TABLE users_email_migration RENAME TO users")
                for statement in auxiliaries:
                    conn.exec_driver_sql(statement)
            else:
                for name, size in _ADDITIONS.items():
                    if name not in columns:
                        conn.exec_driver_sql(f"ALTER TABLE users ADD COLUMN {name} VARCHAR({size})")
            _indexes(conn)
            if conn.exec_driver_sql("PRAGMA foreign_key_check").fetchone() is not None:
                raise RuntimeError("Foreign-key check failed; email account migration rolled back")
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.exec_driver_sql(f"PRAGMA foreign_keys={int(foreign_keys)}")
            conn.commit()


if __name__ == "__main__":
    migrate_email_accounts(engine)
