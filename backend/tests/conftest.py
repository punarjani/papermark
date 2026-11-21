from __future__ import annotations

import os
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from app.config import Settings
from app.main import create_app

# Tests that need PostgreSQL read this. Point it at a disposable database only —
# never at a Supabase project that holds real data. CI provides a Postgres service.
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

requires_db = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL not set")


def make_settings(**overrides: Any) -> Settings:
    base: dict[str, Any] = {
        "environment": "test",
        "database_url": None,
        "database_ssl": False,
        "cors_origins": ["http://localhost:5173"],
        "log_level": "WARNING",
    }
    base.update(overrides)
    return Settings(_env_file=None, **base)


ClientFactory = Callable[..., AbstractAsyncContextManager[httpx.AsyncClient]]


@pytest.fixture
def client_factory() -> ClientFactory:
    @asynccontextmanager
    async def factory(
        settings: Settings | None = None, app: FastAPI | None = None
    ) -> AsyncIterator[httpx.AsyncClient]:
        app = app or create_app(settings or make_settings())
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
                yield c

    return factory


@pytest.fixture
async def client(client_factory: ClientFactory) -> AsyncIterator[httpx.AsyncClient]:
    async with client_factory() as c:
        yield c
