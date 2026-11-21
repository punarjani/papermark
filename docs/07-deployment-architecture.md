# 07 — Cloud Deployment Architecture

Status: APPROVED (rev 3) · Phase 0 configuration implemented · rev 3 adds the step-by-step
development deployment procedure, verification, troubleshooting and limitations

## 1. Topology

```
GitHub (private repo: main + PR branches)
   ├─► GitHub Actions: backend-ci · frontend-ci · repo-guard · ai-deps · migrate (manual)
   ├─► Frontend host (static SPA)
   │      dev/pilot: Cloudflare Pages (recommended) or Vercel Hobby (personal only)
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
| API | local `uvicorn`, and the **development deployment** `papermark-api-dev` on Render Free | Render (Free acceptable for pilots) | Render Starter+ (always on) |
| Jobs | in-process | in-process | separate Render worker / GPU host |
| Frontend | `vite dev`, and the development deployment on Cloudflare Pages | preview deploy | institutional host |
| AI | local Ollama or `none` | `none` or institution server | institution server or `none` |
| `ENVIRONMENT` | `development` locally, `staging` on the development deployment (see 2.1) | `staging` | `production` |
| GitHub Environment (secrets) | `development` | `staging` | `production` (required reviewers) |

Credentials are never shared between environments. Production data is never copied to
development or staging.

### 2.1 Development deployment with staging-grade validation

`papermark-api-dev` (Render) and its Cloudflare Pages frontend form the **development
deployment**. They use the **development** Supabase project and synthetic data only. The API
nevertheless runs with `ENVIRONMENT=staging` on purpose, so every deployed instance gets the
strict checks that local development skips:

- startup fails unless `DATABASE_URL` is set, `DATABASE_SSL=true` and `CORS_ORIGINS` lists
  explicit `https://` origins (no `*`);
- HSTS is sent; OpenAPI/Swagger docs are hidden.

The `ENVIRONMENT` value does **not** select a database. The database is whatever
`DATABASE_URL` points at, which for this deployment is the development project. A separate
staging Supabase project is created later (before pilots with anonymised data).

## 3. Frontend hosting and licensing

Vercel **Hobby** is limited to personal, non-commercial use. Use it only for your own
development previews. For institutional use choose one of:

| Option | Cost | Notes |
|---|---|---|
| **Cloudflare Pages** (recommended free option) | Free tier permits commercial use | Git-connected builds; SPA fallback is automatic when no `404.html` exists; `frontend/public/_headers` provides security headers |
| Render Static Site | Free | Same vendor as the API; add a rewrite `/* → /index.html` in the dashboard |
| Vercel Pro | Paid per seat | `frontend/vercel.json` already configures rewrites and headers |

Build settings for all hosts: root `frontend`, build `npm run build` (the host installs
dependencies from `package-lock.json` first), output `dist`, Node 24, env vars from section 5.

Verify the current terms of whichever host you choose before institutional launch.

## 4. Backend hosting

`render.yaml` defines `papermark-api-dev` on the **free** plan, treated as
development/pilot infrastructure only:

- Sleeps after ~15 min idle; the first request then waits for a cold start (typically
  30–60 s). 512 MB RAM.
- No background workers and no pre-deploy command on free.
- Migrations therefore run through the manual `migrate` GitHub workflow.
- `autoDeployTrigger: checksPass` deploys only after GitHub checks pass.
- Health check: `/api/v1/health` (liveness only, no DB call, so a DB outage does not cause
  restart loops). Readiness with a DB check: `/api/v1/health/ready`.

Production changes: plan `starter` or higher, enable `preDeployCommand: alembic upgrade head`,
add the `papermark-worker` service (commented in `render.yaml`) so OCR/AI/PDF jobs never
run in the API process. Region `singapore` is the closest Render region to India. The
development Supabase project is in `ap-southeast-1` (Singapore), the same region as the API.
Later projects should use `ap-south-1` (Mumbai) or Singapore, and the API region should
match the database region.

Render's runtime cannot reach Supabase's IPv6-only direct host; use the **Supavisor
session pooler** connection string (port 5432).

### 4.1 Background jobs and `RUN_JOBS_IN_PROCESS`

Current state (Phase 0): `RUN_JOBS_IN_PROCESS` is declared in `app/config.py` and set to
`true` in `render.yaml`, but **no code reads it yet**. There is no `jobs` table, no runner
and no job type. Its value therefore has no effect today. It stays `true` on the
development deployment so the intended free-tier behaviour is already configured.

Planned behaviour (job queue and runner arrive in Phase 7, see 01 §7 and 02 §4.16):

| Setting | What runs the jobs | What happens to queued jobs |
|---|---|---|
| `true` (free tier) | A worker loop inside the API process (FastAPI lifespan task) claims jobs with `SELECT … FOR UPDATE SKIP LOCKED` | Jobs run while the instance is awake. When Render Free sleeps, the loop stops; queued jobs stay in the table and resume on the next request that wakes the instance. A job interrupted by sleep, redeploy or crash keeps its `locked_until` lease; after the lease expires another loop reclaims it (`attempts`/`max_attempts`, exponential back-off). Jobs are idempotent, so a rerun is safe. |
| `false` with **no** worker deployed | Nothing | Jobs are accepted and stay `queued` indefinitely. Nothing is lost, but nothing is processed. This is a misconfiguration; Phase 7 adds a readiness/admin warning for it. |
| `false` with a worker (`worker.py`, paid Render worker or GPU host) | The separate worker | Production layout. Heavy OCR/AI/PDF work never shares CPU or memory with API requests. |

Manual evaluation never depends on jobs: marks entry, review and approval work with no
runner at all. Only OCR, AI suggestions, evaluated-PDF generation, imports and exports wait
for the runner.

## 5. Environment variables

**Frontend** — public by design (embedded in the bundle):

| Name | Development deployment value | Phase |
|---|---|---|
| `VITE_API_BASE_URL` | `https://<render-service>.onrender.com/api/v1` | 0 (required) |
| `NODE_VERSION` | `24` (build image setting, not embedded) | 0 |
| `VITE_SUPABASE_URL` | `https://<dev-project-ref>.supabase.co` | optional in 0, required in 1 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable key (`sb_publishable_…`) **only** | optional in 0, required in 1 |

The frontend refuses to start if a secret key is supplied (`src/lib/env.ts`). CI runs
`scripts/check-bundle-secrets.mjs`, which fails the build if real secret-key material
(`sb_secret_…` keys or `service_role` JWTs) is found in `dist/`.

**Backend** — Render dashboard. Values marked `sync: false` in `render.yaml` are entered
in the dashboard and never stored in git.

| Name | Development deployment value | Secret | Phase |
|---|---|---|---|
| `ENVIRONMENT` | `staging` (set by `render.yaml`, see 2.1) | no | 0 |
| `LOG_LEVEL` | `INFO` (`render.yaml`) | no | 0 |
| `PYTHON_VERSION` | `3.12.13` (`render.yaml`); use `3.12` if Render rejects the patch version | no | 0 |
| `DATABASE_URL` | dev project **session pooler** URI (`postgresql://postgres.<ref>:<password>@aws-…pooler.supabase.com:5432/postgres`); driver is selected automatically | **yes** | 0 |
| `DATABASE_SSL` | `true` (`render.yaml`; enforced in staging/production) | no | 0 |
| `CORS_ORIGINS` | exact frontend origin, e.g. `https://papermark-dev.pages.dev` (no trailing slash; comma-separate several) | no | 0 |
| `SUPABASE_URL` | `https://<dev-project-ref>.supabase.co` | no | 0 (declared), used from 1 |
| `SUPABASE_JWT_ISSUER` | `https://<dev-project-ref>.supabase.co/auth/v1` | no | 0 (declared), used from 1 |
| `SUPABASE_JWKS_URL` | `https://<dev-project-ref>.supabase.co/auth/v1/.well-known/jwks.json` | no | 0 (declared), used from 1 |
| `SUPABASE_SECRET_KEY` | **leave blank in Phase 0** (not used; least privilege) | **yes** | 1 |
| `RUN_JOBS_IN_PROCESS` | `true` (`render.yaml`; see 4.1) | no | 7 |
| `AI_PROVIDER` | `none` (`render.yaml`) | no | 8 |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_VISION_MODEL`, `AI_TEXT_MODEL` | not set | key: yes | 8 |
| `TOKEN_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | not set | yes | 10 |

Templates: `backend/.env.example`, `frontend/.env.example` (placeholders only).

**GitHub Environments** (`development`, `staging`, `production`): secret `DATABASE_URL`
used only by the `migrate` workflow. Only `development` exists in Phase 0.

## 6. Supabase project checklist (per environment)

1. Create the project (region nearest users). Record the project ref.
2. Authentication → Sign In / Providers: **disable "Allow new users to sign up"** (see 6.2).
3. Authentication → URL Configuration: Site URL and redirect URLs = the frontend origin.
4. Authentication → SMTP: institution SMTP (built-in sender is rate-limited). Phase 1.
5. Authentication → MFA: enable TOTP (required for admins from Phase 11).
6. Data API: remove `public` and `graphql_public` from exposed schemas (see 6.1).
7. Connect → **Session pooler** URI → `DATABASE_URL` (Render, GitHub Environment, local `.env`).
8. API keys: publishable key (frontend) and secret key (backend only, from Phase 1).
9. Storage: buckets are created by migrations as private; confirm none is public.
10. Production only: Pro plan, daily backups, consider PITR add-on.

### 6.1 Data API (PostgREST / GraphQL) exposure

Verified in Phase 0:

- The frontend makes **no** Supabase calls in Phase 0. `@supabase/supabase-js` is
  installed but not imported. From Phase 1 it is used **only for Auth** (sign-in, session
  refresh, password reset) with the publishable key (01 §3).
- Auth (`/auth/v1`), Storage (`/storage/v1`) and the backend's direct Postgres connection
  do **not** go through the Data API (`/rest/v1`, `/graphql/v1`). Uploads and downloads use
  backend-issued signed Storage URLs.
- All application data flows through FastAPI. Nothing in the codebase or the plan calls
  `/rest/v1` or `/graphql/v1`.

Recommendation, safest first:

1. **Remove `public` and `graphql_public` from "Exposed schemas"; keep the Data API itself
   enabled.** Nothing can be queried through it, and Auth and Storage are unaffected. This
   is reversible in one click and keeps a path open if a future feature needs it.
2. Only if the dashboard does not allow an empty list: switch the Data API off. Verified
   above that no code depends on it.

This sits on top of the database controls, which stay in place regardless: forced RLS on
every `public` table (`scripts/check_rls.py` in CI and in `migrate`), no `anon` grants on
the private `app` schema, and no storage policies for `authenticated`.

### 6.2 Public sign-up and the admin bootstrap

PaperMark is invite-only (06 §2). Disabling public sign-up is safe now because:

- the development project has **0 users** and no identity providers in use;
- the first admin is created by `scripts/create_admin.py` (Phase 1). It runs once, from a
  trusted machine, using the Supabase **Admin API** with the secret key. Admin-API user
  creation is not affected by the "Allow new users to sign up" switch;
- teachers are invited by an admin through the backend (Admin API invite), also unaffected;
- fallback if the script is unavailable: Dashboard → Authentication → Users → **Add user**
  (or Invite), then the backend's profile pre-registration (02 §4.1) assigns the role.

With sign-up enabled, anyone who knows the project URL and publishable key could create an
account. Phase 1 would then rely solely on the profile pre-registration check. Disabling it
removes that exposure before any user exists.

## 7. Development deployment procedure

Order matters: with `ENVIRONMENT=staging` the API refuses to start until `CORS_ORIGINS`
holds the frontend's `https://` origin. So the frontend name is chosen first.

**Step 1: Supabase dev project** (dashboard, reversible)

1. Authentication → Sign In / Providers → turn off **Allow new users to sign up** (6.2).
2. Data API → Exposed schemas → remove `public` and `graphql_public` (6.1).
3. Authentication → URL Configuration → Site URL `https://<pages-project>.pages.dev`
   (used from Phase 1; harmless now).

**Step 2: check the GitHub `development` environment**

1. Settings → Environments → `development` → secret `DATABASE_URL` = dev session pooler URI.
2. Actions → **migrate** → Run workflow → `development`.
3. Expected: `0001 (head)` in "Current revision", no new migration, `Checked 0 table(s) in
   public.` from the RLS guard. Any failure means the secret is wrong or missing.

**Step 3: pick the Pages project name**

Choose it now, e.g. `papermark-dev` → `https://papermark-dev.pages.dev`. If the name is taken,
Cloudflare appends a suffix; use the exact URL it shows.

**Step 4: Render backend** (free plan; stop if Render asks to upgrade or add a paid plan)

1. Render → New → **Blueprint** → connect GitHub, grant access to `punarjani/papermark`
   only → branch `main` → Render reads `render.yaml`.
2. Enter the `sync: false` values (section 5): `DATABASE_URL`, `CORS_ORIGINS`,
   `SUPABASE_URL`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWKS_URL`. Leave `SUPABASE_SECRET_KEY`
   blank.
3. Apply. Wait for the build and the `/api/v1/health` check to go green.
4. Record the service URL, e.g. `https://papermark-api-dev.onrender.com`.

**Step 5: Cloudflare Pages frontend** (free)

1. Workers & Pages → Create → Pages → **Connect to Git** → `punarjani/papermark`
   (grant access to this repository only).
2. Project name from Step 3. Production branch `main`.
3. Build settings: framework preset **None**, root directory `frontend`, build command
   `npm run build`, build output `dist`.
4. Environment variables (Production): `VITE_API_BASE_URL=<render URL>/api/v1`,
   `NODE_VERSION=24`. Supabase values are optional in Phase 0.
5. Save and deploy.

**Step 6: reconcile URLs** if either differs from what was entered:
update `CORS_ORIGINS` on Render (redeploys automatically) and/or `VITE_API_BASE_URL` on
Pages, then **retry the deployment** (Vite embeds the value at build time).

**Step 7: verification** (the deployment counts as complete only when all pass)

| Check | Expected |
|---|---|
| `GET <api>/api/v1/health` | 200 `{"status":"ok",…}`, `X-Request-ID`, `X-Content-Type-Options`, HSTS |
| `GET <api>/api/v1/health/ready` | 200 `{"status":"ready","checks":{"database":"ok"}}` |
| `GET <api>/api/v1/docs` | 404 (docs hidden outside development) |
| `GET <api>/api/v1/nope` | 404 with the error envelope and a request ID |
| CORS preflight from the Pages origin | `Access-Control-Allow-Origin: <pages origin>` |
| CORS preflight from `https://evil.example` | no `Access-Control-Allow-Origin` header |
| `GET <pages>/` and a deep link like `<pages>/does-not-exist` | 200 HTML app shell; `_headers` security headers present |
| System Status page | API "Online", Database "Connected" |
| Deployed JS bundle | contains the Render API URL; `check-bundle-secrets.mjs` finds nothing |

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Render deploy fails at startup with `Invalid deployed configuration: …` | Missing `DATABASE_URL`, `DATABASE_SSL` not `true`, or `CORS_ORIGINS` empty / not `https://` / `*` | Correct the value in Render → Environment; the message names the problem |
| Build fails on `PYTHON_VERSION` | Render does not offer that exact patch release | Set `PYTHON_VERSION=3.12` |
| `/health/ready` returns 503 `database: unavailable` | Wrong pooler URI or password, direct (IPv6) host used, project paused | Use the **session pooler** URI (port 5432); restore the project if Supabase paused it after 7 idle days |
| Browser shows CORS error | `CORS_ORIGINS` differs from the page origin (scheme, subdomain, trailing slash) | Set the exact origin, no trailing slash; Pages preview URLs (`<hash>.<project>.pages.dev`) are intentionally not allowed |
| Status page: "The server took too long to respond…" or "starting up" | Render Free cold start | Wait and click **Try again**. The client waits up to 90 s per request and retries once. |
| Status page: "Cannot reach the PaperMark server." | Wrong `VITE_API_BASE_URL`, or API down | Fix the Pages variable and redeploy the frontend; check Render logs |
| Render never deploys after a push | `autoDeployTrigger: checksPass` and a CI check failed | Fix CI; the deploy follows automatically |
| `migrate` workflow fails to connect | `DATABASE_URL` secret missing or wrong in that GitHub Environment | Update the environment secret and re-run |
| Pages deep link returns 404 | A `404.html` was added to `dist`, which disables SPA fallback | Remove it |

## 9. Limitations of the free development deployment

- Render Free: sleeps after ~15 min idle, cold start up to about a minute, 512 MB RAM,
  no background workers, no pre-deploy migrations, monthly free instance-hour quota.
- Supabase Free: pauses after 7 days of inactivity, **no backups**, 500 MB database,
  1 GB storage, 50 MB per file.
- Jobs (from Phase 7) run inside the API process and pause while it sleeps (4.1).
- Synthetic data only. Real student data requires the production project on paid plans
  (Supabase Pro, Render Starter+) and institutional approval for any external AI processing.
- One shared development database: no per-branch preview databases.

## 10. Build, migrate, deploy (reference)

```
backend:  pip install uv && uv sync --frozen --no-dev
          uv run --no-sync python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT
migrate:  GitHub → Actions → migrate → choose environment (runs alembic + RLS guard)
          local (dev DB only): uv run python -m alembic upgrade head
frontend: npm ci && npm run build  → dist/  (hosts run the install step themselves)
```

## 11. Free tier vs paid

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

## 12. Operations

- Health: Render pings `/api/v1/health`; readiness `/api/v1/health/ready` (DB check).
- Logs: JSON to stdout (Render logs); no tokens or student data logged.
- Backups: Supabase Pro daily; quarterly restore drill (Phase 11).
- Runbooks for incident response and key rotation: Phase 11.
