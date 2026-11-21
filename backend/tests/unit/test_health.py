from __future__ import annotations

import httpx
from fastapi import APIRouter

from app import __version__
from app.main import create_app
from tests.conftest import ClientFactory, make_settings


async def test_health_ok(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "service": "papermark-api", "version": __version__}


async def test_ready_reports_not_configured_without_database(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/v1/health/ready")
    assert r.status_code == 503
    assert r.json() == {"status": "not_ready", "checks": {"database": "not_configured"}}


async def test_ready_reports_unavailable_without_leaking_details(
    client_factory: ClientFactory,
) -> None:
    # Port 1 on localhost: connection refused quickly, no real server involved.
    settings = make_settings(database_url="postgresql://user:s3cret@127.0.0.1:1/none")
    async with client_factory(settings) as c:
        r = await c.get("/api/v1/health/ready")
    assert r.status_code == 503
    assert r.json() == {"status": "not_ready", "checks": {"database": "unavailable"}}
    assert "s3cret" not in r.text


async def test_security_headers_present(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/v1/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert r.headers["cache-control"] == "no-store"
    assert "default-src 'none'" in r.headers["content-security-policy"]
    # HSTS only in deployed environments.
    assert "strict-transport-security" not in r.headers


async def test_hsts_in_production(client_factory: ClientFactory) -> None:
    settings = make_settings(
        environment="production",
        database_url="postgresql://u:p@127.0.0.1:1/db",
        database_ssl=True,
        cors_origins=["https://papermark.example.edu"],
    )
    async with client_factory(settings) as c:
        r = await c.get("/api/v1/health")
    assert r.headers["strict-transport-security"].startswith("max-age=")


async def test_request_id_generated_and_echoed(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/v1/health")
    assert len(r.headers["x-request-id"]) == 32

    r = await client.get("/api/v1/health", headers={"X-Request-ID": "abc12345-trace"})
    assert r.headers["x-request-id"] == "abc12345-trace"


async def test_unsafe_request_id_is_replaced(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/v1/health", headers={"X-Request-ID": "<script>alert(1)</script>"})
    assert r.headers["x-request-id"] != "<script>alert(1)</script>"


async def test_not_found_uses_error_envelope(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/v1/does-not-exist")
    assert r.status_code == 404
    body = r.json()
    assert body["error"]["code"] == "NOT_FOUND"
    assert body["error"]["request_id"] == r.headers["x-request-id"]


async def test_unhandled_error_does_not_leak(client_factory: ClientFactory) -> None:
    app = create_app(make_settings())
    boom = APIRouter()

    @boom.get("/boom")
    async def _boom() -> None:
        raise RuntimeError("database password is hunter2")

    app.include_router(boom, prefix="/api/v1")
    async with client_factory(app=app) as c:
        r = await c.get("/api/v1/boom")
    assert r.status_code == 500
    assert r.json()["error"]["code"] == "INTERNAL_ERROR"
    assert "hunter2" not in r.text


async def test_cors_allows_configured_origin(client: httpx.AsyncClient) -> None:
    r = await client.options(
        "/api/v1/health",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


async def test_cors_rejects_unknown_origin(client: httpx.AsyncClient) -> None:
    r = await client.options(
        "/api/v1/health",
        headers={"Origin": "https://evil.example.com", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in r.headers


async def test_docs_hidden_in_production(client_factory: ClientFactory) -> None:
    settings = make_settings(
        environment="production",
        database_url="postgresql://u:p@127.0.0.1:1/db",
        database_ssl=True,
        cors_origins=["https://papermark.example.edu"],
    )
    async with client_factory(settings) as c:
        assert (await c.get("/api/v1/docs")).status_code == 404
        assert (await c.get("/api/v1/openapi.json")).status_code == 404
