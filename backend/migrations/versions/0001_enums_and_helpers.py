"""Enum types and shared helper functions.

Revision ID: 0001
Revises:
Create Date: 2026-11-21

Creates every enum used by the schema in docs/02-database-schema.md §3, plus trigger
helpers in the private `app` schema. No tables yet (tables start in 0002).
`gen_random_uuid()` is built into PostgreSQL 13+, so no extension is required.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ENUMS: dict[str, tuple[str, ...]] = {
    "user_role": ("admin", "teacher"),
    "exam_status": ("draft", "published", "evaluating", "under_review", "completed", "archived"),
    "valuation_mode": ("single", "double"),
    "choice_rule": ("best_n", "first_n"),
    "submission_status": (
        "uploading",
        "validating",
        "ready",
        "rejected",
        "assigned",
        "in_evaluation",
        "evaluated",
        "under_review",
        "approved",
    ),
    "submission_source": ("manual_upload", "bulk_upload", "google_classroom", "google_forms"),
    "bundle_status": ("open", "assigned", "in_progress", "completed"),
    "valuation_type": ("first", "second", "moderation"),
    "assignment_status": ("assigned", "in_progress", "submitted", "revoked"),
    "session_status": ("in_progress", "submitted", "reopened"),
    "mark_source": ("manual", "ai_accepted", "ai_modified", "admin_correction"),
    "annotation_type": ("pen", "pencil", "highlighter", "tick", "cross", "text", "mark_label"),
    "ai_status": ("queued", "running", "completed", "failed"),
    "ai_decision": ("pending", "accepted", "modified", "rejected"),
    "discrepancy_status": ("open", "moderation_assigned", "resolved", "waived"),
    "result_status": ("pending_review", "approved", "withheld"),
    "result_method": ("single_valuation", "average", "moderated", "admin_corrected"),
    "job_status": ("queued", "running", "succeeded", "failed", "cancelled"),
    "integration_provider": ("google_classroom", "google_forms"),
    "integration_status": ("active", "revoked", "error"),
}


def upgrade() -> None:
    op.execute("create schema if not exists app")

    for name, values in ENUMS.items():
        labels = ", ".join(f"'{v}'" for v in values)
        op.execute(f"create type public.{name} as enum ({labels})")

    # Keeps updated_at honest regardless of what the application sends.
    op.execute(
        """
        create or replace function app.set_updated_at() returns trigger
        language plpgsql set search_path = '' as $$
        begin
          new.updated_at := now();
          return new;
        end;
        $$
        """
    )

    # Attached to append-only tables (audit_logs, question_mark_history).
    op.execute(
        """
        create or replace function app.forbid_mutation() returns trigger
        language plpgsql set search_path = '' as $$
        begin
          raise exception 'table %.% is append-only', tg_table_schema, tg_table_name
            using errcode = 'insufficient_privilege';
        end;
        $$
        """
    )


def downgrade() -> None:
    op.execute("drop function if exists app.forbid_mutation()")
    op.execute("drop function if exists app.set_updated_at()")
    for name in reversed(ENUMS):
        op.execute(f"drop type if exists public.{name}")
    # Schema `app` is kept: it holds alembic_version.
