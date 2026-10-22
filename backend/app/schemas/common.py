"""Shared response primitives."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Generic, TypeVar

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

T = TypeVar("T")


def _as_utc(value: datetime | None) -> datetime | None:
    """Treat naive timestamps as UTC (SQLite drops the timezone)."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


#: A datetime that is always serialised with an explicit UTC offset.
UtcDateTime = Annotated[datetime, AfterValidator(_as_utc)]


class ErrorDetail(BaseModel):
    """Body of the ``error`` envelope."""

    code: str = Field(description="Machine readable error code")
    message: str = Field(description="Human readable error message")
    details: dict[str, Any] | None = Field(default=None, description="Optional context")


class ErrorResponse(BaseModel):
    """The error envelope returned by every failing endpoint."""

    error: ErrorDetail


class CursorPage(BaseModel, Generic[T]):
    """A cursor-paginated collection."""

    model_config = ConfigDict(populate_by_name=True)

    items: list[T] = Field(default_factory=list)
    next_cursor: str | None = Field(default=None)

    @property
    def next_cursor_value(self) -> str | None:
        """The cursor value (kept for readability at call sites)."""
        return self.next_cursor


class OkResponse(BaseModel):
    """Simple acknowledgement payload."""

    ok: bool = True


__all__ = ["CursorPage", "ErrorDetail", "ErrorResponse", "OkResponse", "UtcDateTime"]
