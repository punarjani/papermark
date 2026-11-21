# 01 — System Architecture

Status: APPROVED (rev 2) · Date: 2026-11-21

Rev 2 records the review decisions: Python 3.12 via uv; institution-hosted GPU inference
for production AI with no hard dependency on it; manual evaluation fully independent of AI;
separate Supabase projects per environment; V1 = first valuation + admin review,
correction and final approval, with schema support for second valuation and moderation.

## 1. Overview

PaperMark is an AI-assisted answer-script evaluation platform. Administrators manage exams,
upload scanned answer scripts, split them into bundles and assign bundles to teachers.
Teachers evaluate scripts in the browser: they annotate pages, enter question-wise marks,
and review AI marking suggestions. The backend validates every mark, records an audit
trail, and generates an evaluated PDF. The original upload is never modified.

Guiding principles:

1. **Backend is the authority.** The frontend never computes authoritative totals and never
   writes to the database directly. All business data flows through FastAPI.
2. **Defense in depth.** Authorization is enforced in FastAPI *and* by Postgres Row Level
   Security (RLS). A bug in one layer must not leak data across teachers.
3. **Originals are immutable.** Uploaded PDFs are written once to a private bucket.
   Annotations live in the database. Evaluated PDFs are separate generated artifacts.
4. **AI suggests, humans decide.** AI output is stored as suggestions only. A mark becomes
   real only when a teacher enters or accepts it, and becomes final only on teacher submit.
5. **Provider independence.** OCR, vision-language and text models sit behind interfaces.
   Swapping Ollama for a hosted provider is a configuration change.

## 2. High-level component diagram

```
                         ┌──────────────────────────────┐
                         │   Browser (Admin / Teacher)  │
                         │  React + TS + Vite (Vercel)  │
                         │  PDF.js · Fabric.js · Axios  │
                         └──────┬───────────────┬───────┘
             (1) login/refresh  │               │ (2) REST + Bearer JWT
                                ▼               ▼
                  ┌──────────────────┐   ┌──────────────────────────────┐
                  │  Supabase Auth   │   │  FastAPI backend (Render)    │
                  │  (GoTrue, JWKS)  │◄──┤  - JWT verification (JWKS)   │
                  └──────────────────┘   │  - RBAC + ownership checks   │
                                         │  - Validation (Pydantic)     │
     (3) PDF bytes via short-lived       │  - Marks engine              │
         signed URL (GET / PUT)          │  - Audit logger              │
            ┌────────────────────────────┤  - Job runner (in-process    │
            ▼                            │    on free tier)             │
  ┌──────────────────────┐               └──────┬──────────┬────────────┘
  │ Supabase Storage     │◄─────────────────────┘          │ SQLAlchemy (asyncpg)
  │ private buckets      │   service-role storage API       ▼
  │ - answer-scripts     │               ┌──────────────────────────────┐
  │ - evaluated-scripts  │               │ Supabase Postgres            │
  │ - scheme-documents   │               │ - schema managed by Alembic  │
  └──────────────────────┘               │ - RLS on every table         │
                                         │ - jobs table (queue)         │
                                         └──────────────────────────────┘
                                                        ▲
                                                        │ claims jobs (SKIP LOCKED)
                                         ┌──────────────┴───────────────┐
                                         │ AI worker (same codebase)    │
                                         │ PyMuPDF → PaddleOCR → VLM/LLM│
                                         │ provider: Ollama | hosted    │
                                         └──────────────────────────────┘
                                                        │
                                         ┌──────────────┴───────────────┐
                                         │ Google APIs (Classroom/Forms │
                                         │ /Drive) via OAuth            │
                                         └──────────────────────────────┘
```

## 3. Frontend architecture

| Concern | Choice |
|---|---|
| Build | Vite 8, React 19, TypeScript (strict) |
| Styling | Tailwind CSS, Lucide React icons |
| Routing | React Router (data routers), role-guarded route trees `/admin/*`, `/teacher/*` |
| Auth | `@supabase/supabase-js` with the **publishable (anon) key only**, used solely for sign-in, session refresh and password reset |
| API | Axios instance with interceptor that attaches the current access token and retries once after refresh on 401 |
| Server state | TanStack Query (caching, retries, background refetch) |
| PDF rendering | `pdfjs-dist` renders each page to a canvas; worker loaded from bundle |
| Annotation | Fabric.js v6 canvas overlaid on each PDF page canvas |
| Forms | React Hook Form + Zod (client-side validation mirrors backend; backend remains authoritative) |
| Lint / tests | oxlint; Vitest + React Testing Library; Playwright for end-to-end |

The frontend never holds the Supabase service-role key and never queries tables directly.

### 3.1 Evaluation workspace internals

```
WorkspacePage
 ├─ Toolbar (pen, pencil, highlighter, tick, cross, text, eraser, undo, redo, zoom)
 ├─ PageViewport (virtualized list of pages)
 │   └─ PageLayer[n]
 │       ├─ <canvas> PDF.js render at (scale × devicePixelRatio)
 │       └─ <canvas> Fabric overlay, same CSS size
 ├─ MarksPanel (sections → questions → sub-questions, live totals)
 ├─ AiSuggestionsPanel (per question: suggested marks, explanation, flags, accept/edit/reject)
 └─ SaveStatus (saved / saving / offline / conflict)
```

**Coordinate model.** Every annotation stores geometry in *normalized page space*:
`x, y ∈ [0, 1]` relative to the unrotated PDF page width and height (PDF user space,
origin top-left after conversion). Stroke width is stored as a fraction of page width.
On render, the client multiplies by the current viewport size. On export, PyMuPDF multiplies
by the page's point size. Zoom, device pixel ratio and export resolution therefore never
shift annotations.

**Undo/redo.** A per-session command stack on the client (`add`, `modify`, `delete`).
Each command maps to an idempotent API operation keyed by a client-generated UUID, so
replays after a network failure do not duplicate objects.

**Autosave.** Changes are queued in memory and in IndexedDB. A debounced flush (2 s idle,
or 10 s max) sends a batch to `PUT /sessions/{id}/annotations:batch` and
`PUT /sessions/{id}/marks`. Each session has a `version` integer for optimistic
concurrency. A 409 response means another tab or device saved first; the UI offers reload.

**Eraser.** Version 1 uses an *object eraser* (removes whole strokes or stamps it touches).
A pixel eraser that splits strokes is listed as a later enhancement.

## 4. Backend architecture

| Concern | Choice |
|---|---|
| Runtime | Python 3.12 (see risk R1), FastAPI, Uvicorn |
| ORM | SQLAlchemy 2.0 async + asyncpg |
| Schemas | Pydantic v2 |
| Migrations | Alembic is the **single source of truth** for tables, indexes, constraints, RLS policies, storage buckets and storage policies |
| Auth | Verify Supabase JWT via JWKS (asymmetric signing keys); legacy HS256 secret supported as fallback via config |
| Storage | Supabase Storage REST API using the service-role key (server only) |
| PDF | PyMuPDF (page count, rendering for OCR, evaluated PDF composition) |
| AI | `app/ai` provider layer (see section 6) |
| Jobs | Postgres `jobs` table, claimed with `SELECT … FOR UPDATE SKIP LOCKED` |
| Rate limiting | `slowapi` keyed by user id / IP |
| Logging | Structured JSON logs with request id; no PII or tokens in logs |
| Tests | pytest, pytest-asyncio, httpx `AsyncClient`, a dedicated test Postgres |

### 4.1 Layering

```
api/ (routers: HTTP, auth dependencies, request/response schemas)
  └─ services/ (business rules, authorization decisions, transactions)
       ├─ repositories/ (SQLAlchemy queries)
       ├─ storage/ (Supabase Storage client, signed URLs)
       ├─ ai/ (providers, pipeline, prompts)
       ├─ pdf/ (validation, rendering, export)
       └─ audit/ (append-only audit writer)
```

Routers do not contain business logic. Services receive a `CurrentUser` and decide
authorization explicitly; there is no "trust the caller" path.

### 4.2 Request lifecycle

1. Middleware assigns `request_id`, applies CORS (allow-list), security headers, size limits.
2. `get_current_user` dependency verifies the JWT signature, `exp`, `aud=authenticated`,
   `iss`, then loads the `profiles` row. Inactive profiles get 403.
3. Role dependency (`require_admin` / `require_teacher`) gates the router.
4. A DB transaction opens. For user-scoped requests the backend runs
   `SET LOCAL ROLE authenticated` and `set_config('request.jwt.claims', <claims>, true)`
   so Postgres RLS applies to the backend's own queries (defense in depth).
   Admin-only system operations and background jobs use the privileged connection.
5. Service performs object-level checks (e.g. "this teacher holds the active assignment
   for this submission").
6. Writes that change marks, assignments, exams or submissions also write an `audit_logs`
   row in the same transaction.
7. Errors map to a uniform error envelope; stack traces are never returned.

### 4.3 Marks engine (authoritative)

- Validates each awarded mark: `0 ≤ awarded ≤ max_marks`, multiple of the exam's
  `marks_step` (default 0.5), question belongs to the session's exam.
- Sub-question totals roll up to the parent question. A parent with sub-questions cannot be
  marked directly.
- Section totals respect choice rules: `required_answers = N` means "count the best N
  attempted questions" (or "first N", configurable per exam).
- Overall total = sum of section totals, capped at exam `total_max_marks`.
- Totals are recomputed on every save and on submit; the client's displayed totals are a
  preview only.
- Submit requires every non-optional question to have a mark or an explicit
  "not attempted" flag.

## 5. Core workflows

### 5.1 Upload and validation

1. Admin requests an upload slot: `POST /exams/{id}/submissions/upload-urls`.
2. Backend creates `submissions` rows (`status=uploading`) and returns signed upload URLs
   to `answer-scripts/quarantine/{submission_id}.pdf`.
3. Browser PUTs the file directly to Storage (avoids routing large files through Render).
4. Admin calls `POST /submissions/{id}/finalize`.
5. Backend downloads the object, checks magic bytes `%PDF-`, size limit, opens with PyMuPDF,
   rejects encrypted/corrupt files, counts pages, computes SHA-256, moves to
   `answer-scripts/originals/{exam_id}/{submission_id}.pdf`, writes `submission_pages`,
   sets `status=ready`. Failures set `status=rejected` with a reason.
6. Optional: enqueue `ocr_submission` job.

### 5.2 Allocation

Admin creates bundles (manually, or auto-split N scripts per bundle), assigns each bundle
to a teacher. Each submission has at most one *active* assignment per evaluation round.
Reassignment revokes the old assignment (kept for audit) and creates a new one.

### 5.3 Evaluation

Teacher opens assignment → backend creates or resumes `evaluation_sessions` → returns
a 5-minute signed GET URL for the original PDF plus saved annotations and marks →
teacher annotates and marks, autosave runs → teacher submits → backend validates and
freezes the session (`status=submitted`) → `generate_evaluated_pdf` job is enqueued.
Admin can reopen a submitted session with a reason (audited).

### 5.4 AI suggestion

Admin (or teacher, if allowed by exam settings) triggers AI for a submission → `jobs`
row → worker runs the pipeline → writes `ai_evaluations` rows with status `completed`
or `failed` → teacher sees suggestions → accept / modify / reject. Accept or modify writes
`question_marks` *as the teacher*, with `source` and a link to the suggestion. The
suggestion row records the decision. The worker has no code path that writes
`question_marks` or changes session status.

### 5.5a Review, correction and final approval (V1)

1. Teacher submits a valuation → backend creates `submission_results` (`pending_review`,
   method `single_valuation`) by copying the submitted marks. No result can exist without a
   teacher-submitted session.
2. Admin reviews scripts (marks, annotations, AI decisions, history).
3. Admin either corrects a question mark on the result (reason mandatory; written to
   `question_mark_history` and `audit_logs`; the teacher's valuation is untouched) or reopens
   the teacher's session for the teacher to fix.
4. Admin approves the result → final marks. Approved results are read-only unless reopened.

Second valuation, discrepancy detection and moderation (V2) plug into the same
`submission_results` step; see docs/02-database-schema.md §7.

### 5.5 Evaluated PDF

Worker copies the original into memory, draws annotations (vector paths, stamps, text)
at normalized coordinates, adds a marks summary page, saves to
`evaluated-scripts/{exam_id}/{submission_id}/v{n}.pdf`. The original object is read-only.

## 6. AI architecture

```
app/ai/
  providers/
    base.py          # OCRProvider, VisionLLMProvider, TextLLMProvider protocols
    paddle_ocr.py    # PaddleOCR implementation
    ollama.py        # AI_PROVIDER=ollama      — local development (Ollama on the dev machine)
    institution.py   # AI_PROVIDER=institution — institution GPU server (vLLM or Ollama,
                     #   OpenAI-compatible API, private network + API key)
    hosted.py        # AI_PROVIDER=hosted      — optional third-party adapter; disabled unless
                     #   institutional approval is recorded in app_settings
    null.py          # AI_PROVIDER=none        — default; AI features hidden, nothing else changes
  pipeline/
    extract.py     # PyMuPDF page rendering (e.g. 200 DPI PNG)
    ocr.py         # text + boxes per page, normalized coords
    segment.py     # map regions to exam_questions (question-number detection + VLM fallback)
    interpret.py   # VLM transcription of handwriting per region
    grade.py       # LLM compares answer vs marking scheme rubric, step analysis
    schema.py      # strict Pydantic output schema; invalid output = failed, never guessed
  prompts/         # versioned prompt templates (prompt_version stored on each result)
  registry.py      # selects providers from settings
```

Pipeline steps map to the brief: (1) extract pages, (2) OCR, (3) identify question regions,
(4) interpret handwriting, (5) compare with scheme, (6) evaluate steps, (7) detect
alternative methods, (8) suggest marks, (9) explain, (10) flag uncertainty,
(11) return structured JSON validated against `schema.py`.

Availability: manual evaluation never depends on AI. AI calls run only in background
jobs, never in a request. If the AI server is down, jobs fail with back-off and a circuit
breaker, the UI shows "AI suggestions unavailable", and teachers keep working. No marking,
saving, submitting or approval path waits on AI.

Guard rails:
- Suggested marks are validated against `max_marks`; out-of-range output is
  stored as `failed`, not corrected silently.
- AI never writes `question_marks`, never submits a session and never approves a result.
- External (hosted) processing of identifiable student scripts requires recorded
  institutional approval; the hosted adapter refuses to run without it.
- Low OCR confidence, unmapped regions or model disagreement set flags
  (`illegible`, `uncertain_mapping`, `alternative_method`, `low_confidence`).
- Inputs sent to a provider are page images and rubric text only. Student names and
  register numbers are not sent.
- Each result stores provider, model, prompt version and raw response for reproducibility.

## 7. Background jobs

Table-backed queue (`jobs`), types: `validate_submission`, `ocr_submission`,
`ai_evaluate_submission`, `generate_evaluated_pdf`, `google_import`, `report_export`.

- **Free tier:** the worker loop runs inside the FastAPI process (lifespan task). Render
  free services sleep after inactivity, so jobs pause and resume on next wake. Acceptable
  for development and pilots.
- **Production:** run the same worker entrypoint as a separate Render Background Worker
  (paid) or on a GPU host for AI jobs.
- Jobs are idempotent, have `attempts/max_attempts`, exponential back-off and a
  `locked_until` lease so crashed workers do not strand jobs.

## 7a. Concurrency and scalability

Designed for many teachers evaluating at once:

- **Stateless API.** No per-user state in process memory, so the web service scales
  horizontally behind Render's load balancer.
- **Disjoint write sets.** Each teacher writes only their own session's rows; teachers do
  not contend for the same rows.
- **Optimistic concurrency.** `evaluation_sessions.version` and `submission_results.version`
  with `If-Match` → 409 on conflict (two tabs, admin vs. teacher).
- **Batched autosave.** Annotations and marks are sent as debounced batches, not one
  request per stroke.
- **Bounded DB connections.** SQLAlchemy pool (default 5 + 5 overflow per instance) behind
  the Supavisor pooler. Size pools per Supabase plan connection limits.
- **Direct-to-storage file transfer.** PDFs move between browser and Storage via signed
  URLs, so large files never pass through the API.
- **Heavy work off the request path.** OCR, AI, PDF generation and imports run in the job
  queue (`SKIP LOCKED`), which supports several workers in parallel.
- **Indexes.** Every access path used by dashboards and RLS checks
  (`teacher_id, status`, `exam_id, status`) is indexed.

## 8. Key risks and dependencies

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Local Python is 3.14; PaddlePaddle / PaddleOCR wheels lag new Python releases | AI deps fail to install | **Resolved:** Python 3.12 via uv; `paddlepaddle 3.2.2` + `paddleocr 3.3.3` verified (install + import + `run_check`) on Windows; Linux verified by `ai-deps` CI |
| R11 | Windows Smart App Control on the dev machine blocks unsigned native binaries (`pytest.exe` shim, SQLAlchemy Cython DLL) | Local tests fail to start | Use `python -m pytest`; install SQLAlchemy's pure-Python build locally (see docs/development-setup.md). CI/production unaffected |
| R2 | PaddleOCR + Qwen3-VL need GBs of RAM / a GPU; Render free has 512 MB | AI cannot run on free cloud tier | AI worker optional; hosted OpenAI-compatible provider or a GPU host in production (paid) |
| R3 | PaddleOCR is weak on handwriting | Poor transcription | Use OCR for layout and question numbers; use VLM for handwriting; flag low confidence |
| R4 | Sending student scripts to third-party AI | Privacy / regulatory exposure | Provider allow-list in settings, strip identifiers, institution sign-off, DPA with provider |
| R5 | Render free sleeps after ~15 min, cold start ~1 min | Slow first request | Acceptable for dev; paid instance for exam periods |
| R6 | Supabase free: 500 MB DB, 1 GB storage, 50 MB per file, project pauses after 7 days idle, no backups | Storage exhaustion; data-loss risk | Supabase Pro for any real student data (backups) |
| R7 | Google Classroom/Drive scopes are sensitive/restricted | OAuth verification needed | Register as an *Internal* app in the institution's Google Workspace |
| R8 | Vercel Hobby plan is non-commercial | Licence issue for institutional use | Hobby only for personal dev previews; institutional use: Cloudflare Pages (free tier allows commercial use), Render Static Site, or Vercel Pro (see 07) |
| R9 | Concurrent edits from two tabs | Lost annotations | Session `version` + 409 conflict handling + client UUIDs |
| R10 | Large scanned PDFs (100+ pages) in browser | Memory/jank | Virtualized page rendering, render only visible pages ± 1 |
