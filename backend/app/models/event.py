"""Append-only event store."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, BigIntPK, JSONBType, TimestampType, UUIDType, utcnow


class SessionEvent(Base):
    """One canonical event of a session.

    This table is **append-only**: it is the event-sourcing source of truth.
    Rows are never updated or deleted (a soft-deleted session keeps its
    events).  ``seq`` is a per-session monotonic sequence number and
    ``event_id`` is the idempotency key used when re-ingesting a transcript.
    """

    __tablename__ = "session_events"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    seq: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    timestamp: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    action: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    actor: Mapped[str] = mapped_column(sa.String(16), nullable=False, default="agent")
    payload: Mapped[dict[str, Any]] = mapped_column(
        JSONBType, nullable=False, default=dict, server_default=sa.text("'{}'")
    )
    event_id: Mapped[str | None] = mapped_column(sa.String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TimestampType, nullable=False, default=utcnow, server_default=sa.func.now()
    )

    __table_args__ = (
        sa.UniqueConstraint("session_id", "seq", name="uq_session_events_session_seq"),
        sa.Index(
            "ix_session_events_session_ts_seq",
            "session_id",
            "timestamp",
            "seq",
        ),
        # Idempotency: the same event id may only be stored once per session.
        sa.Index(
            "uq_session_events_event_id",
            "session_id",
            "event_id",
            unique=True,
            sqlite_where=sa.text("event_id IS NOT NULL"),
            postgresql_where=sa.text("event_id IS NOT NULL"),
        ),
    )


__all__ = ["SessionEvent"]
