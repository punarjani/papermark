from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app import __version__
from app.db.session import check_database

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str


class ReadinessResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    checks: dict[str, str]


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Liveness: the process is up. Does not touch dependencies."""
    return HealthResponse(status="ok", service="papermark-api", version=__version__)


@router.get(
    "/health/ready",
    response_model=ReadinessResponse,
    responses={503: {"model": ReadinessResponse}},
)
async def ready(request: Request) -> JSONResponse:
    """Readiness: dependencies reachable. Reports status words only, never error details."""
    db_status = await check_database(request.app.state.db_engine)
    body = ReadinessResponse(
        status="ready" if db_status == "ok" else "not_ready",
        checks={"database": db_status},
    )
    return JSONResponse(status_code=200 if db_status == "ok" else 503, content=body.model_dump())
