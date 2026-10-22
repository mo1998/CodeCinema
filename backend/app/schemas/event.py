"""Event request/response schemas."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.adapters.base import EVENT_ACTIONS


class EventIn(BaseModel):
    """One canonical event as accepted by the append endpoint."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    timestamp: int = Field(ge=0, description="Milliseconds since session start")
    action: str = Field(description="One of the canonical event actions")
    seq: int | None = Field(default=None, ge=0)
    actor: str = Field(default="agent")
    id: str | None = Field(default=None, max_length=128)

    @field_validator("action")
    @classmethod
    def _known_action(cls, value: str) -> str:
        if value not in EVENT_ACTIONS:
            raise ValueError(f"unknown action '{value}'")
        return value


class EventAppendRequest(BaseModel):
    """Body of ``POST /v1/sessions/{id}/events``."""

    events: list[EventIn] = Field(default_factory=list)


class EventAppendResponse(BaseModel):
    """Result of appending events."""

    appended: int = 0
    duplicates: int = 0
    session_event_count: int = 0


class EventOut(BaseModel):
    """A stored event, flattened exactly like the canonical wire format."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    timestamp: int
    action: str
    seq: int | None = None
    actor: str = "agent"
    id: str | None = None


class EventListOut(BaseModel):
    """Cursor-paginated event listing."""

    model_config = ConfigDict(populate_by_name=True)

    items: list[EventOut] = Field(default_factory=list)
    next_cursor: str | None = None


__all__ = [
    "EventAppendRequest",
    "EventAppendResponse",
    "EventIn",
    "EventListOut",
    "EventOut",
]
