# 02 — Database Schema

Status: APPROVED (rev 2, 2026-11-21) · Target: Supabase Postgres 15+ · Managed by Alembic

## 1. Conventions

- Primary keys: `id uuid primary key default gen_random_uuid()`.
- Timestamps: `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` maintained by trigger `app.set_updated_at()`.
- Emails: `text` with a unique index on `lower(email)` (no extensions required; `gen_random_uuid()` is built into PostgreSQL 13+).
- Marks: `numeric(6,2)`, never floating point.
- Enums: Postgres enum types (listed in section 3).
- Foreign keys: `on delete restrict` by default. Exam data is never cascade-deleted; exams are archived instead.
- Soft delete only where needed (`annotations.deleted_at`).
- All tables live in `public`, all have RLS **enabled and forced**. No policy grants anything to `anon`.
- Helper functions and the Alembic version table live in the private `app` schema, which the Supabase Data API does not expose.
- Append-only tables (`audit_logs`, `question_mark_history`) reject `UPDATE`/`DELETE` via trigger `app.forbid_mutation()`.

Tables beyond the brief's list are marked **(added)** with the reason.

## 2. Entity relationship overview

```
auth.users 1─1 profiles
profiles 1─* exams (created_by)
exams 1─* exam_sections 1─* exam_questions (self-ref parent_id for sub-questions)
exam_questions 1─* marking_schemes (versioned)
exams 1─* submissions 1─* submission_pages
exams 1─* bundles
bundles 1─* paper_assignments *─1 submissions
paper_assignments *─1 profiles (teacher)
paper_assignments 1─1 evaluation_sessions        (valuation_type: first | second | moderation)
evaluation_sessions 1─* question_marks *─1 exam_questions
question_marks 1─* question_mark_history          (append-only)
submissions 1─* discrepancies ─ first/second/moderation sessions
submissions 1─1 submission_results 1─* result_question_marks   (final approved marks)
evaluation_sessions 1─* annotations
submissions 1─* ai_evaluations *─1 exam_questions
question_marks *─0..1 ai_evaluations
profiles 1─* google_integrations
jobs, audit_logs, app_settings (standalone)
```

## 3. Enum types

| Enum | Values |
|---|---|
| `user_role` | `admin`, `teacher` |
| `exam_status` | `draft`, `published`, `evaluating`, `under_review`, `completed`, `archived` |
| `valuation_mode` | `single`, `double` |
| `choice_rule` | `best_n`, `first_n` |
| `submission_status` | `uploading`, `validating`, `ready`, `rejected`, `assigned`, `in_evaluation`, `evaluated`, `under_review`, `approved` |
| `submission_source` | `manual_upload`, `bulk_upload`, `google_classroom`, `google_forms` |
| `bundle_status` | `open`, `assigned`, `in_progress`, `completed` |
| `valuation_type` | `first`, `second`, `moderation` |
| `assignment_status` | `assigned`, `in_progress`, `submitted`, `revoked` |
| `session_status` | `in_progress`, `submitted`, `reopened` |
| `mark_source` | `manual`, `ai_accepted`, `ai_modified`, `admin_correction` |
| `annotation_type` | `pen`, `pencil`, `highlighter`, `tick`, `cross`, `text`, `mark_label` |
| `ai_status` | `queued`, `running`, `completed`, `failed` |
| `ai_decision` | `pending`, `accepted`, `modified`, `rejected` |
| `discrepancy_status` | `open`, `moderation_assigned`, `resolved`, `waived` |
| `result_status` | `pending_review`, `approved`, `withheld` |
| `result_method` | `single_valuation`, `average`, `moderated`, `admin_corrected` |
| `job_status` | `queued`, `running`, `succeeded`, `failed`, `cancelled` |
| `integration_provider` | `google_classroom`, `google_forms` |
| `integration_status` | `active`, `revoked`, `error` |

## 4. Tables

### 4.1 `profiles`
One row per Supabase Auth user. Role is stored **here**, never in `user_metadata` (users can edit their own metadata).

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, FK → `auth.users(id)` on delete cascade |
| email | text | not null; unique index on `lower(email)` |
| full_name | text | not null, length 1–200 |
| role | user_role | not null default `teacher` |
| employee_code | text | unique, nullable |
| department | text | nullable |
| phone | text | nullable |
| is_active | boolean | not null default true |
| last_login_at | timestamptz | nullable |
| created_at / updated_at | timestamptz | |

Indexes: `(role) where is_active`.
A trigger on `auth.users` insert creates the profile only when the backend invite flow has pre-registered it (public sign-up is disabled).

### 4.2 `exams`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| code | text | not null, unique (e.g. `CS301-ESE-2026`) |
| title | text | not null |
| course_code | text | not null |
| course_name | text | not null |
| academic_year | text | not null (e.g. `2026-27`) |
| semester | text | nullable |
| exam_date | date | nullable |
| total_max_marks | numeric(6,2) | not null, check > 0 |
| pass_marks | numeric(6,2) | nullable, check ≤ total_max_marks |
| marks_step | numeric(4,2) | not null default 0.5, check > 0 |
| valuation_mode | valuation_mode | not null default `single` (V1 UI supports `single`) |
| discrepancy_threshold | numeric(6,2) | nullable — absolute difference in totals that triggers moderation (double valuation) |
| discrepancy_threshold_pct | numeric(5,2) | nullable — alternative percentage threshold |
| moderator_sees_prior_valuations | boolean | not null default true |
| ai_enabled | boolean | not null default false |
| teacher_can_trigger_ai | boolean | not null default false |
| status | exam_status | not null default `draft` |
| instructions | text | nullable |
| created_by | uuid | FK → profiles |
| created_at / updated_at | timestamptz | |

Indexes: `(status)`, `(academic_year, course_code)`.

### 4.3 `exam_sections` **(added)**
Needed for "automatic section totals" and "answer any N" choice rules.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| exam_id | uuid | FK → exams, not null |
| label | text | not null (e.g. `A`) |
| title | text | nullable |
| display_order | int | not null |
| required_answers | int | nullable, check > 0 (null = all questions count) |
| choice_rule | choice_rule | not null default `best_n` |
| max_marks | numeric(6,2) | not null, check > 0 |

Unique: `(exam_id, label)`, `(exam_id, display_order)`.

### 4.4 `exam_questions`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| exam_id | uuid | FK → exams, not null (denormalized for RLS and joins) |
| section_id | uuid | FK → exam_sections, not null |
| parent_id | uuid | FK → exam_questions, nullable (sub-question) |
| number | text | not null (e.g. `3`, `3a`, `3a(ii)`) |
| display_order | int | not null |
| question_text | text | nullable |
| max_marks | numeric(6,2) | not null, check > 0 |
| is_optional | boolean | not null default false |

Unique: `(exam_id, number)`. Index: `(section_id, display_order)`, `(parent_id)`.
Invariant (validated in service + deferred constraint trigger): sum of children `max_marks` = parent `max_marks`; sub-question shares parent's section; depth ≤ 3. Structure is locked once any session exists for the exam.

### 4.5 `marking_schemes`
Versioned per question; AI and teachers always reference a specific version.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| exam_question_id | uuid | FK → exam_questions, not null |
| version | int | not null, check ≥ 1 |
| model_answer | text | nullable |
| rubric | jsonb | not null default `[]` — `[{id, description, marks, keywords[]}]`, validated by Pydantic |
| alternative_methods | jsonb | not null default `[]` |
| evaluator_notes | text | nullable |
| document_path | text | nullable (object in `scheme-documents` bucket) |
| is_active | boolean | not null default true |
| created_by | uuid | FK → profiles |
| created_at | timestamptz | |

Unique: `(exam_question_id, version)`; partial unique `(exam_question_id) where is_active`.

### 4.6 `submissions`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| exam_id | uuid | FK → exams, not null |
| register_number | text | not null |
| student_name | text | nullable |
| status | submission_status | not null default `uploading` |
| source | submission_source | not null |
| external_ref | text | nullable (Classroom submission id / Forms response id) |
| original_path | text | nullable until finalized; immutable afterwards (trigger) |
| original_sha256 | char(64) | nullable until finalized |
| file_size_bytes | bigint | check > 0 |
| page_count | int | check > 0 |
| rejection_reason | text | nullable |
| evaluated_pdf_path | text | nullable |
| evaluated_pdf_version | int | not null default 0 |
| final_total | numeric(6,2) | nullable (copied from submitted session) |
| uploaded_by | uuid | FK → profiles |
| created_at / updated_at | timestamptz | |

Unique: `(exam_id, register_number)`, partial unique `(exam_id, source, external_ref) where external_ref is not null`.
Indexes: `(exam_id, status)`, `(original_sha256)` (duplicate-upload detection).

### 4.7 `submission_pages` **(added)**
Page geometry is required for normalized coordinates and export; OCR output is cached per page.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| submission_id | uuid | FK → submissions, not null |
| page_number | int | not null, check ≥ 1 (1-based) |
| width_pt | numeric(8,2) | not null |
| height_pt | numeric(8,2) | not null |
| rotation | smallint | not null, check in (0,90,180,270) |
| ocr_text | text | nullable |
| ocr_blocks | jsonb | nullable — `[{text, conf, bbox:[x0,y0,x1,y1] normalized}]` |
| ocr_engine | text | nullable |

Unique: `(submission_id, page_number)`.

### 4.8 `bundles` **(added)**
The brief requires "bundles of answer scripts" allocated to teachers.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| exam_id | uuid | FK → exams, not null |
| name | text | not null |
| teacher_id | uuid | FK → profiles, nullable until assigned |
| status | bundle_status | not null default `open` |
| due_at | timestamptz | nullable |
| created_by | uuid | FK → profiles |
| created_at / updated_at | timestamptz | |

Unique: `(exam_id, name)`. Index: `(teacher_id, status)`.

### 4.9 `paper_assignments`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| submission_id | uuid | FK → submissions, not null |
| bundle_id | uuid | FK → bundles, not null |
| teacher_id | uuid | FK → profiles, not null |
| valuation_type | valuation_type | not null default `first` |
| valuation_round | smallint | not null default 1, check ≥ 1 |
| status | assignment_status | not null default `assigned` |
| assigned_by | uuid | FK → profiles |
| assigned_at | timestamptz | not null default now() |
| revoked_at | timestamptz | nullable |
| revoke_reason | text | nullable |

Partial unique: `(submission_id, valuation_type, valuation_round) where status <> 'revoked'` — one live assignment per script per valuation.
Trigger: a teacher may not hold two non-revoked assignments for the same submission (first and second valuers must differ — blind independent valuation).
RLS: second valuers cannot read other valuers' marks or annotations for the same script; moderators can only if `exams.moderator_sees_prior_valuations` is true.
Indexes: `(teacher_id, status)`, `(bundle_id)`.
Check: `teacher_id` must reference a profile with role `teacher` (validated by trigger).

### 4.10 `evaluation_sessions`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| assignment_id | uuid | FK → paper_assignments, not null, unique |
| submission_id | uuid | FK → submissions, not null (denormalized for RLS) |
| teacher_id | uuid | FK → profiles, not null (denormalized for RLS) |
| status | session_status | not null default `in_progress` |
| version | int | not null default 1 (optimistic concurrency) |
| last_page | int | not null default 1 |
| computed_total | numeric(6,2) | nullable — always written by backend |
| section_totals | jsonb | nullable — backend snapshot `{section_id: total}` |
| started_at | timestamptz | not null default now() |
| last_saved_at | timestamptz | nullable |
| submitted_at | timestamptz | nullable |
| reopened_at | timestamptz | nullable |
| reopen_reason | text | nullable |

Index: `(teacher_id, status)`, `(submission_id)`.

### 4.11 `question_marks`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| session_id | uuid | FK → evaluation_sessions, not null |
| exam_question_id | uuid | FK → exam_questions, not null |
| awarded_marks | numeric(6,2) | nullable, check ≥ 0 |
| not_attempted | boolean | not null default false |
| source | mark_source | not null default `manual` |
| ai_evaluation_id | uuid | FK → ai_evaluations, nullable |
| comment | text | nullable, length ≤ 2000 |
| updated_by | uuid | FK → profiles |
| updated_at | timestamptz | |

Unique: `(session_id, exam_question_id)`.
Check: `not (not_attempted and awarded_marks is not null)`; `(source = 'manual') or ai_evaluation_id is not null`.
Trigger: `awarded_marks ≤ exam_questions.max_marks`; reject writes when session `status = 'submitted'`.

### 4.11a `question_mark_history` **(added)**
Append-only evaluation history: one row per change of a mark, including AI accept/modify and admin corrections.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| question_mark_id | uuid | FK → question_marks, nullable |
| result_question_mark_id | uuid | FK → result_question_marks, nullable |
| session_id | uuid | FK → evaluation_sessions, nullable |
| exam_question_id | uuid | FK → exam_questions, not null |
| old_awarded / new_awarded | numeric(6,2) | nullable |
| old_not_attempted / new_not_attempted | boolean | |
| source | mark_source | not null |
| reason | text | nullable; **required** when `source = 'admin_correction'` |
| changed_by | uuid | FK → profiles, not null |
| changed_at | timestamptz | not null default now() |

Check: exactly one of `question_mark_id`, `result_question_mark_id` is not null.
Indexes: `(question_mark_id, changed_at)`, `(result_question_mark_id, changed_at)`.

### 4.12 `annotations`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK — **client-generated** (idempotent upsert) |
| session_id | uuid | FK → evaluation_sessions, not null |
| page_number | int | not null, check ≥ 1 |
| type | annotation_type | not null |
| data | jsonb | not null — type-specific, normalized coords (below) |
| z_index | int | not null default 0 |
| created_at / updated_at | timestamptz | |
| deleted_at | timestamptz | nullable (undo/eraser sync) |

Index: `(session_id, page_number) where deleted_at is null`.
`data` shapes (validated by Pydantic discriminated union, size ≤ 64 KB):
- stroke (`pen`/`pencil`/`highlighter`): `{points: [[x,y],...], width, color, opacity}`
- stamp (`tick`/`cross`): `{x, y, size, color}`
- `text`: `{x, y, w, text, font_size, color}`
- `mark_label`: `{x, y, question_id, value}`

All `x, y, w, size, width` are fractions of page width/height in `[0,1]`.

### 4.13 `ai_evaluations`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| submission_id | uuid | FK → submissions, not null |
| exam_question_id | uuid | FK → exam_questions, not null |
| marking_scheme_id | uuid | FK → marking_schemes, not null |
| job_id | uuid | FK → jobs, nullable |
| status | ai_status | not null default `queued` |
| provider | text | not null |
| model | text | not null |
| prompt_version | text | not null |
| transcription | text | nullable |
| suggested_marks | numeric(6,2) | nullable, check ≥ 0 |
| max_marks | numeric(6,2) | not null (snapshot) |
| confidence | numeric(3,2) | nullable, check between 0 and 1 |
| explanation | text | nullable |
| step_analysis | jsonb | nullable — `[{rubric_id, awarded, reason}]` |
| alternative_method | boolean | not null default false |
| flags | text[] | not null default `{}` |
| regions | jsonb | nullable — `[{page, bbox}]` normalized |
| raw_response | jsonb | nullable |
| error | text | nullable |
| decision | ai_decision | not null default `pending` |
| decided_by | uuid | FK → profiles, nullable |
| decided_at | timestamptz | nullable |
| created_at / updated_at | timestamptz | |

Check: `suggested_marks is null or suggested_marks ≤ max_marks`.
Index: `(submission_id, exam_question_id, created_at desc)`, `(status)`.

### 4.13a `discrepancies` **(added — V2 workflow, V1 schema)**
Raised when two valuations of the same submission differ by more than the exam threshold.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| submission_id | uuid | FK → submissions, not null |
| exam_question_id | uuid | FK → exam_questions, nullable (null = total-level discrepancy) |
| first_session_id | uuid | FK → evaluation_sessions, not null |
| second_session_id | uuid | FK → evaluation_sessions, not null |
| first_value / second_value | numeric(6,2) | not null |
| difference | numeric(6,2) | generated always as `abs(first_value - second_value)` stored |
| threshold_applied | numeric(6,2) | not null (snapshot) |
| status | discrepancy_status | not null default `open` |
| moderation_session_id | uuid | FK → evaluation_sessions, nullable |
| resolution_note | text | nullable |
| resolved_by | uuid | FK → profiles, nullable |
| resolved_at | timestamptz | nullable |
| created_at / updated_at | timestamptz | |

Check: `first_session_id <> second_session_id`. One open discrepancy per (submission, question) via partial unique index.

### 4.13b `submission_results` **(added)**
The **final approved marks** for a submission. Separate from valuations, so teacher work is never overwritten by corrections or moderation.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| submission_id | uuid | FK → submissions, not null, unique |
| status | result_status | not null default `pending_review` |
| method | result_method | not null |
| source_session_id | uuid | FK → evaluation_sessions, nullable |
| total | numeric(6,2) | not null — computed by backend |
| section_totals | jsonb | not null |
| version | int | not null default 1 (optimistic concurrency) |
| reviewed_by / approved_by | uuid | FK → profiles, nullable |
| approved_at | timestamptz | nullable |
| withheld_reason | text | nullable |
| created_at / updated_at | timestamptz | |

Check: `status <> 'approved' or (approved_by is not null and approved_at is not null)`.
Trigger: a result can be created only from a session with `status = 'submitted'` — **teacher approval is mandatory before finalisation**. An approved result is read-only unless an admin reopens it (audited).

### 4.13c `result_question_marks` **(added)**

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| result_id | uuid | FK → submission_results, not null |
| exam_question_id | uuid | FK → exam_questions, not null |
| awarded_marks | numeric(6,2) | nullable, check ≥ 0 |
| not_attempted | boolean | not null default false |
| source | mark_source | not null (`manual` = copied from valuation; `admin_correction` = changed in review) |
| source_question_mark_id | uuid | FK → question_marks, nullable |
| correction_reason | text | required when `source = 'admin_correction'` |
| updated_by | uuid | FK → profiles |
| updated_at | timestamptz | |

Unique: `(result_id, exam_question_id)`.

### 4.14 `audit_logs`
Append-only. `UPDATE`/`DELETE` blocked by trigger and revoked from all roles except table owner.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| occurred_at | timestamptz | not null default now() |
| actor_id | uuid | FK → profiles, nullable (null = system job) |
| actor_role | user_role | nullable |
| action | text | not null (e.g. `marks.update`, `session.submit`, `assignment.revoke`, `submission.download_url`) |
| entity_type | text | not null |
| entity_id | uuid | nullable |
| exam_id | uuid | nullable (filtering) |
| before | jsonb | nullable |
| after | jsonb | nullable |
| ip_address | inet | nullable |
| user_agent | text | nullable |
| request_id | text | nullable |

Indexes: `(entity_type, entity_id)`, `(actor_id, occurred_at desc)`, `(exam_id, occurred_at desc)`, BRIN on `occurred_at`.

### 4.15 `google_integrations`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| profile_id | uuid | FK → profiles, not null |
| provider | integration_provider | not null |
| google_account_email | text | not null |
| scopes | text[] | not null |
| refresh_token_encrypted | bytea | not null — AES-GCM (Fernet) with key from env, never returned by API |
| status | integration_status | not null default `active` |
| connected_at | timestamptz | not null default now() |
| last_synced_at | timestamptz | nullable |
| last_error | text | nullable |

Unique: `(profile_id, provider, google_account_email)`.
Links from exams to external sources are stored in `exam_external_sources` **(added)**: `(id, exam_id, integration_id, provider, course_id, coursework_id, form_id, register_number_field, created_at)`.

### 4.16 `jobs` **(added)**
Durable queue for OCR, AI, PDF generation and imports (see architecture §7).

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| type | text | not null |
| payload | jsonb | not null |
| status | job_status | not null default `queued` |
| priority | smallint | not null default 100 |
| attempts | int | not null default 0 |
| max_attempts | int | not null default 3 |
| run_after | timestamptz | not null default now() |
| locked_until | timestamptz | nullable |
| locked_by | text | nullable |
| last_error | text | nullable |
| dedupe_key | text | nullable, partial unique where status in (`queued`,`running`) |
| created_by | uuid | FK → profiles, nullable |
| created_at / finished_at | timestamptz | |

Index: `(status, priority, run_after)`.

### 4.17 `app_settings` **(added)**
Backs module 20 (application settings). Secrets are **never** stored here.

| Column | Type | Constraints |
|---|---|---|
| key | text | PK (e.g. `upload.max_file_mb`, `ai.provider`, `ai.allowed_providers`) |
| value | jsonb | not null |
| updated_by | uuid | FK → profiles |
| updated_at | timestamptz | |

## 5. Row Level Security

Helper functions (`security definer`, `stable`, `search_path = ''`):

```sql
create function app.current_role() returns user_role ...
  -- select role from public.profiles where id = auth.uid() and is_active
create function app.is_admin() returns boolean ...
create function app.teacher_can_access_submission(sub uuid) returns boolean ...
  -- exists active (non-revoked) paper_assignment for (sub, auth.uid())
```

| Table | Admin | Teacher |
|---|---|---|
| profiles | all | select own row; select name/email of admins (via view) |
| exams, exam_sections, exam_questions | all | select where exam has an active assignment for them |
| marking_schemes | all | select active scheme for exams they are assigned to |
| submissions, submission_pages | all | select where `teacher_can_access_submission(id)` |
| bundles | all | select where `teacher_id = auth.uid()` |
| paper_assignments | all | select where `teacher_id = auth.uid()` |
| evaluation_sessions | all | select/update where `teacher_id = auth.uid()` and assignment not revoked |
| question_marks, annotations | all | all where parent session belongs to them and session not submitted |
| question_mark_history | select | select rows for their own sessions |
| discrepancies, submission_results, result_question_marks | all | none in V1 (V2: moderators read assigned discrepancies) |
| ai_evaluations | all | select + update `decision` where they can access the submission |
| audit_logs | select | none |
| google_integrations | own rows | own rows (if teacher integrations enabled) |
| jobs, app_settings | select/all | none |

Storage policies on `storage.objects`: all three buckets are private (`public = false`). No `authenticated` policy grants read; every object access goes through backend-issued signed URLs. `answer-scripts/originals/*` objects are never updated or deleted by application code; only a manual service-role retention script may delete them.

## 6. Migration plan

Alembic revisions (one per phase, reversible where safe):

1. `0001` — enums, `app` schema, `app.set_updated_at`, `app.forbid_mutation` — **done (Phase 0)**.
2. `0002_profiles_audit_settings` — profiles, audit_logs, app_settings, RLS helpers, RLS.
3. `0003_exams_questions_schemes` — exams, exam_sections, exam_questions, marking_schemes.
4. `0004_submissions_pages_storage` — includes bucket creation and storage policies.
5. `0005_bundles_assignments`.
6. `0006_sessions_marks_annotations_history`.
7. `0007_results_discrepancies`.
8. `0008_jobs_ai_evaluations`.
9. `0009_google_integrations`.

CI fails if any `public` table lacks forced RLS (`python -m scripts.check_rls`).

## 7. Valuation model

V1 implements first valuation, admin review, correction and final approval. The schema already
supports second valuation, moderation and discrepancy tracking; their screens are V2.

```
first valuation ── teacher submits ──┐
                                     │ single mode (V1)
                                     ▼
                       submission_results (pending_review)
                                     │ admin review
                                     │  ├─ correct a mark (reason required → history + audit)
                                     │  └─ or reopen the teacher's session (audited)
                                     ▼
                            approved = final marks

double mode (V2):
first valuation ─┐
second valuation ┴─ compare ─┬─ within threshold → result (method: average / configurable)
                             └─ beyond threshold → discrepancies → moderation session
                                                   → result (method: moderated)
```

- Only the assigned teacher edits a valuation, and only while it is in progress.
- Corrections are written to `result_question_marks`, so the original valuation stays intact.
