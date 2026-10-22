"""Initial CodeCinema schema.

Revision ID: 0001_initial
Revises:
Create Date: 2026-01-01 00:00:00

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.models.base import BigIntPK, JSONBType, TimestampType, UUIDType

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SESSION_STATUS = ("draft", "recording", "complete", "failed")
SESSION_VISIBILITY = ("private", "unlisted", "public")
EXPORT_TYPE = ("json", "mp4", "gif")
EXPORT_STATUS = ("queued", "running", "succeeded", "failed")


def _enum(name: str, values: tuple[str, ...]) -> postgresql.ENUM:
    """A native PostgreSQL enum that does not emit its own CREATE TYPE."""
    return postgresql.ENUM(*values, name=name, create_type=False)


def _create_enum_types() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for name, values in (
        ("session_status", SESSION_STATUS),
        ("session_visibility", SESSION_VISIBILITY),
        ("export_type", EXPORT_TYPE),
        ("export_status", EXPORT_STATUS),
    ):
        postgresql.ENUM(*values, name=name).create(bind, checkfirst=True)


def upgrade() -> None:
    """Create every table."""
    _create_enum_types()

    op.create_table(
        "users",
        sa.Column("id", UUIDType, primary_key=True, nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("display_name", sa.String(120), nullable=True),
        sa.Column(
            "created_at",
            TimestampType,
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "api_keys",
        sa.Column("id", UUIDType, primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            UUIDType,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("key_hash", sa.String(255), nullable=False),
        sa.Column("key_prefix", sa.String(32), nullable=False),
        sa.Column(
            "created_at",
            TimestampType,
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("last_used_at", TimestampType, nullable=True),
        sa.Column("revoked_at", TimestampType, nullable=True),
    )
    op.create_index("ix_api_keys_user_id", "api_keys", ["user_id"])
    op.create_index("ix_api_keys_key_prefix", "api_keys", ["key_prefix"], unique=True)
    op.create_index("ix_api_keys_key_hash", "api_keys", ["key_hash"], unique=True)

    op.create_table(
        "sessions",
        sa.Column("id", UUIDType, primary_key=True, nullable=False),
        sa.Column(
            "owner_id",
            UUIDType,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("prompt", sa.Text, nullable=True),
        sa.Column("agent", sa.String(64), nullable=False),
        sa.Column("repo_url", sa.String(1024), nullable=True),
        sa.Column("branch", sa.String(255), nullable=True),
        sa.Column(
            "status",
            _enum("session_status", SESSION_STATUS),
            nullable=False,
            server_default="draft",
        ),
        sa.Column(
            "visibility",
            _enum("session_visibility", SESSION_VISIBILITY),
            nullable=False,
            server_default="private",
        ),
        sa.Column("share_slug", sa.String(32), nullable=True),
        sa.Column("duration_ms", sa.Integer, nullable=False, server_default="0"),
        sa.Column("event_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "metadata",
            JSONBType,
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
        sa.Column(
            "created_at",
            TimestampType,
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            TimestampType,
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("published_at", TimestampType, nullable=True),
        sa.Column("deleted_at", TimestampType, nullable=True),
    )
    op.create_index("ix_sessions_owner_id", "sessions", ["owner_id"])
    op.create_index("ix_sessions_created_at", "sessions", ["created_at"])
    op.create_index("ix_sessions_deleted_at", "sessions", ["deleted_at"])
    op.create_index("ix_sessions_share_slug", "sessions", ["share_slug"], unique=True)

    op.create_table(
        "session_events",
        sa.Column("id", BigIntPK, primary_key=True, autoincrement=True, nullable=False),
        sa.Column(
            "session_id",
            UUIDType,
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("seq", sa.Integer, nullable=False),
        sa.Column("timestamp", sa.Integer, nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("actor", sa.String(16), nullable=False, server_default="agent"),
        sa.Column(
            "payload",
            JSONBType,
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
        sa.Column("event_id", sa.String(128), nullable=True),
        sa.Column(
            "created_at",
            TimestampType,
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("session_id", "seq", name="uq_session_events_session_seq"),
    )
    op.create_index("ix_session_events_session_id", "session_events", ["session_id"])
    op.create_index(
        "ix_session_events_session_ts_seq",
        "session_events",
        ["session_id", "timestamp", "seq"],
    )
    op.create_index(
        "uq_session_events_event_id",
        "session_events",
        ["session_id", "event_id"],
        unique=True,
        postgresql_where=sa.text("event_id IS NOT NULL"),
        sqlite_where=sa.text("event_id IS NOT NULL"),
    )

    op.create_table(
        "session_snapshots",
        sa.Column("id", UUIDType, primary_key=True, nullable=False),
        sa.Column(
            "session_id",
            UUIDType,
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_index", sa.Integer, nullable=False),
        sa.Column("state", JSONBType, nullable=False),
        sa.Column(
            "created_at",
            TimestampType,
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "session_id", "event_index", name="uq_session_snapshots_index"
        ),
    )
    op.create_index(
        "ix_session_snapshots_session_id", "session_snapshots", ["session_id"]
    )

    op.create_table(
        "session_stats",
        sa.Column(
            "session_id",
            UUIDType,
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("files_created", sa.Integer, nullable=False, server_default="0"),
        sa.Column("files_modified", sa.Integer, nullable=False, server_default="0"),
        sa.Column("files_deleted", sa.Integer, nullable=False, server_default="0"),
        sa.Column("lines_added", sa.Integer, nullable=False, server_default="0"),
        sa.Column("lines_deleted", sa.Integer, nullable=False, server_default="0"),
        sa.Column("commands", sa.Integer, nullable=False, server_default="0"),
        sa.Column("errors", sa.Integer, nullable=False, server_default="0"),
        sa.Column("fixes", sa.Integer, nullable=False, server_default="0"),
        sa.Column("builds", sa.Integer, nullable=False, server_default="0"),
        sa.Column("duration_ms", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "updated_at",
            TimestampType,
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_table(
        "exports",
        sa.Column("id", UUIDType, primary_key=True, nullable=False),
        sa.Column(
            "session_id",
            UUIDType,
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("type", _enum("export_type", EXPORT_TYPE), nullable=False),
        sa.Column(
            "status",
            _enum("export_status", EXPORT_STATUS),
            nullable=False,
            server_default="queued",
        ),
        sa.Column("progress", sa.Float, nullable=False, server_default="0"),
        sa.Column("file_path", sa.String(1024), nullable=True),
        sa.Column("file_size", sa.BigInteger, nullable=True),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            TimestampType,
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("completed_at", TimestampType, nullable=True),
        sa.Column(
            "requested_by",
            UUIDType,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_exports_session_id", "exports", ["session_id"])

    op.create_table(
        "comments",
        sa.Column("id", UUIDType, primary_key=True, nullable=False),
        sa.Column(
            "session_id",
            UUIDType,
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "author_id",
            UUIDType,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column(
            "created_at",
            TimestampType,
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("deleted_at", TimestampType, nullable=True),
    )
    op.create_index("ix_comments_session_id", "comments", ["session_id"])
    op.create_index("ix_comments_author_id", "comments", ["author_id"])

    op.create_table(
        "session_stars",
        sa.Column(
            "session_id",
            UUIDType,
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "user_id",
            UUIDType,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "created_at",
            TimestampType,
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    op.create_table(
        "tags",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True, nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
    )
    op.create_index("ix_tags_name", "tags", ["name"], unique=True)

    op.create_table(
        "session_tags",
        sa.Column(
            "session_id",
            UUIDType,
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "tag_id",
            sa.Integer,
            sa.ForeignKey("tags.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Drop every table."""
    op.drop_table("session_tags")
    op.drop_table("tags")
    op.drop_table("session_stars")
    op.drop_table("comments")
    op.drop_table("exports")
    op.drop_table("session_stats")
    op.drop_table("session_snapshots")
    op.drop_table("session_events")
    op.drop_table("sessions")
    op.drop_table("api_keys")
    op.drop_table("users")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for name in (
            "export_status",
            "export_type",
            "session_visibility",
            "session_status",
        ):
            postgresql.ENUM(name=name).drop(bind, checkfirst=True)
