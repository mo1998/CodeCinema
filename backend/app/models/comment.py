"""Comment model."""

from __future__ import annotations

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampType, UUIDType, new_uuid, utcnow


class Comment(Base):
    """A comment on a session (soft deletable)."""

    __tablename__ = "comments"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=new_uuid)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    body: Mapped[str] = mapped_column(sa.Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TimestampType, nullable=False, default=utcnow, server_default=sa.func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(TimestampType, nullable=True)


__all__ = ["Comment"]
