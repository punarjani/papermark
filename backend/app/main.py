"""FastAPI application factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.v1 import api_router
from app.config import Settings, get_settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging
from app.core.middleware import RequestContextMiddleware
from app.db.session import build_engine, build_sessionmaker


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = build_engine(settings)
        app.state.db_engine = engine
        app.state.db_sessionmaker = build_sessionmaker(engine) if engine else None
        try:
            yield
        finally:
            if engine is not None:
                await engine.dispose()

    docs = settings.expose_docs or settings.environment in ("development", "test")
    app = FastAPI(
        title="PaperMark API",
        version=__version__,
        lifespan=lifespan,
        docs_url=f"{settings.api_prefix}/docs" if docs else None,
        redoc_url=None,
        openapi_url=f"{settings.api_prefix}/openapi.json" if docs else None,
    )
    app.state.settings = settings

    # Order: CORS is innermost so the request-context middleware also wraps CORS replies.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,  # bearer tokens, not cookies
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "If-Match",
            "Idempotency-Key",
            "X-Request-ID",
        ],
        expose_headers=["X-Request-ID", "ETag"],
        max_age=600,
    )
    app.add_middleware(
        RequestContextMiddleware,
        enable_hsts=settings.environment in ("staging", "production"),
    )

    register_error_handlers(app)
    app.include_router(api_router, prefix=settings.api_prefix)
    return app


app = create_app()
