# Phase 0 Report — Foundations

Date: 2026-11-21 · Status: implemented locally, awaiting review and cloud provisioning

## Delivered

| Area | Result |
|---|---|
| Repository | Git (`main`), `.gitignore` blocking env files, keys, PDFs, spreadsheets, dumps; `.gitattributes`; `.editorconfig` |
| Backend | FastAPI app factory, pydantic-settings config with production validation, JSON logging, request IDs, security headers, CORS allow-list, uniform error envelope, `GET /api/v1/health`, `GET /api/v1/health/ready` |
| Database | Async SQLAlchemy engine (lazy, SSL), Alembic (async env, version table in private `app` schema), migration `0001` (20 enum types, `app.set_updated_at`, `app.forbid_mutation`), `scripts/check_rls.py` |
| Frontend | Vite 8 + React 19 + TS (strict) + Tailwind 4 + React Router + TanStack Query + Axios; env validation that rejects Supabase secret keys; API client with error-envelope parsing; layout, route error boundary; live System Status page |
| CI | `backend-ci`, `frontend-ci`, `repo-guard` (gitleaks + forbidden files), `ai-deps`, `migrate` (manual, per environment) |
| Deployment config | `render.yaml` (free plan = dev/pilot), `frontend/vercel.json`, `frontend/public/_headers` (Cloudflare Pages) |
| Docs | Architecture rev 2 with review decisions; schema rev 2 with valuation, moderation, discrepancies, final results, mark history; API rev 2 with review/approval endpoints; deployment rev 2; development setup guide |

## Dependency verification

- Python 3.12.13 installed through uv; `requires-python = ">=3.12,<3.13"`.
- `uv.lock` resolves 100 packages, including the optional `ai` group.
- **PaddleOCR:** `paddlepaddle 3.2.2` + `paddleocr 3.3.3` + `pymupdf 2.1` installed on Windows
  (Python 3.12, CPU). `import`, `paddle.utils.run_check()` ("PaddlePaddle works well on 1 CPU")
  and `from paddleocr import PaddleOCR` all passed. The lock has cp312 wheels for Linux x86_64,
  Windows and macOS arm64. Linux is checked by the `ai-deps` workflow.
- Not yet verified: running OCR on a real page (needs a model download) and the CUDA build.
  Both are Phase 8 work.

## Test results (local)

Backend (`uv run python -m pytest -q`, with disposable PostgreSQL 16 via `pgserver`):

```
25 passed in 15.09s
ruff check: All checks passed · ruff format: 23 files already formatted · mypy --strict: no issues in 21 files
```

Covered: health/readiness (not configured, unreachable without leaking credentials, ready);
security headers; HSTS only in deployed envs; request-ID generation, echo and sanitising;
404 envelope; 500 without leaking exception text; CORS allow/deny; docs hidden in production;
config validation (DB URL normalisation, secret masking, production CORS/SSL rules);
Alembic upgrade → downgrade → upgrade round trip; version table not in `public`; RLS guard
passes on the migrated schema and detects an unprotected table.

Frontend:

```
oxlint: 0 warnings · tsc -b: ok · vitest: 9 passed (2 files) · vite build: ok (134 kB gzip JS)
npm audit (prod): 0 vulnerabilities
```

Live smoke test: `uvicorn` against PostgreSQL → `/health` 200, `/health/ready` 200
`{"database":"ok"}`, OpenAPI served in development.

## Deployment URLs

None yet. Deploying needs accounts that only you can create or authorise (see blockers).
Nothing has been pushed or deployed.

## Blockers / actions for you

1. **GitHub:** create a **private** repository and send its URL. `gh` CLI is not installed here.
   I will then add the remote and push.
2. **Supabase dev project:** create it and put the values in `backend/.env` (copy
   `.env.example`) on your machine, not in chat. Then I run `alembic upgrade head`
   and `check_rls` against it. Also add `DATABASE_URL` as a secret in the GitHub Environment
   `development`.
3. **Render:** connect the GitHub repo as a Blueprint (`render.yaml`). Enter the secret env vars
   in the dashboard.
4. **Frontend host:** connect the repo to Cloudflare Pages (recommended for institutional use)
   or Vercel Hobby (personal dev only). Root `frontend`, output `dist`, set `VITE_API_BASE_URL`.
5. After deploy, add the frontend origin to the API's `CORS_ORIGINS`.

## Known local environment issues

- Windows Smart App Control blocks `pytest.exe` and SQLAlchemy's Cython DLL. Workaround is
  documented in docs/development-setup.md. CI and production are not affected.
- Docker is not used.

## Not in Phase 0 (by design)

Authentication, tables beyond enums, storage buckets, and every business feature start in
Phase 1+. The System Status page is a real API integration, not a mockup. It is replaced by
the login screen in Phase 1.
