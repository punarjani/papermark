# 04 — Repository Structure

Status: APPROVED (rev 2) · Phase 0 layout in place · Monorepo, single GitHub repository

```
papermark/
├─ README.md
├─ .gitignore
├─ .editorconfig
├─ .github/
│  └─ workflows/
│     ├─ backend-ci.yml        # ruff, mypy, pytest (Postgres 17 service), migration round-trip, RLS guard
│     ├─ frontend-ci.yml       # npm audit, oxlint, tsc, vitest, build, bundle secret scan
│     ├─ repo-guard.yml        # gitleaks + forbidden files (.env, PDFs, dumps, keys)
│     ├─ ai-deps.yml           # PaddleOCR install/import check when deps change
│     ├─ migrate.yml           # manual, per-environment alembic upgrade
│     └─ e2e.yml               # Playwright against preview stack (later phase)
├─ docs/
│  ├─ 01-system-architecture.md
│  ├─ 02-database-schema.md
│  ├─ 03-api-specification.md
│  ├─ 04-repository-structure.md
│  ├─ 05-development-plan.md
│  ├─ 06-security-strategy.md
│  ├─ 07-deployment-architecture.md
│  └─ adr/                     # architecture decision records, one file per decision
├─ backend/
│  ├─ pyproject.toml           # deps; extras: [ai] for PaddleOCR/paddlepaddle
│  ├─ uv.lock
│  ├─ .python-version          # 3.12
│  ├─ .env.example
│  ├─ alembic.ini
│  ├─ migrations/
│  │  ├─ env.py
│  │  └─ versions/
│  ├─ app/
│  │  ├─ main.py               # app factory, middleware, routers, lifespan (job runner)
│  │  ├─ core/middleware.py    # request id, access log, security headers
│  │  ├─ config.py             # pydantic-settings; fails fast on missing secrets
│  │  ├─ db/
│  │  │  ├─ base.py            # declarative base, naming conventions
│  │  │  ├─ session.py         # async engine, per-request transaction, RLS role switch
│  │  │  └─ models/            # one module per aggregate
│  │  ├─ core/
│  │  │  ├─ security.py        # JWT/JWKS verification
│  │  │  ├─ deps.py            # get_current_user, require_admin, require_teacher
│  │  │  ├─ errors.py          # error envelope + handlers
│  │  │  ├─ logging.py
│  │  │  └─ rate_limit.py
│  │  ├─ api/v1/               # routers: me, teachers, exams, submissions, bundles,
│  │  │                        # sessions, ai, jobs, reports, integrations, audit, settings
│  │  ├─ schemas/              # Pydantic request/response models
│  │  ├─ services/             # business logic + authorization decisions
│  │  ├─ repositories/
│  │  ├─ marks/                # pure marks engine (no I/O), heavily unit-tested
│  │  ├─ storage/              # Supabase Storage client, signed URLs
│  │  ├─ pdf/                  # validation, page geometry, evaluated PDF renderer
│  │  ├─ ai/                   # providers/, pipeline/, prompts/, registry.py
│  │  ├─ jobs/                 # queue, runner, handlers per job type
│  │  ├─ integrations/google/  # oauth, classroom, forms, drive download
│  │  └─ audit/
│  ├─ scripts/check_rls.py     # fails if any public table lacks forced RLS (python -m scripts.check_rls)
│  ├─ worker.py                # standalone job runner entrypoint (paid tier / GPU host)
│  └─ tests/
│     ├─ conftest.py           # test DB, JWT signing test keys, factories
│     ├─ unit/                 # marks engine, coordinate maths, schemas, providers (mocked)
│     ├─ integration/          # API + DB + RLS tests
│     └─ fixtures/             # sample PDFs (synthetic, no real student data)
├─ frontend/
│  ├─ package.json
│  ├─ vite.config.ts
│  ├─ tsconfig.json
│  ├─ tailwind.config.ts
│  ├─ vercel.json              # SPA rewrites, security headers (Vercel)
│  ├─ public/_headers          # security headers (Cloudflare Pages / Netlify)
│  ├─ .env.example             # VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_API_BASE_URL
│  ├─ index.html
│  ├─ src/
│  │  ├─ main.tsx
│  │  ├─ app/                  # router, providers, route guards, layouts
│  │  ├─ lib/                  # supabase client, axios client, query client, utils
│  │  ├─ api/                  # typed endpoint functions (generated types from OpenAPI)
│  │  ├─ features/
│  │  │  ├─ auth/
│  │  │  ├─ admin-dashboard/
│  │  │  ├─ teacher-dashboard/
│  │  │  ├─ teachers/
│  │  │  ├─ exams/             # exam form, structure editor, marking schemes
│  │  │  ├─ submissions/       # upload queue, validation status
│  │  │  ├─ bundles/
│  │  │  ├─ workspace/         # pdf/, annotation/, marks/, ai/, autosave/
│  │  │  ├─ reports/
│  │  │  ├─ integrations/
│  │  │  ├─ audit/
│  │  │  └─ settings/
│  │  ├─ components/ui/        # shared primitives (Button, Dialog, Table, Toast…)
│  │  └─ types/
│  └─ tests/
│     ├─ unit/
│     └─ e2e/                  # Playwright
├─ supabase/
│  ├─ config.toml              # auth settings for local Supabase CLI (if Docker available)
│  └─ seed/                    # dev-only seed script (creates admin via Admin API)
├─ scripts/
│  └─ create_admin.py          # bootstrap first admin (service role, run once)
└─ render.yaml                 # Render blueprint: web service (+ optional worker)
```

Notes:
- Alembic owns the schema. The `supabase/` folder holds only local auth config and seeds; it does not contain competing SQL migrations.
- Frontend API types are generated from the backend OpenAPI schema (`openapi-typescript`) to keep contracts consistent.
- Test fixtures use synthetic handwriting PDFs only. Real student scripts never enter the repository.
