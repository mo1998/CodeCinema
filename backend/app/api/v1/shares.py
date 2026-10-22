"""Public share endpoints (no authentication)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_db_session
from app.core.logging import get_logger
from app.schemas.event import EventListOut, EventOut
from app.schemas.session import SessionOut
from app.services.events import list_events, parse_event_cursor
from app.services.sessions import count_stars
from app.services.shares import get_session_by_slug, share_url

logger = get_logger(__name__)

router = APIRouter(prefix="/shares", tags=["shares"])


@router.get("/{slug}")
async def show(
    slug: str,
    session: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    """Public metadata of a shared session."""
    record = await get_session_by_slug(session, slug)
    stars = await count_stars(session, record.id)
    return {
        "session": SessionOut(
            id=record.id,
            owner_id=record.owner_id,
            title=record.title,
            prompt=record.prompt,
            agent=record.agent,
            repo_url=record.repo_url,
            branch=record.branch,
            status=record.status,
            visibility=record.visibility,
            share_slug=record.share_slug,
            duration_ms=record.duration_ms,
            event_count=record.event_count,
            metadata=record.metadata_dict(),
            created_at=record.created_at,
            updated_at=record.updated_at,
            published_at=record.published_at,
            stars=stars,
        ).model_dump(mode="json", by_alias=True),
        "share_url": share_url(get_settings().public_url, record.share_slug or slug),
        "events_url": f"/v1/shares/{slug}/events",
        "state_url": f"/v1/sessions/{record.id}/state",
    }


@router.get("/{slug}/events", response_model=EventListOut)
async def events(
    slug: str,
    after_seq: int | None = Query(default=None, ge=0),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=2000),
    include_payload: bool = Query(default=True),
    session: AsyncSession = Depends(get_db_session),
) -> EventListOut:
    """Public event stream of a shared session."""
    record = await get_session_by_slug(session, slug)
    start = after_seq if after_seq is not None else parse_event_cursor(cursor)
    items, next_cursor = await list_events(
        session,
        record.id,
        after_seq=start,
        limit=limit,
        include_payload=include_payload,
    )
    return EventListOut(
        items=[EventOut.model_validate(item) for item in items],
        next_cursor=next_cursor,
    )


__all__ = ["router"]
