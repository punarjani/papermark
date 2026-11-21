# Development Setup

No Docker required. Use only synthetic data in development.

## Prerequisites

- Git
- [uv](https://docs.astral.sh/uv/) (installs Python 3.12 automatically)
- Node.js 22+ (CI uses 24)
- Access to the **development** Supabase project (never production)

## Backend

```bash
cd backend
uv sync                      # Python 3.12 + runtime + dev tools (no AI deps)
cp .env.example .env         # fill in DEVELOPMENT values; .env is git-ignored
uv run alembic upgrade head  # apply migrations to the dev database
uv run python -m uvicorn app.main:app --reload --port 8000
```

- API docs: http://localhost:8000/api/v1/docs (development only)
- Health: http://localhost:8000/api/v1/health, readiness: `/api/v1/health/ready`

Checks (same as CI):

```bash
uv run ruff check . && uv run ruff format --check .
uv run mypy app scripts tests
uv run python -m pytest -q
```

### Database tests

Tests marked `db` need `TEST_DATABASE_URL` pointing to a **disposable** PostgreSQL
database. The tests run migrations up and down, so never point it at the Supabase
dev project or any database with data you want to keep. Without it they are skipped locally
and always run in CI.

Option without Docker: the `pgserver` package ships embedded PostgreSQL binaries.

```bash
# in a scratch folder outside the repo
uv run --no-project --python 3.12 --with pgserver python -c "import pgserver; s=pgserver.get_server('./pgdata', cleanup_mode=None); s.psql('create database papermark_test;'); print(s.get_uri())"
# then, in backend/ (replace the port with the one printed):
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:PORT/papermark_test uv run python -m pytest -q
```

### AI dependencies (optional)

```bash
uv sync --group ai   # paddlepaddle 3.2.2 (CPU), paddleocr 3.3.3, pymupdf
```

The GPU build of PaddlePaddle comes from Paddle's own package index and is configured in
Phase 8. Ollama is installed separately (https://ollama.com).

### Windows Smart App Control

If Windows blocks unsigned binaries (`An Application Control policy has blocked this file`):

1. Run tools as modules: `uv run python -m pytest`, `uv run python -m uvicorn …`.
2. Install SQLAlchemy without its compiled extension (local venv only; the lockfile and CI
   are unchanged):

   ```bash
   DISABLE_SQLALCHEMY_CEXT=1 uv sync --no-binary-package sqlalchemy --reinstall-package sqlalchemy
   ```

   A plain `uv sync` later restores the compiled wheel; repeat the command if needed.

## Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # point VITE_API_BASE_URL at your local API
npm run dev                  # http://localhost:5173
npm run lint && npm run typecheck && npm test && npm run build
```

## Rules

- `.env`, `.env.local` and any real credentials stay out of git (`.gitignore` + `repo-guard` CI).
- Never commit student scripts, exam data, exports or database dumps.
- Test fixtures must be synthetic and live in `backend/tests/fixtures/`.
