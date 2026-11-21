# 07 — Cloud Deployment Architecture

Status: APPROVED (rev 2) · Phase 0 configuration implemented

## 1. Topology

```
GitHub (private repo: main + PR branches)
   ├─► GitHub Actions: backend-ci · frontend-ci · repo-guard · ai-deps · migrate (manual)
   ├─► Frontend host (static SPA)
   │      dev/pilot: Vercel Hobby (personal, non-commercial) or Cloudflare Pages
   │      institutional: Cloudflare Pages · Render Static Site · Vercel Pro
   └─► Render: FastAPI web service (render.yaml)
              dev/pilot: plan free  ·  production: starter+ with worker service

Supabase — three separate projects, separate credentials:
   papermark-dev   (synthetic data only)
   papermark-stg   (synthetic / anonymised data)
   papermark-prod  (real student data — Pro plan required)

AI inference (optional; app is fully usable without it):
   dev:  Ollama on the developer machine (RTX 3050 4 GB — experiments only)
   prod: institution-owned GPU server, Ollama or vLLM, reachable only by the worker
         (private network / VPN or IP allow-list + API key)
```

Nothing in production depends on the developer's computer.

## 2. Environments

| | development | staging | production |
|---|---|---|---|
| Supabase project | `papermark-dev` (Free) | `papermark-stg` (Free or Pro) | `papermark-prod` (**Pro**) |
| Data | synthetic only | synthetic / anonymised | real |
| API | local `uvicorn` or Render Free `papermark-api-dev` | Render (Free acceptable for pilots) | Render Starter+ (always on) |
| Jobs | in-process | in-process | separate Render worker / GPU host |
| Frontend | `vite dev` / preview deploys | preview deploy | institutional host |
| AI | local Ollama or `none` | `none` or institution server | institution server or `none` |
| `ENVIRONMENT` | `development` | `staging` | `production` |
| GitHub Environment (secrets) | `development` | `staging` | `production` (required reviewers) |

Credentials are never shared between environments. Production data is never copied to
development or staging.

## 3. Frontend hosting and licensing

Vercel **Hobby** is limited to personal, non-commercial use. Use it only for your own
development previews. For institutional use choose one of:

| Option | Cost | Notes |
|---|---|---|
| **Cloudflare Pages** (recommended free option) | Free tier permits commercial use | Git-connected builds; SPA fallback is automatic; `frontend/public/_headers` provides security headers |
| Render Static Site | Free | Same vendor as the API; add a rewrite `/* → /index.html` in the dashboard |
| Vercel Pro | Paid per seat | `frontend/vercel.json` already configures rewrites and headers |

Build settings for all hosts: root `frontend`, build `npm ci && npm run build`, output
`dist`, Node 24, env vars from section 5.

Verify the current terms of whichever host you choose before institutional launch.

## 4. Backend hosting

`render.yaml` defines `papermark-api-dev` on the **free** plan, treated as
development/pilot infrastructure only:

- Sleeps after ~15 min idle (first request ~1 min), 512 MB RAM.
- No background workers and no pre-deploy command on free.
- Migrations therefore run through the manual `migrate` GitHub workflow.
- `autoDeployTrigger: checksPass` deploys only after GitHub checks pass.

Production changes: plan `starter` or higher, enable `preDeployCommand: alembic upgrade head`,
add the `papermark-worker` service (commented in `render.yaml`) so OCR/AI/PDF jobs never
run in the API process. Region `singapore` is the closest Render region to India; Supabase
projects should use `ap-south-1` (Mumbai) or the nearest available region.

Render's runtime cannot reach Supabase's IPv6-only direct host; use the **Supavisor
session pooler** connection string (port 5432).

## 5. Environment variables

**Frontend** — public by design (embedded in the bundle):

| Name | Example |
|---|---|
| `VITE_API_BASE_URL` | `https://papermark-api-dev.onrender.com/api/v1` |
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable key (`sb_publishable_…`) |

The frontend refuses to start if a secret key is supplied (`src/lib/env.ts`), and CI fails if
secret-key markers appear in the bundle.

**Backend** — secret (Render dashboard, `sync: false` in `render.yaml`):

| Name | Purpose |
|---|---|
| `ENVIRONMENT` | `development` / `test` / `staging` / `production` |
| `DATABASE_URL` | Supavisor session pooler URL (`postgresql://…:5432/postgres`); driver is selected automatically |
| `DATABASE_SSL` | `true` (enforced in staging/production) |
| `CORS_ORIGINS` | comma-separated `https://` origins (enforced in staging/production) |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWKS_URL` | Phase 1 |
| `RUN_JOBS_IN_PROCESS` | `true` on free tier |
| `AI_PROVIDER` | `none` / `ollama` / `institution` / `hosted` |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_VISION_MODEL`, `AI_TEXT_MODEL` | Phase 8 |
| `TOKEN_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Phase 10 |

Templates: `backend/.env.example`, `frontend/.env.example` (placeholders only).

**GitHub Environments** (`development`, `staging`, `production`): secret `DATABASE_URL`
used only by the `migrate` workflow.

## 6. Supabase project checklist (per environment)

1. Create the project (region nearest users). Record the project ref.
2. Authentication → Sign In / Providers: **disable "Allow new users to sign up"**.
3. Authentication → URL configuration: Site URL and redirect URLs = the frontend origin.
4. Authentication → SMTP: institution SMTP (built-in sender is rate-limited).
5. Authentication → MFA: enable TOTP (required for admins from Phase 11).
6. API → Data API: PaperMark does not use it from the browser. Remove `public` from
   exposed schemas (or disable the Data API) as an extra layer on top of forced RLS.
7. Database → connection string: copy the **session pooler** URL for `DATABASE_URL`.
8. API keys: copy the publishable key (frontend) and secret key (backend only).
9. Storage: buckets are created by migrations as private; confirm none is public.
10. Production only: Pro plan, daily backups, consider PITR add-on.

## 7. Build, migrate, deploy

```
backend:  pip install uv && uv sync --frozen --no-dev
          uv run --no-sync python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT
migrate:  GitHub → Actions → migrate → choose environment (runs alembic + RLS guard)
frontend: npm ci && npm run build  → dist/
```

## 8. Free tier vs paid

| Service | Free tier use | Limitation | Paid recommendation |
|---|---|---|---|
| GitHub (private repo) | Yes | Actions minutes quota for private repos | — |
| Vercel Hobby | Personal dev only | Non-commercial | Vercel Pro, or use Cloudflare Pages / Render Static |
| Cloudflare Pages | Yes, incl. institutional | Build-minute limits | — |
| Render Web Free | Dev/pilot only | Sleeps; 512 MB; no workers/pre-deploy | Starter + Background Worker |
| Supabase Free | Dev/staging only | 500 MB DB, 1 GB storage, 50 MB/file, pauses after 7 days idle, **no backups** | **Pro before real student data** |
| AI | Local dev only | GPU/RAM needs | Institution GPU server |

Sizing: a 20-page scan at 150–200 DPI is 2–8 MB, so 1 GB holds roughly 150–500 scripts with
evaluated copies — development only.

## 9. Operations

- Health: Render pings `/api/v1/health`; readiness `/api/v1/health/ready` (DB check).
- Logs: JSON to stdout (Render logs); no tokens or student data logged.
- Backups: Supabase Pro daily; quarterly restore drill (Phase 11).
- Runbooks for incident response and key rotation: Phase 11.
