# 06 — Security and Authorization Strategy

Status: APPROVED (rev 2)

## 1. Threat model (summary)

| Asset | Threats |
|---|---|
| Student answer scripts (PII + academic record) | Unauthorized download, link sharing, public bucket misconfiguration, leakage to AI providers |
| Marks | Tampering by teacher on another's script, post-submit edits, client-side total manipulation, AI auto-grading |
| Accounts | Credential stuffing, role escalation via `user_metadata`, stale access for deactivated staff |
| Secrets | Service-role key in frontend bundle, keys in git, keys in logs |
| Audit trail | Deletion or modification to hide tampering |

## 2. Authentication

- Supabase Auth email + password, invite-only. **Public sign-up disabled** in project settings.
- Optional (recommended for admins): TOTP MFA via Supabase Auth; backend can require `aal2` for admin routes.
- Backend verifies every access token: signature (JWKS, cached and refreshed on unknown `kid`), `exp`, `iss = https://<ref>.supabase.co/auth/v1`, `aud = authenticated`.
- Role is read from `profiles.role` on each request (short in-process cache ≤ 60 s), **never** from `user_metadata`.
- Deactivating a teacher: `profiles.is_active = false` (immediate 403 on next request) and Supabase admin ban (blocks refresh).
- Access token lifetime 1 h (Supabase default); refresh tokens rotate.

## 3. Authorization model

Three layers, each sufficient on its own to block cross-teacher access:

1. **Route guard** — role dependency on every router (`require_admin`, `require_teacher`).
2. **Object-level check in services** — e.g. teacher must hold a non-revoked assignment for the submission; session must belong to caller and be `in_progress`.
3. **Postgres RLS** — backend executes user-scoped requests as role `authenticated` with the caller's JWT claims, so a missing service check still returns zero rows.

Additional rules:
- Unauthorized object access returns 404, not 403, to avoid confirming existence.
- An authorization matrix test suite covers every endpoint × {admin, teacher-owner, teacher-other, anonymous}.
- State machine checks: submitted sessions are read-only (service + DB trigger); archived exams are read-only.

## 4. Marks integrity

- Client totals are display-only. Backend recomputes and stores totals.
- DB constraints and triggers enforce range, ownership, and frozen state.
- AI results live in `ai_evaluations`; only teacher-initiated endpoints create `question_marks` from them.
- Every mark change writes an audit row with before/after values.

## 5. File security

- Supabase Data API: `public` removed from exposed schemas (the browser never queries tables), on top of forced RLS. Alembic's version table lives in the unexposed `app` schema.
- Buckets `answer-scripts`, `evaluated-scripts`, `scheme-documents` are **private**.
- No storage RLS policy grants direct access to `authenticated`; all access is via backend-issued signed URLs.
  - Download URLs: 5 minutes. Upload URLs: 10 minutes, single object path.
  - Each URL issuance is audited (`submission.download_url`).
- Upload validation (server-side, after direct upload):
  - Declared and actual size ≤ configured limit (default 40 MB; Supabase free plan hard limit is 50 MB).
  - Magic bytes `%PDF-`; MIME `application/pdf`.
  - Opens in PyMuPDF; not encrypted; page count 1–200 (configurable).
  - JavaScript, embedded files and launch actions are not executed (PDF.js runs with `isEvalSupported: false`; evaluated PDFs are re-rendered by PyMuPDF and contain no scripts).
  - SHA-256 stored; duplicates flagged.
- Originals are moved once from `quarantine/` to `originals/` and never written again. Application code has no update/delete path for `originals/`.

## 6. Secrets management

| Secret | Where it lives | Never in |
|---|---|---|
| Supabase service-role / secret key | Render env var | frontend, git, logs |
| Database URL (with password) | Render env var | frontend, git |
| JWT legacy secret (if used) | Render env var | frontend |
| Google OAuth client secret | Render env var | frontend |
| Token encryption key (Fernet) | Render env var | DB, frontend |
| AI provider API key | Render / worker env var | frontend, DB |
| Supabase publishable (anon) key | Vercel env var (`VITE_`) | — (designed to be public; RLS protects data) |

- `config.py` fails startup if required secrets are missing.
- `gitleaks` runs in CI. `.env` files are git-ignored.

## 7. Transport and HTTP hardening

- HTTPS only (Vercel/Render terminate TLS); HSTS.
- CORS allow-list: production Vercel domain and preview pattern only; no `*` with credentials.
- Headers: `Content-Security-Policy` (self + Supabase + API origin; `worker-src blob:` for PDF.js), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`.
- Request body limits on JSON endpoints (e.g. 1 MB; annotation batch 2 MB).
- Rate limits: login handled by Supabase; API 120 req/min per user; signed-URL issuance 30/min per user; AI triggers 10/min.

## 8. Error handling and logging

- Uniform error envelope; 500s return only `request_id`.
- Structured logs with `request_id`, `user_id`, route, latency. No tokens, PDF content, student names or marks in logs.
- Sentry (optional, free tier) with PII scrubbing.

## 9. Audit trail

- Logged actions: login-derived first API call, teacher create/deactivate, exam lifecycle, structure and scheme changes, upload/finalize/reject, assignment create/revoke, signed URL issuance, every marks write, submit, reopen, AI trigger and decision, settings changes, integration connect/revoke, exports.
- Append-only enforced by trigger and grants; admins can read but not modify.
- Retention configurable (default: keep for the academic record retention period set by the institution).

## 10. AI data protection

- Provider allow-list in `app_settings`; default `ollama` only.
- Payload minimization: cropped page images + rubric; no names or register numbers.
- **Any external processing of identifiable student scripts requires institutional approval.** The hosted adapter refuses to run unless an approval record (approver, date, reference, provider) exists in `app_settings`, and the provider has a no-training/no-retention agreement.
- Production default is the institution-owned inference server; development uses local Ollama with synthetic scripts only.
- AI outputs are treated as untrusted input: schema-validated, length-limited, rendered as text (no HTML).

## 11. Google integration security

- OAuth 2.0 authorization code flow with PKCE and `state`, server-side.
- Minimum scopes: `classroom.courses.readonly`, `classroom.coursework.students.readonly`, `forms.responses.readonly`, `forms.body.readonly`, `drive.readonly` (restricted — use an *Internal* Workspace app to avoid external verification).
- Refresh tokens encrypted at rest; revoked at Google on disconnect.

## 12. Data lifecycle

- Supabase Pro daily backups (point-in-time recovery as paid add-on) for production.
- Retention script for deleting an archived exam's files after the institution's retention period (manual, admin-confirmed, audited).
