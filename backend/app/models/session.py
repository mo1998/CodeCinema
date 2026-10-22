"""Session model — the aggregate root of a recorded coding session."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, JSONBType, TimestampType, UUIDType, new_uuid, utcnow


class SessionStatus(enum.StrEnum):
    """Lifecycle of a recorded session."""

    draft = "draft"
    recording = "recording"
    complete = "complete"
    failed = "failed"


class SessionVisibility(enum.StrEnum):
    """Who may see a session."""

    private = "private"
    unlisted = "unlisted"
    public = "public"


def _enum_values(enum_cls: type[enum.Enum]) -> list[str]:
    return [member.value for member in enum_cls]


SessionStatusEnum = sa.Enum(
    SessionStatus,
    name="session_status",
    values_callable=_enum_values,
)
SessionVisibilityEnum = sa.Enum(
    SessionVisibility,
    name="session_visibility",
    values_callable=_enum_values,
)


class Session(Base):
    """A recorded agent session."""

    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=new_uuid)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(sa.String(255), nullable=False, default="Untitled session")
    prompt: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    agent: Mapped[str] = mapped_column(sa.String(64), nullable=False, default="unknown")
    repo_url: Mapped[str | None] = mapped_column(sa.String(1024), nullable=True)
    branch: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    status: Mapped[SessionStatus] = mapped_column(
        SessionStatusEnum, nullable=False, default=SessionStatus.draft
    )
    visibility: Mapped[SessionVisibility] = mapped_column(
        SessionVisibilityEnum, nullable=False, default=SessionVisibility.private
    )
    share_slug: Mapped[str | None] = mapped_column(
        sa.String(32), nullable=True, unique=True, index=True
    )
    duration_ms: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    event_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    # ``metadata`` is reserved by SQLAlchemy's declarative API, so the Python
    # attribute is named ``metadata_json`` while the column keeps its name.
    metadata_json: Mapped[dict] = mapped_column(
        "metadata", JSONBType, nullable=False, default=dict, server_default=sa.text("'{}'")
    )
    created_at: Mapped[datetime] = mapped_column(
        TimestampType, nullable=False, default=utcnow, server_default=sa.func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        TimestampType,
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
        server_default=sa.func.now(),
    )
    published_at: Mapped[datetime | None] = mapped_column(TimestampType, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(TimestampType, nullable=True, index=True)

    def is_public(self) -> bool:
        """True when the session is reachable through its share slug."""
        return self.visibility == SessionVisibility.public and self.share_slug is not None

    def metadata_dict(self) -> dict:
        """The session metadata as a plain dict."""
        return dict(self.metadata_json or {})


__all__ = [
    "Session",
    "SessionStatus",
    "SessionStatusEnum",
    "SessionVisibility",
    "SessionVisibilityEnum",
]
