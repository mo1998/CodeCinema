"""ORM models. Importing this package registers every table on ``Base.metadata``."""

from __future__ import annotations

from app.models.base import Base, BigIntPK, JSONBType, TimestampType, UUIDType, new_uuid, utcnow
from app.models.comment import Comment
from app.models.event import SessionEvent
from app.models.export import Export, ExportStatus, ExportType
from app.models.session import (
    Session,
    SessionStatus,
    SessionVisibility,
)
from app.models.snapshot import SessionSnapshot, SessionStats
from app.models.tags import SessionTag, Tag
from app.models.user import ApiKey, SessionStar, User

__all__ = [
    "ApiKey",
    "Base",
    "BigIntPK",
    "Comment",
    "Export",
    "ExportStatus",
    "ExportType",
    "JSONBType",
    "Session",
    "SessionEvent",
    "SessionSnapshot",
    "SessionStar",
    "SessionStats",
    "SessionStatus",
    "SessionTag",
    "SessionVisibility",
    "Tag",
    "TimestampType",
    "UUIDType",
    "User",
    "new_uuid",
    "utcnow",
]
