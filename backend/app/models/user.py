"""User, API-key and star models."""

from __future__ import annotations

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, JSONBType, TimestampType, UUIDType, new_uuid, utcnow


class User(Base):
    """A registered user."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=new_uuid)
    email: Mapped[str] = mapped_column(sa.String(320), nullable=False, unique=True, index=True)
    display_name: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TimestampType, nullable=False, default=utcnow, server_default=sa.func.now()
    )

    api_keys: Mapped[list[ApiKey]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )


class ApiKey(Base):
    """A hashed API key belonging to a user."""

    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(120), nullable=False, default="default")
    key_hash: Mapped[str] = mapped_column(sa.String(255), nullable=False, unique=True)
    key_prefix: Mapped[str] = mapped_column(sa.String(32), nullable=False, unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        TimestampType, nullable=False, default=utcnow, server_default=sa.func.now()
    )
    last_used_at: Mapped[datetime | None] = mapped_column(TimestampType, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(TimestampType, nullable=True)

    user: Mapped[User] = relationship(back_populates="api_keys")


class SessionStar(Base):
    """A star on a session (one per user and session)."""

    __tablename__ = "session_stars"

    session_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, sa.ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        TimestampType, nullable=False, default=utcnow, server_default=sa.func.now()
    )


__all__ = ["ApiKey", "JSONBType", "SessionStar", "User"]
