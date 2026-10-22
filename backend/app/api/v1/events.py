"""Event endpoints — append, list, stream and fold."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import enforce_write_rate_limit
from app.core.db import get_db_session
from app.core.logging import get_logger
from app.schemas.event import EventAppendRequest, EventAppendResponse, EventListOut, EventOut
from app.schemas.session import SessionStateOut
from app.services.events import (
    append_events,
    iter_events,
    list_events,
    load_events,
    parse_event_cursor,
)
from app.services.sessions import get_session_or_404
from app.services.state import fold

logger = get_logger(__name__)

router = APIRouter(prefix="/sessions", tags=["events"])


@router.post(
    "/{session_id}/events",
    response_model=EventAppendResponse,
    dependencies=[Depends(enforce_write_rate_limit)],
)
async def append(
    session_id: uuid.UUID,
    payload: EventAppendRequest,
    session: AsyncSession = Depends(get_db_session),
) -> EventAppendResponse:
    """Append events to a session (idempotent on the event ``id``)."""
    record = await get_session_or_404(session, session_id)
    result = await append_events(session, record, payload.events)
    await _broadcast_events(record.id, payload.events)
    return EventAppendResponse(
        appended=result.appended,
        duplicates=result.duplicates,
        session_event_count=result.session_event_count,
    )


async def _broadcast_events(session_id: uuid.UUID, events: list[Any]) -> None:
    """Push freshly appended events to the live websocket subscribers."""
    from app.ws.manager import get_manager

    manager = get_manager()
    if manager is None:
        return
    for event in events:
        data = event.model_dump(exclude_none=True) if hasattr(event, "model_dump") else dict(event)
        await manager.broadcast(str(session_id), {"type": "event", "event": data})


@router.get("/{session_id}/events", response_model=EventListOut)
async def index(
    session_id: uuid.UUID,
    after_seq: int | None = Query(default=None, ge=0),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=2000),
    include_payload: bool = Query(default=True),
    session: AsyncSession = Depends(get_db_session),
) -> EventListOut:
    """List the events of a session."""
    await get_session_or_404(session, session_id)
    start = after_seq if after_seq is not None else parse_event_cursor(cursor)
    events, next_cursor = await list_events(
        session,
        session_id,
        after_seq=start,
        limit=limit,
        include_payload=include_payload,
    )
    return EventListOut(
        items=[EventOut.model_validate(event) for event in events],
        next_cursor=next_cursor,
    )


@router.get("/{session_id}/events.ndjson")
async def ndjson(
    session_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
) -> StreamingResponse:
    """Stream the events of a session as newline delimited JSON."""
    await get_session_or_404(session, session_id)

    async def generate() -> AsyncIterator[str]:
        import json

        async for event in iter_events(session, session_id):
            yield json.dumps(event, separators=(",", ":"), default=str) + "\n"

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/{session_id}/state", response_model=SessionStateOut)
async def state(
    session_id: uuid.UUID,
    at: int | None = Query(default=None, ge=0),
    session: AsyncSession = Depends(get_db_session),
) -> SessionStateOut:
    """The folded session state, optionally at a point in time."""
    await get_session_or_404(session, session_id)
    events = await load_events(session, session_id, until_ms=at)
    return SessionStateOut.model_validate(fold(events, until_ms=at))


__all__ = ["router"]
