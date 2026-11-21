"""Fail (exit 1) if any table in an API-exposed schema lacks forced Row Level Security.

Supabase's Data API exposes the `public` schema to anyone holding the publishable key,
so every table there must have RLS enabled *and* forced. Run in CI after migrations.

Usage: uv run python -m scripts.check_rls   (reads DATABASE_URL)
"""

from __future__ import annotations

import asyncio
import sys

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import Settings

EXPOSED_SCHEMAS = ("public",)

QUERY = text(
    """
    select n.nspname as schema, c.relname as table,
           c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname = any(:schemas)
    order by 1, 2
    """
)


async def main() -> int:
    settings = Settings()
    if settings.database_url is None:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 2
    connect_args = {"ssl": "require"} if settings.database_ssl else {}
    engine = create_async_engine(
        settings.database_url.get_secret_value(), connect_args=connect_args
    )
    async with engine.connect() as conn:
        rows = (await conn.execute(QUERY, {"schemas": list(EXPOSED_SCHEMAS)})).all()
    await engine.dispose()

    failures = [r for r in rows if not (r.rls_enabled and r.rls_forced)]
    print(f"Checked {len(rows)} table(s) in {', '.join(EXPOSED_SCHEMAS)}.")
    for r in failures:
        print(f"  MISSING FORCED RLS: {r.schema}.{r.table}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
