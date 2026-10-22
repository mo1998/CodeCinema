"""Tag models."""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDType


class Tag(Base):
    """A reusable label."""

    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(sa.Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(sa.String(64), nullable=False, unique=True, index=True)


class SessionTag(Base):
    """Association between a session and a tag."""

    __tablename__ = "session_tags"

    session_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, sa.ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[int] = mapped_column(
        sa.Integer, sa.ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True
    )


__all__ = ["SessionTag", "Tag"]
