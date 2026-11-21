# PaperMark

AI-assisted digital answer-script evaluation and examination management platform.
AI assists teachers; it never finalises marks.

Status: **Phase 0 (foundations) complete — awaiting review.** See
[docs/phase-reports/phase-0.md](docs/phase-reports/phase-0.md).

## Documents

1. [System architecture](docs/01-system-architecture.md)
2. [Database schema](docs/02-database-schema.md)
3. [API specification](docs/03-api-specification.md)
4. [Repository structure](docs/04-repository-structure.md)
5. [Phase-wise development plan](docs/05-development-plan.md)
6. [Security and authorization strategy](docs/06-security-strategy.md)
7. [Cloud deployment architecture](docs/07-deployment-architecture.md)
8. [Development setup](docs/development-setup.md)

## Stack

React 19 · TypeScript · Vite · Tailwind · PDF.js · Fabric.js — Python 3.12 · FastAPI ·
SQLAlchemy · Alembic — Supabase (Postgres, Auth, private Storage) — PyMuPDF · PaddleOCR ·
Ollama / vLLM (Qwen3-VL, Qwen3) — GitHub Actions · Render · Cloudflare Pages / Vercel.

## Quick start

```bash
cd backend && uv sync && cp .env.example .env && uv run python -m uvicorn app.main:app --reload
cd frontend && npm install && cp .env.example .env.local && npm run dev
```

Never commit `.env` files, credentials, student scripts or examination data.
