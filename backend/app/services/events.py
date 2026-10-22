"""Event service — idempotent append, cursor pagination and streaming."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Iterable, Sequence
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.base import SessionEvent as CanonicalEvent
from app.core.errors import InvalidInputError, PayloadTooLargeError
from app.core.logging import get_logger
from app.models.event import SessionEvent
from app.models.session import Session
from app.schemas.event import EventIn
from app.services.pagination import decode_cursor, encode_cursor
from app.services.stats import update_stats

logger = get_logger(__name__)

#: Anything that can be turned into a canonical event.
EventLike = EventIn | dict[str, Any] | CanonicalEvent

#: Keys stored in the ``payload`` column (everything else lives on the row).
_ROW_COLUMNS = {"timestamp", "action", "actor", "seq", "id"}

#: Heavy fields dropped when ``include_payload=false``.
_HEAVY_FIELDS = ("content", "text", "thought", "summary", "prompt")


@dataclass(frozen=True)
class AppendResult:
    """Outcome of appending events to a session."""

    appended: int
    duplicates: int
    session_event_count: int


def event_to_payload(event: EventLike) -> dict[str, Any]:
    """Split an event into its row columns and its JSON payload."""
    if isinstance(event, EventIn):
        data = event.model_dump(exclude_none=True)
    elif isinstance(event, CanonicalEvent):
        data = event.model_dump(mode="json", by_alias=True, exclude_none=True)
    else:
        data = dict(event)
    payload = {key: value for key, value in data.items() if key not in _ROW_COLUMNS}
    return payload


def row_to_event(row: SessionEvent) -> dict[str, Any]:
    """Rebuild the flat canonical event from a database row."""
    data: dict[str, Any] = dict(row.payload or {})
    data.update(
        {
            "timestamp": int(row.timestamp),
            "action": row.action,
            "actor": row.actor,
            "seq": int(row.seq),
        }
    )
    if row.event_id:
        data["id"] = row.event_id
    return data


def strip_payload(event: dict[str, Any]) -> dict[str, Any]:
    """Remove heavy fields (used by ``include_payload=false``)."""
    return {key: value for key, value in event.items() if key not in _HEAVY_FIELDS}


async def append_events(
    session: AsyncSession,
    record: Session,
    events: Sequence[EventLike],
    *,
    max_events: int = 5000,
) -> AppendResult:
    """Append events to a session, skipping ids that were already stored.

    The operation is idempotent: re-posting the same transcript never
    duplicates events.
    """
    if len(events) > max_events:
        raise PayloadTooLargeError(
            f"Too many events in one request (max {max_events})",
            details={"received": len(events), "max": max_events},
        )
    if not events:
        return AppendResult(appended=0, duplicates=0, session_event_count=record.event_count)

    prepared: list[dict[str, Any]] = []
    for event in events:
        if isinstance(event, EventIn):
            data = event.model_dump(exclude_none=True)
        elif isinstance(event, CanonicalEvent):
            data = event.model_dump(mode="json", by_alias=True, exclude_none=True)
        else:
            data = dict(event)
        action = data.get("action")
        if not isinstance(action, str) or not action:
            raise InvalidInputError("Event is missing an action", code="invalid_event")
        timestamp = data.get("timestamp")
        if not isinstance(timestamp, int):
            raise InvalidInputError("Event is missing a numeric timestamp", code="invalid_event")
        prepared.append(data)

    # Drop duplicates inside the request itself.
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for data in prepared:
        event_id = data.get("id")
        if isinstance(event_id, str) and event_id:
            if event_id in seen:
                continue
            seen.add(event_id)
        unique.append(data)

    existing_ids: set[str] = set()
    requested_ids = [
        data["id"] for data in unique if isinstance(data.get("id"), str) and data["id"]
    ]
    if requested_ids:
        rows = await session.execute(
            sa.select(SessionEvent.event_id).where(
                SessionEvent.session_id == record.id,
                SessionEvent.event_id.in_(requested_ids),
            )
        )
        existing_ids = {row[0] for row in rows if row[0]}

    fresh = [data for data in unique if data.get("id") not in existing_ids]
    duplicates = len(unique) - len(fresh)
    if not fresh:
        return AppendResult(
            appended=0, duplicates=duplicates, session_event_count=record.event_count
        )

    max_seq = await session.scalar(
        sa.select(sa.func.max(SessionEvent.seq)).where(SessionEvent.session_id == record.id)
    )
    start_seq = max(int(max_seq) + 1 if max_seq is not None else 0, int(record.event_count))

    rows_to_insert: list[SessionEvent] = []
    for offset, data in enumerate(fresh):
        rows_to_insert.append(
            SessionEvent(
                session_id=record.id,
                seq=start_seq + offset,
                timestamp=int(data.get("timestamp") or 0),
                action=str(data["action"]),
                actor=str(data.get("actor") or "agent"),
                payload=event_to_payload(data),
                event_id=data.get("id") if isinstance(data.get("id"), str) else None,
            )
        )
    session.add_all(rows_to_insert)

    record.event_count = start_seq + len(rows_to_insert)
    max_timestamp = max(int(data.get("timestamp") or 0) for data in fresh)
    record.duration_ms = max(int(record.duration_ms or 0), max_timestamp)
    record.updated_at = _utcnow()

    await session.flush()
    await update_stats(session, record, fresh)
    await session.commit()

    logger.info(
        "events.appended",
        extra={
            "session_id": str(record.id),
            "appended": len(rows_to_insert),
            "duplicates": duplicates,
        },
    )
    return AppendResult(
        appended=len(rows_to_insert),
        duplicates=duplicates,
        session_event_count=record.event_count,
    )


async def list_events(
    session: AsyncSession,
    session_id: uuid.UUID,
    *,
    after_seq: int | None = None,
    limit: int = 500,
    include_payload: bool = True,
) -> tuple[list[dict[str, Any]], str | None]:
    """Return a page of events and the cursor for the next page."""
    limit = max(1, min(int(limit), 2000))
    statement = sa.select(SessionEvent).where(SessionEvent.session_id == session_id)
    if after_seq is not None:
        statement = statement.where(SessionEvent.seq > after_seq)
    statement = statement.order_by(SessionEvent.seq.asc()).limit(limit + 1)
    rows = (await session.execute(statement)).scalars().all()

    has_more = len(rows) > limit
    page = rows[:limit]
    events = [row_to_event(row) for row in page]
    if not include_payload:
        events = [strip_payload(event) for event in events]
    next_cursor: str | None = None
    if has_more and page:
        next_cursor = encode_cursor({"seq": int(page[-1].seq)})
    return events, next_cursor


async def iter_events(
    session: AsyncSession,
    session_id: uuid.UUID,
    *,
    batch_size: int = 500,
) -> AsyncIterator[dict[str, Any]]:
    """Stream every event of a session in order."""
    after_seq: int | None = None
    while True:
        page, _cursor = await list_events(
            session, session_id, after_seq=after_seq, limit=batch_size
        )
        if not page:
            return
        for event in page:
            yield event
        after_seq = int(page[-1]["seq"])
        if len(page) < batch_size:
            return


async def load_events(
    session: AsyncSession,
    session_id: uuid.UUID,
    *,
    until_ms: int | None = None,
) -> list[dict[str, Any]]:
    """Load all events (optionally only those up to ``until_ms``)."""
    statement = sa.select(SessionEvent).where(SessionEvent.session_id == session_id)
    if until_ms is not None:
        statement = statement.where(SessionEvent.timestamp <= until_ms)
    statement = statement.order_by(SessionEvent.seq.asc())
    rows = (await session.execute(statement)).scalars().all()
    return [row_to_event(row) for row in rows]


def parse_event_cursor(cursor: str | None) -> int | None:
    """Decode an event cursor into an ``after_seq`` value."""
    payload = decode_cursor(cursor)
    if not payload:
        return None
    seq = payload.get("seq")
    if isinstance(seq, int):
        return seq
    return None


def normalise_events(events: Iterable[EventIn | dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalise a mixed list of events into plain dicts."""
    result: list[dict[str, Any]] = []
    for event in events:
        if isinstance(event, EventIn):
            result.append(event.model_dump(exclude_none=True))
        else:
            result.append(dict(event))
    return result


def _utcnow():
    from datetime import UTC, datetime

    return datetime.now(UTC)


__all__ = [
    "AppendResult",
    "append_events",
    "event_to_payload",
    "iter_events",
    "list_events",
    "load_events",
    "normalise_events",
    "parse_event_cursor",
    "row_to_event",
    "strip_payload",
]
