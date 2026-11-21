"""Alembic environment.

Alembic is the single source of truth for the schema, RLS policies and storage policies.
The version table lives in the private `app` schema, which Supabase's Data API does not
expose, so it is never readable with the public (anon) key.
"""

from __future__ import annotations

import asyncio
from logging.config import fileConfig
from typing import Any

from alembic import context
from sqlalchemy import pool, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import Settings

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# ORM metadata is added from Phase 1; migrations are hand-written SQL-first for RLS clarity.
target_metadata = None

VERSION_SCHEMA = "app"


def _database_url_and_args() -> tuple[str, dict[str, Any]]:
    url = config.attributes.get("database_url")
    settings = Settings()
    if url is None:
        if settings.database_url is None:
            raise RuntimeError("DATABASE_URL is not set; refusing to run migrations.")
        url = settings.database_url.get_secret_value()
    connect_args: dict[str, Any] = {"ssl": "require"} if settings.database_ssl else {}
    return url, connect_args


def _run(connection: Connection) -> None:
    connection.execute(text(f"create schema if not exists {VERSION_SCHEMA}"))
    connection.commit()
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        version_table_schema=VERSION_SCHEMA,
        transaction_per_migration=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    url, connect_args = _database_url_and_args()
    engine = create_async_engine(url, poolclass=pool.NullPool, connect_args=connect_args)
    async with engine.connect() as connection:
        await connection.run_sync(_run)
    await engine.dispose()


if context.is_offline_mode():
    raise RuntimeError("Offline (--sql) mode is not supported; run against a database.")

asyncio.run(run_migrations_online())
