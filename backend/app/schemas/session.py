"""Session request/response schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.session import SessionStatus, SessionVisibility
from app.schemas.common import CursorPage, UtcDateTime


class SessionCreate(BaseModel):
    """Payload for ``POST /v1/sessions``."""

    model_config = ConfigDict(populate_by_name=True)

    title: str | None = Field(default=None, max_length=255)
    prompt: str | None = None
    agent: str = Field(default="unknown", max_length=64)
    repo_url: str | None = Field(default=None, max_length=1024)
    branch: str | None = Field(default=None, max_length=255)
    visibility: SessionVisibility = SessionVisibility.private
    metadata: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)

    @field_validator("title")
    @classmethod
    def _strip_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class SessionUpdate(BaseModel):
    """Payload for ``PATCH /v1/sessions/{id}``."""

    model_config = ConfigDict(populate_by_name=True)

    title: str | None = Field(default=None, max_length=255)
    visibility: SessionVisibility | None = None
    metadata: dict[str, Any] | None = None
    repo_url: str | None = Field(default=None, max_length=1024)
    branch: str | None = Field(default=None, max_length=255)
    status: SessionStatus | None = None
    tags: list[str] | None = None


class SessionOut(BaseModel):
    """Public representation of a session."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    owner_id: uuid.UUID | None = None
    title: str
    prompt: str | None = None
    agent: str
    repo_url: str | None = None
    branch: str | None = None
    status: SessionStatus
    visibility: SessionVisibility
    share_slug: str | None = None
    duration_ms: int = 0
    event_count: int = 0
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        validation_alias="metadata_json",
        serialization_alias="metadata",
    )
    created_at: UtcDateTime
    updated_at: UtcDateTime
    published_at: UtcDateTime | None = None
    stars: int = 0


class SessionList(CursorPage[SessionOut]):
    """Paginated session listing."""


class SessionStatsOut(BaseModel):
    """Aggregate counters for a session."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    session_id: uuid.UUID
    files_created: int = 0
    files_modified: int = 0
    files_deleted: int = 0
    lines_added: int = 0
    lines_deleted: int = 0
    commands: int = 0
    errors: int = 0
    fixes: int = 0
    builds: int = 0
    duration_ms: int = 0


class SessionStateOut(BaseModel):
    """Folded session state (shape mirrors the frontend reducer)."""

    model_config = ConfigDict(extra="allow")

    files: list[dict[str, Any]] = Field(default_factory=list)
    fileOrder: list[str] = Field(default_factory=list)
    tabs: list[str] = Field(default_factory=list)
    activeFile: str | None = None
    terminal: dict[str, Any] = Field(default_factory=dict)
    narration: list[dict[str, Any]] = Field(default_factory=list)
    timeline: list[dict[str, Any]] = Field(default_factory=list)
    dependencies: list[dict[str, Any]] = Field(default_factory=list)
    build: dict[str, Any] = Field(default_factory=dict)
    errors: list[dict[str, Any]] = Field(default_factory=list)
    fixes: list[dict[str, Any]] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)
    consumedEvents: int = 0
    touchedFiles: list[str] = Field(default_factory=list)


class PublishOut(BaseModel):
    """Result of publishing a session."""

    model_config = ConfigDict(populate_by_name=True)

    id: uuid.UUID
    visibility: SessionVisibility
    share_slug: str
    share_url: str
    published_at: UtcDateTime | None = None


__all__ = [
    "PublishOut",
    "SessionCreate",
    "SessionList",
    "SessionOut",
    "SessionStateOut",
    "SessionStatsOut",
    "SessionUpdate",
]
