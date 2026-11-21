# 03 — API Specification

Status: APPROVED (rev 2) · Base path: `/api/v1` · Format: JSON · Auth: `Authorization: Bearer <Supabase access token>`

The full machine-readable contract is FastAPI's generated OpenAPI at `/api/v1/openapi.json`
(disabled in production unless `EXPOSE_DOCS=true`). This document is the design contract.

## 1. Conventions

- **Roles:** `A` = admin, `T` = teacher (only own assigned data), `A/T` = both with per-object checks.
- **Pagination:** `?page=1&page_size=25` (max 100). Response: `{items, page, page_size, total}`.
- **Filtering/sorting:** explicit query params per endpoint; `sort` from an allow-list.
- **IDs:** UUIDs in path. Unknown or unauthorized objects both return **404** (no existence leak).
- **Concurrency:** mutable workspace resources take `If-Match: <version>`; mismatch → `409`.
- **Idempotency:** POSTs that create jobs or uploads accept `Idempotency-Key` header.
- **Errors:**

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Awarded marks exceed maximum", "details": [{"field": "marks[2].awarded_marks"}], "request_id": "..." } }
```

| HTTP | code |
|---|---|
| 400 | `BAD_REQUEST` |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN` (role failure only) |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT` / `VERSION_CONFLICT` / `INVALID_STATE` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 422 | `VALIDATION_ERROR` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` (no details) |

## 2. Health and session

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/health` | public | Liveness |
| GET | `/health/ready` | public | DB + storage reachability (no details) |
| GET | `/me` | A/T | Current profile, role, permissions |
| PATCH | `/me` | A/T | Update own `full_name`, `phone` |

Login, logout, refresh and password reset are handled by Supabase Auth from the frontend.

## 3. Teacher management (admin)

| Method | Path | Purpose |
|---|---|---|
| GET | `/teachers` | List, filter `q`, `department`, `is_active` |
| POST | `/teachers` | Invite teacher (Supabase admin invite + profile) |
| GET | `/teachers/{id}` | Detail + workload summary |
| PATCH | `/teachers/{id}` | Update name, department, employee code |
| POST | `/teachers/{id}:deactivate` | Disable login (bans auth user, revokes nothing automatically) |
| POST | `/teachers/{id}:activate` | Re-enable |
| POST | `/teachers/{id}:resend-invite` | Resend invite |
| POST | `/teachers/import` | CSV import (validated, returns per-row result) |

## 4. Exams, sections, questions, marking schemes

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/exams` | A | List; filter `status`, `academic_year`, `q` |
| POST | `/exams` | A | Create (draft) |
| GET | `/exams/{id}` | A/T | Detail (teacher: only if assigned) |
| PATCH | `/exams/{id}` | A | Update (structure fields locked after evaluation starts) |
| POST | `/exams/{id}:publish` | A | Validate structure (totals consistent) → `published` |
| POST | `/exams/{id}:start-evaluation` | A | → `evaluating` |
| POST | `/exams/{id}:complete` | A | Requires all sessions submitted → `completed` |
| POST | `/exams/{id}:archive` | A | → `archived` (read-only) |
| GET | `/exams/{id}/structure` | A/T | Sections → questions → sub-questions tree |
| PUT | `/exams/{id}/structure` | A | Replace whole tree atomically (draft only); validated sums |
| GET | `/exams/{id}/questions/{qid}/marking-schemes` | A | All versions |
| POST | `/exams/{id}/questions/{qid}/marking-schemes` | A | New version (becomes active) |
| GET | `/exams/{id}/marking-schemes/active` | A/T | Active schemes (teacher: only if assigned) |
| POST | `/exams/{id}/scheme-documents/upload-url` | A | Signed upload URL for a scheme PDF |

## 5. Submissions

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/exams/{id}/submissions` | A | List; filter `status`, `assigned`, `q` |
| POST | `/exams/{id}/submissions/upload-urls` | A | Body: `[{register_number, student_name, file_name, size_bytes}]` (≤ 100). Creates rows, returns signed upload URLs (valid 10 min) |
| POST | `/submissions/{id}:finalize` | A | Server validation (magic bytes, size, PyMuPDF open, page count, hash), move to originals |
| GET | `/submissions/{id}` | A/T | Metadata + pages |
| GET | `/submissions/{id}/file-url` | A/T | Signed GET URL for original (5 min). Audited |
| GET | `/submissions/{id}/evaluated-file-url` | A/T | Signed GET URL for latest evaluated PDF (5 min). Audited |
| PATCH | `/submissions/{id}` | A | Fix `register_number` / `student_name` |
| DELETE | `/submissions/{id}` | A | Only when never assigned; original object kept per retention policy |

## 6. Bundles and assignments

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/exams/{id}/bundles` | A | List with progress counts |
| POST | `/exams/{id}/bundles` | A | Create bundle with `submission_ids` |
| POST | `/exams/{id}/bundles:auto-split` | A | Body `{size}` or `{teacher_ids}` → evenly split unassigned scripts |
| GET | `/bundles/{id}` | A/T | Detail + scripts (teacher: own bundles) |
| POST | `/bundles/{id}:assign` | A | Body `{teacher_id, due_at}` |
| POST | `/bundles/{id}:reassign` | A | Body `{teacher_id, reason}`; revokes in-progress assignments (sessions kept for audit) |
| POST | `/bundles/{id}/submissions` | A | Add scripts |
| DELETE | `/bundles/{id}/submissions/{sid}` | A | Remove script (only if not started) |
| GET | `/my/bundles` | T | Teacher dashboard: own bundles with progress |
| GET | `/my/assignments` | T | Own assignments; filter `status`, `bundle_id` |

## 7. Evaluation workspace (teacher)

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/assignments/{id}/session` | T | Open or resume session → `{session, file_url, pages, structure, marks, annotations_version}` |
| GET | `/sessions/{id}` | A/T | Session state |
| PATCH | `/sessions/{id}` | T | `{last_page}` (resume position) |
| GET | `/sessions/{id}/annotations?page=n` | A/T | Annotations (all pages if `page` omitted) |
| PUT | `/sessions/{id}/annotations:batch` | T | `If-Match`. Body `{upserts:[...], deletes:[ids]}` ≤ 500 ops. Idempotent by client UUID. Returns new `version` |
| GET | `/sessions/{id}/marks` | A/T | Marks + backend-computed section and overall totals |
| PUT | `/sessions/{id}/marks` | T | `If-Match`. Body `{marks:[{exam_question_id, awarded_marks, not_attempted, comment}]}`. Returns validated totals |
| POST | `/sessions/{id}:validate` | T | Dry-run submit; returns missing/invalid questions |
| POST | `/sessions/{id}:submit` | T | Final validation, freeze, enqueue evaluated-PDF job |
| POST | `/sessions/{id}:reopen` | A | Body `{reason}` |
| GET | `/sessions/{id}/history` | A/T | Mark change history for the session |

## 7a. Review, correction and final approval (admin, V1)

| Method | Path | Purpose |
|---|---|---|
| GET | `/exams/{id}/results` | Results list; filter `status` (`pending_review`, `approved`, `withheld`) |
| GET | `/results/{id}` | Result with question marks, source valuation, AI decisions, history |
| PUT | `/results/{id}/marks` | `If-Match`. Correct marks; each changed mark requires `correction_reason`. Never edits the teacher's valuation |
| POST | `/results/{id}:approve` | Final approval. Requires the source valuation to be teacher-submitted |
| POST | `/results/{id}:withhold` | Body `{reason}` |
| POST | `/results/{id}:reopen` | Body `{reason}`; approved → pending_review |
| POST | `/exams/{id}/results:approve-bulk` | Approve all pending results without corrections (explicit confirmation flag) |

## 7b. Second valuation and moderation (V2 — reserved, not implemented in V1)

`POST /bundles/{id}:assign` gains `valuation_type`; `GET /exams/{id}/discrepancies`,
`POST /discrepancies/{id}:assign-moderator`, `POST /discrepancies/{id}:resolve`,
`POST /discrepancies/{id}:waive`.

## 8. AI suggestions

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/submissions/{id}/ai-evaluations` | A (T if exam allows) | Enqueue AI job for all or `{question_ids}`; requires active schemes |
| POST | `/exams/{id}/ai-evaluations:bulk` | A | Enqueue for all ready submissions |
| GET | `/submissions/{id}/ai-evaluations` | A/T | Latest suggestion per question |
| GET | `/ai-evaluations/{id}` | A/T | Detail incl. step analysis, regions, flags |
| POST | `/ai-evaluations/{id}:accept` | T | Writes `question_marks` (source `ai_accepted`) in caller's session |
| POST | `/ai-evaluations/{id}:modify` | T | Body `{awarded_marks, comment}` → source `ai_modified` |
| POST | `/ai-evaluations/{id}:reject` | T | Body `{reason?}`; no mark written |
| GET | `/ai/status` | A | Provider configured, reachable, queue depth |

No endpoint lets AI output become a mark without a teacher action, and no endpoint finalizes a
session other than `:submit` by the assigned teacher.

## 9. Jobs

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/jobs` | A | List; filter `type`, `status` |
| GET | `/jobs/{id}` | A (T: own AI jobs) | Status/progress |
| POST | `/jobs/{id}:retry` | A | Retry failed |
| POST | `/jobs/{id}:cancel` | A | Cancel queued |
| POST | `/submissions/{id}/evaluated-pdf:regenerate` | A | Re-run PDF generation |

## 10. Dashboards and reports

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/dashboard/admin` | A | Counts: exams by status, scripts by status, teacher progress, queue health |
| GET | `/dashboard/teacher` | T | Own pending/in-progress/submitted counts, due dates |
| GET | `/exams/{id}/progress` | A | Per-teacher and per-bundle progress |
| GET | `/exams/{id}/reports/marks` | A | Per-student totals, section totals; `format=json|csv|xlsx` |
| GET | `/exams/{id}/reports/question-analysis` | A | Mean/median/distribution per question |
| GET | `/exams/{id}/reports/ai-agreement` | A | AI vs final marks: accept/modify/reject rates, mean absolute difference |
| GET | `/exams/{id}/reports/teacher-summary` | A | Throughput, average time per script |
| POST | `/exams/{id}/evaluated-pdfs:export` | A | Job → ZIP of evaluated PDFs, signed URL on completion |

## 11. Google integrations (admin)

| Method | Path | Purpose |
|---|---|---|
| GET | `/integrations/google` | Connected accounts and status |
| POST | `/integrations/google/oauth/start` | Returns Google consent URL (state + PKCE stored server-side) |
| GET | `/integrations/google/oauth/callback` | OAuth redirect target; stores encrypted refresh token |
| DELETE | `/integrations/google/{id}` | Revoke token at Google + mark revoked |
| GET | `/integrations/google/{id}/classroom/courses` | List courses |
| GET | `/integrations/google/{id}/classroom/courses/{cid}/coursework` | List coursework |
| GET | `/integrations/google/{id}/forms/{form_id}` | Form metadata and questions |
| POST | `/exams/{id}/external-sources` | Link exam to coursework or form (+ register-number mapping) |
| POST | `/exams/{id}/external-sources/{sid}:import` | Job: pull PDF submissions → `submissions` (same validation as uploads) |

## 12. Audit and settings (admin)

| Method | Path | Purpose |
|---|---|---|
| GET | `/audit-logs` | Filter `actor_id`, `entity_type`, `entity_id`, `exam_id`, `action`, date range |
| GET | `/audit-logs/export` | CSV |
| GET | `/settings` | All non-secret settings |
| PATCH | `/settings` | Update allow-listed keys (validated per key) |

## 13. Key payloads

**Annotation upsert**
```json
{ "id": "2f4e…", "page_number": 3, "type": "pen", "z_index": 12,
  "data": { "points": [[0.1021, 0.3310], [0.1034, 0.3322]], "width": 0.0025, "color": "#d32f2f", "opacity": 1 } }
```

**Marks response**
```json
{ "session_id": "…", "version": 14,
  "marks": [{ "exam_question_id": "…", "awarded_marks": "4.50", "not_attempted": false, "source": "ai_modified", "ai_evaluation_id": "…" }],
  "totals": { "sections": [{ "section_id": "…", "label": "A", "total": "18.50", "max": "20.00", "counted_question_ids": ["…"] }],
              "overall": "61.00", "max": "100.00" },
  "complete": false, "missing_question_ids": ["…"] }
```

**AI evaluation**
```json
{ "id": "…", "exam_question_id": "…", "status": "completed", "suggested_marks": "3.00", "max_marks": "5.00",
  "confidence": 0.62, "transcription": "…", "explanation": "Correct formula; arithmetic error in step 3.",
  "step_analysis": [{ "rubric_id": "r1", "awarded": "2.00", "reason": "…" }],
  "alternative_method": false, "flags": ["low_confidence"], "regions": [{ "page": 2, "bbox": [0.08, 0.41, 0.92, 0.66] }],
  "decision": "pending", "provider": "ollama", "model": "qwen3-vl:8b", "prompt_version": "grade-v1" }
```

Marks are serialized as decimal strings to avoid float rounding.
