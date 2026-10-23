"""Comment, star and ingest schemas."""

from __future__ import annotations

import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import UtcDateTime


class CommentCreate(BaseModel):
    """Body of ``POST /v1/sessions/{id}/comments``."""

    body: str = Field(min_length=1, max_length=10_000)

    @field_validator("body")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("comment body must not be blank")
        return stripped


class CommentOut(BaseModel):
    """A comment on a session."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    session_id: uuid.UUID
    author_id: uuid.UUID | None = None
    body: str
    created_at: UtcDateTime


class StarResponse(BaseModel):
    """Result of starring / unstarring a session."""

    session_id: uuid.UUID
    stars: int
    starred: bool


class IngestRequest(BaseModel):
    """Body of ``POST /v1/ingest/{agent}``."""

    model_config = ConfigDict(populate_by_name=True)

    session_id: uuid.UUID | None = None
    raw: Any = Field(description="Raw agent transcript (string, object or list)")
    format: str | None = Field(default=None, description="Optional format hint")
    title: str | None = None
    prompt: str | None = None
    repo_url: str | None = None
    branch: str | None = None
    visibility: str | None = None


class IngestResponse(BaseModel):
    """Result of an ingest run."""

    model_config = ConfigDict(populate_by_name=True)

    session_id: uuid.UUID
    agent: str
    appended: int
    duplicates: int
    session_event_count: int


__all__ = [
    "CommentCreate",
    "CommentOut",
    "IngestRequest",
    "IngestResponse",
    "StarResponse",
]
