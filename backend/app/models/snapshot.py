"""Snapshot (checkpoint) and aggregate stats models."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, JSONBType, TimestampType, UUIDType, new_uuid, utcnow


class SessionSnapshot(Base):
    """A checkpoint of the folded session state at a given event index."""

    __tablename__ = "session_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=new_uuid)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_index: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    state: Mapped[dict[str, Any]] = mapped_column(JSONBType, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        TimestampType, nullable=False, default=utcnow, server_default=sa.func.now()
    )

    __table_args__ = (
        sa.UniqueConstraint("session_id", "event_index", name="uq_session_snapshots_index"),
    )


class SessionStats(Base):
    """Incrementally maintained counters for a session."""

    __tablename__ = "session_stats"

    session_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, sa.ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True
    )
    files_created: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    files_modified: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    files_deleted: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    lines_added: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    lines_deleted: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    commands: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    errors: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    fixes: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    builds: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    duration_ms: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        TimestampType,
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
        server_default=sa.func.now(),
    )


__all__ = ["SessionSnapshot", "SessionStats"]
