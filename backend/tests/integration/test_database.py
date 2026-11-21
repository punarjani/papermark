"""Database tests. Require TEST_DATABASE_URL pointing at a disposable PostgreSQL database."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from tests.conftest import TEST_DATABASE_URL, ClientFactory, make_settings, requires_db

pytestmark = [pytest.mark.db, requires_db]

BACKEND_DIR = Path(__file__).resolve().parents[2]


def _alembic(*args: str) -> None:
    env = {**os.environ, "DATABASE_URL": TEST_DATABASE_URL or "", "DATABASE_SSL": "false"}
    subprocess.run(  # noqa: S603 - fixed argv, no shell
        [sys.executable, "-m", "alembic", *args], cwd=BACKEND_DIR, env=env, check=True
    )


def _run_module(module: str) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "DATABASE_URL": TEST_DATABASE_URL or "", "DATABASE_SSL": "false"}
    return subprocess.run(  # noqa: S603 - fixed argv, no shell
        [sys.executable, "-m", module],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


async def test_ready_ok_with_database(client_factory: ClientFactory) -> None:
    async with client_factory(make_settings(database_url=TEST_DATABASE_URL)) as c:
        r = await c.get("/api/v1/health/ready")
    assert r.status_code == 200
    assert r.json() == {"status": "ready", "checks": {"database": "ok"}}


async def test_migrations_upgrade_downgrade_roundtrip() -> None:
    _alembic("upgrade", "head")
    _alembic("downgrade", "base")
    _alembic("upgrade", "head")

    settings = make_settings(database_url=TEST_DATABASE_URL)
    assert settings.database_url is not None
    engine = create_async_engine(settings.database_url.get_secret_value())
    async with engine.connect() as conn:
        version = (await conn.execute(text("select version_num from app.alembic_version"))).scalar()
        in_public = (
            await conn.execute(text("select to_regclass('public.alembic_version')"))
        ).scalar()
        enum_labels = (
            await conn.execute(text("select enum_range(null::public.valuation_type)::text"))
        ).scalar()
    await engine.dispose()

    assert version == "0001"
    assert in_public is None, "alembic_version must not live in the API-exposed schema"
    assert enum_labels == "{first,second,moderation}"


async def test_check_rls_passes_on_migrated_schema() -> None:
    _alembic("upgrade", "head")
    result = _run_module("scripts.check_rls")
    assert result.returncode == 0, result.stderr


async def test_check_rls_detects_unprotected_table() -> None:
    _alembic("upgrade", "head")
    settings = make_settings(database_url=TEST_DATABASE_URL)
    assert settings.database_url is not None
    engine = create_async_engine(settings.database_url.get_secret_value())
    async with engine.begin() as conn:
        await conn.execute(text("create table public.rls_probe (id int)"))
    try:
        result = _run_module("scripts.check_rls")
        assert result.returncode == 1
        assert "public.rls_probe" in result.stderr
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("drop table public.rls_probe"))
        await engine.dispose()
