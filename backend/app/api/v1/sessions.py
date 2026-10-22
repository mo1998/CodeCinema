"""Session endpoints."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import enforce_write_rate_limit, get_principal
from app.core.config import get_settings
from app.core.db import get_db_session
from app.core.errors import NotFoundError
from app.core.security import Principal
from app.models.session import Session
from app.schemas.comment import StarResponse
from app.schemas.session import (
    PublishOut,
    SessionCreate,
    SessionList,
    SessionOut,
    SessionStatsOut,
    SessionUpdate,
)
from app.services.sessions import (
    count_stars,
    create_session,
    get_session_or_404,
    list_sessions,
    publish_session,
    soft_delete_session,
    star_session,
    unstar_session,
    update_session,
)
from app.services.shares import share_url
from app.services.stats import get_stats

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _to_out(record: Session, stars: int = 0) -> SessionOut:
    return SessionOut(
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
    )


@router.post(
    "",
    response_model=SessionOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(enforce_write_rate_limit)],
)
async def create(
    payload: SessionCreate,
    session: AsyncSession = Depends(get_db_session),
    principal: Principal = Depends(get_principal),
) -> SessionOut:
    """Create a session."""
    record = await create_session(session, payload, owner_id=principal.user_id)
    return _to_out(record)


@router.get("", response_model=SessionList)
async def index(
    cursor: str | None = Query(default=None),
    limit: int = Query(default=40, ge=1, le=200),
    q: str | None = Query(default=None),
    agent: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    sort: str = Query(default="newest"),
    session: AsyncSession = Depends(get_db_session),
) -> SessionList:
    """List sessions with cursor pagination."""
    items, next_cursor, stars = await list_sessions(
        session,
        cursor=cursor,
        limit=limit,
        query=q,
        agent=agent,
        tag=tag,
        sort=sort,
    )
    return SessionList(
        items=[_to_out(item, stars.get(item.id, 0)) for item in items],
        next_cursor=next_cursor,
    )


@router.get("/{session_id}", response_model=SessionOut)
async def show(
    session_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
) -> SessionOut:
    """Fetch session metadata."""
    record = await get_session_or_404(session, session_id)
    stars = await count_stars(session, record.id)
    return _to_out(record, stars)


@router.patch(
    "/{session_id}",
    response_model=SessionOut,
    dependencies=[Depends(enforce_write_rate_limit)],
)
async def patch(
    session_id: uuid.UUID,
    payload: SessionUpdate,
    session: AsyncSession = Depends(get_db_session),
) -> SessionOut:
    """Update title, visibility or metadata."""
    record = await get_session_or_404(session, session_id)
    updated = await update_session(session, record, payload)
    stars = await count_stars(session, updated.id)
    return _to_out(updated, stars)


@router.delete(
    "/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(enforce_write_rate_limit)],
)
async def remove(
    session_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
) -> Response:
    """Soft delete a session."""
    record = await get_session_or_404(session, session_id)
    await soft_delete_session(session, record)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{session_id}/publish",
    response_model=PublishOut,
    dependencies=[Depends(enforce_write_rate_limit)],
)
async def publish(
    session_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
) -> PublishOut:
    """Publish a session and allocate its share slug."""
    record = await get_session_or_404(session, session_id)
    published = await publish_session(session, record)
    if published.share_slug is None:  # pragma: no cover - defensive
        raise NotFoundError("Share slug missing", code="share_not_found")
    return PublishOut(
        id=published.id,
        visibility=published.visibility,
        share_slug=published.share_slug,
        share_url=share_url(get_settings().public_url, published.share_slug),
        published_at=published.published_at,
    )


@router.get("/{session_id}/stats", response_model=SessionStatsOut)
async def stats(
    session_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
) -> SessionStatsOut:
    """Aggregate counters for a session."""
    await get_session_or_404(session, session_id)
    record = await get_stats(session, session_id)
    return SessionStatsOut(
        session_id=record.session_id,
        files_created=record.files_created,
        files_modified=record.files_modified,
        files_deleted=record.files_deleted,
        lines_added=record.lines_added,
        lines_deleted=record.lines_deleted,
        commands=record.commands,
        errors=record.errors,
        fixes=record.fixes,
        builds=record.builds,
        duration_ms=record.duration_ms,
    )


@router.post(
    "/{session_id}/star",
    response_model=StarResponse,
    dependencies=[Depends(enforce_write_rate_limit)],
)
async def star(
    session_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    principal: Principal = Depends(get_principal),
) -> StarResponse:
    """Star a session (requires an authenticated caller)."""
    if principal.user_id is None:
        from app.core.errors import UnauthorizedError

        raise UnauthorizedError("Authentication required to star a session")
    record = await get_session_or_404(session, session_id)
    total = await star_session(session, record, principal.user_id)
    return StarResponse(session_id=record.id, stars=total, starred=True)


@router.delete(
    "/{session_id}/star",
    response_model=StarResponse,
    dependencies=[Depends(enforce_write_rate_limit)],
)
async def unstar(
    session_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
    principal: Principal = Depends(get_principal),
) -> StarResponse:
    """Remove a star (requires an authenticated caller)."""
    if principal.user_id is None:
        from app.core.errors import UnauthorizedError

        raise UnauthorizedError("Authentication required to star a session")
    record = await get_session_or_404(session, session_id)
    total = await unstar_session(session, record, principal.user_id)
    return StarResponse(session_id=record.id, stars=total, starred=False)


@router.get("/{session_id}/stars", response_model=StarResponse)
async def stars(
    session_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
) -> Any:
    """Number of stars for a session."""
    await get_session_or_404(session, session_id)
    total = await count_stars(session, session_id)
    return StarResponse(session_id=session_id, stars=total, starred=False)


__all__ = ["router"]
