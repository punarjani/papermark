# 05 — Phase-wise Development Plan

Status: APPROVED (rev 2) · Phase 0 implemented, awaiting review

Each phase ends with: tests passing in CI, a deployed preview where applicable, updated
docs, and a written report of completed and remaining work. No phase starts before the
previous one is verified.

## Phase 0 — Foundations
- Git repo, `.gitignore`, monorepo layout, editor config.
- Backend skeleton: FastAPI app factory, config (pydantic-settings), error envelope, logging, `/health`.
- Frontend skeleton: Vite + React + TS + Tailwind + Router + Query, layout shell, error boundary.
- Alembic wired to Supabase Postgres; migration `0001` (enums, `app` schema, trigger helpers).
- CI workflows (lint, type-check, test, build).
- `.env.example` files; Supabase project created by you (dev project).
- **Exit:** `/health` deployed on Render (dev), SPA deployed, CI green. Report: docs/phase-reports/phase-0.md.

## Phase 1 — Authentication, roles, teacher management, audit base
- JWT verification via JWKS; `get_current_user`, role guards; inactive users blocked.
- `profiles`, `audit_logs`, `app_settings` + RLS (`0002`).
- Bootstrap admin script; public sign-up disabled.
- Admin: invite / list / edit / deactivate teachers; CSV import.
- Frontend: login, password reset, session refresh, role-based routing, admin & teacher shells.
- **Tests:** token tampering, expired token, wrong audience, role escalation attempts, RLS checks.
- **Exit:** admin invites teacher; teacher logs in and sees only the teacher area.

## Phase 2 — Exams, structure, marking schemes
- Exams CRUD and lifecycle; sections, questions, sub-questions; structure validation.
- Versioned marking schemes; scheme document upload.
- Frontend: exam list/form, structure tree editor, scheme editor.
- **Tests:** totals consistency, lock-after-evaluation, versioning.

## Phase 3 — Submissions and private storage
- Buckets and storage policies (`0004`); signed upload/download URLs.
- Upload flow (bulk, direct-to-storage), server finalize/validation, page geometry, duplicate detection.
- Frontend: drag-and-drop bulk upload with per-file progress and validation result.
- **Tests:** non-PDF disguised as PDF, oversize, encrypted, corrupt, zero pages; immutability of originals.

## Phase 4 — Bundles, assignment, dashboards
- Bundles, auto-split, assign/reassign/revoke; one-live-assignment constraint.
- Teacher dashboard (my bundles, progress); admin progress view.
- **Tests:** cross-teacher access returns 404 at API and RLS level; reassign revokes access.

## Phase 5 — PDF viewer and annotation workspace
- PDF.js viewer: virtualized pages, navigation, zoom, fit-width.
- Fabric.js tools: pen, pencil, highlighter, tick, cross, text, object eraser, undo/redo.
- Normalized coordinate model; batch annotation sync with versioning; IndexedDB offline queue; resume at last page.
- **Tests:** coordinate round-trip unit tests at multiple zoom levels and rotations; sync idempotency; conflict 409; Playwright drawing test.

## Phase 6 — Marks entry and evaluation workflow
- Pure marks engine (sub-questions, sections, choice rules, steps).
- Marks panel with live preview totals; backend-authoritative totals.
- Validate, submit, freeze; admin reopen with reason; audit everywhere.
- `submission_results`, `result_question_marks`, `question_mark_history` (`0007`).
- Admin review screen: correction with mandatory reason, reopen, approve, withhold, bulk approve.
- Final approval requires a teacher-submitted valuation (DB trigger + service check).
- **Tests:** exhaustive marks-engine unit tests (property-based with Hypothesis); submitted session is read-only at API and DB trigger level.

## Phase 7 — Evaluated PDF generation
- Job queue and in-process runner.
- PyMuPDF renderer: strokes, stamps, text, marks labels, summary page; versioned outputs.
- Admin download and bulk ZIP export.
- **Tests:** generated PDF hash differs from original; original object unchanged; annotation positions verified by rendering and sampling pixels.

## Phase 8 — AI-assisted evaluation
- Provider interfaces; Ollama provider; OpenAI-compatible provider.
- Pipeline: page render → PaddleOCR → region mapping → VLM transcription → rubric grading → strict schema validation.
- Suggestions UI: per-question suggestion, explanation, flags, highlighted regions; accept / modify / reject.
- Settings: provider selection, provider allow-list, per-exam enable.
- **Tests:** providers mocked for CI; schema rejection of malformed model output; proof that no AI path writes `question_marks`; small offline evaluation set measuring agreement with teacher marks.

## Phase 9 — Reports and analytics
- Marks report (CSV/XLSX), question analysis, teacher summary, AI agreement report.
- Admin dashboard charts.

## Phase 10 — Google Classroom and Google Forms
- OAuth (PKCE, state), encrypted refresh tokens, revoke.
- Classroom: courses → coursework → student submissions → Drive PDF download → submissions import.
- Forms: responses with file-upload answers → submissions import; register-number mapping.
- **Tests:** mocked Google API responses; token encryption; import idempotency.

## Phase 11 — Hardening and production readiness
- Settings UI, audit log viewer.
- Security review (OWASP ASVS L2 checklist), dependency audit, rate-limit tuning.
- Backup/restore drill, retention script, runbook.
- Full Playwright suite; load test of autosave and upload paths.
- Final deployment documentation.

## Testing strategy summary

| Layer | Tooling |
|---|---|
| Backend unit | pytest, Hypothesis (marks engine, coordinates) |
| Backend integration | pytest + httpx against a real Postgres with RLS and auth schema stubs |
| Frontend unit | Vitest + React Testing Library |
| End-to-end | Playwright (admin and teacher journeys) |
| Security | Authorization matrix tests generated from the API table (every endpoint × role × foreign object) |

## Decisions recorded (2026-11-21 review)

1. Test database: separate Supabase **development** project; no Docker required. CI uses a disposable Postgres container. Local DB tests may use any disposable Postgres (see docs/development-setup.md).
2. Production AI: institution-owned GPU server (Ollama or vLLM). Application must work fully without it. Hosted adapter optional and gated by institutional approval.
3. Environments: development, staging and production are separate Supabase projects with separate credentials. No production student data in development.
4. V1 scope: first valuation, admin review, correction, final approval. Second valuation and moderation screens: V2.
5. Render Free and Vercel Hobby: development/pilot only.

## V2 backlog

- Second valuation assignment UI (blind), discrepancy dashboard, moderator workspace.
- Pixel eraser.
