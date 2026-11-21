"""Async database engine and session factory.

The engine is created lazily so the API can start (and report "not ready") when the
database is not configured or unreachable, instead of crashing on import.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from app.config import Settings

logger = logging.getLogger("papermark.db")


def build_engine(settings: Settings) -> AsyncEngine | None:
    if settings.database_url is None:
        return None
    connect_args: dict[str, Any] = {"timeout": 10, "command_timeout": 30}
    if settings.database_ssl:
        connect_args["ssl"] = "require"
    return create_async_engine(
        settings.database_url.get_secret_value(),
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        pool_pre_ping=True,
        pool_recycle=1800,
        connect_args=connect_args,
    )


def build_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[Any]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def check_database(engine: AsyncEngine | None, timeout_s: float = 5.0) -> str:
    """Return "ok", "not_configured" or "unavailable". Never raises, never leaks details."""
    if engine is None:
        return "not_configured"
    try:
        async with asyncio.timeout(timeout_s), engine.connect() as conn:
            await conn.execute(text("select 1"))
        return "ok"
    except Exception:
        logger.warning("Database readiness check failed", exc_info=True)
        return "unavailable"
