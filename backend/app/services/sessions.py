"""Session service — create, list, patch, delete and publish sessions."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InvalidInputError, NotFoundError
from app.core.logging import get_logger
from app.models.session import Session, SessionStatus, SessionVisibility
from app.models.tags import SessionTag, Tag
from app.models.user import SessionStar
from app.schemas.session import SessionCreate, SessionUpdate
from app.services.pagination import (
    decode_cursor,
    decode_datetime,
    decode_uuid,
    encode_cursor,
)
from app.services.shares import generate_slug

logger = get_logger(__name__)

SORT_ORDERS = ("newest", "oldest", "popular")


def _star_count_expression():
    return (
        sa.select(sa.func.count())
        .select_from(SessionStar)
        .where(SessionStar.session_id == Session.id)
        .scalar_subquery()
    )


async def create_session(
    session: AsyncSession,
    payload: SessionCreate,
    *,
    owner_id: uuid.UUID | None = None,
) -> Session:
    """Create a new (draft) session."""
    title = payload.title or "Untitled session"
    record = Session(
        owner_id=owner_id,
        title=title,
        prompt=payload.prompt,
        agent=payload.agent or "unknown",
        repo_url=payload.repo_url,
        branch=payload.branch,
        status=SessionStatus.draft,
        visibility=payload.visibility or SessionVisibility.private,
        metadata_json=dict(payload.metadata or {}),
    )
    session.add(record)
    await session.flush()
    if payload.tags:
        await attach_tags(session, record, payload.tags)
    await session.commit()
    await session.refresh(record)
    return record


async def get_session_or_404(
    session: AsyncSession,
    session_id: uuid.UUID,
    *,
    include_deleted: bool = False,
) -> Session:
    """Fetch a session or raise :class:`NotFoundError`."""
    record = await session.get(Session, session_id)
    if record is None or (record.deleted_at is not None and not include_deleted):
        raise NotFoundError("Session not found", code="session_not_found")
    return record


async def list_sessions(
    session: AsyncSession,
    *,
    cursor: str | None = None,
    limit: int = 40,
    query: str | None = None,
    agent: str | None = None,
    tag: str | None = None,
    sort: str = "newest",
) -> tuple[list[Session], str | None, dict[uuid.UUID, int]]:
    """List sessions with keyset pagination.

    Returns ``(items, next_cursor, star_counts)``.
    """
    if sort not in SORT_ORDERS:
        raise InvalidInputError(
            f"Unknown sort '{sort}'", code="invalid_sort", details={"allowed": list(SORT_ORDERS)}
        )
    limit = max(1, min(int(limit), 200))

    star_expr = _star_count_expression()
    statement = sa.select(Session, star_expr.label("star_count")).where(
        Session.deleted_at.is_(None)
    )

    if query:
        pattern = f"%{query.strip()}%"
        statement = statement.where(
            sa.or_(Session.title.ilike(pattern), Session.prompt.ilike(pattern))
        )
    if agent:
        statement = statement.where(Session.agent == agent)
    if tag:
        statement = statement.where(
            sa.exists(
                sa.select(SessionTag.session_id).where(
                    SessionTag.session_id == Session.id,
                    SessionTag.tag_id.in_(sa.select(Tag.id).where(Tag.name == tag)),
                )
            )
        )

    payload = decode_cursor(cursor)
    if payload:
        cursor_id = decode_uuid(payload)
        created = decode_datetime(payload)
        if cursor_id is None or created is None:
            return [], None, {}
        try:
            cursor_uuid = uuid.UUID(str(cursor_id))
        except (TypeError, ValueError):
            return [], None, {}
        if sort == "popular":
            stars = int(payload.get("s") or 0)
            statement = statement.where(
                sa.or_(
                    star_expr < stars,
                    sa.and_(star_expr == stars, Session.created_at < created),
                    sa.and_(
                        star_expr == stars,
                        Session.created_at == created,
                        Session.id < cursor_uuid,
                    ),
                )
            )
        elif sort == "oldest":
            statement = statement.where(
                sa.or_(
                    Session.created_at > created,
                    sa.and_(Session.created_at == created, Session.id > cursor_uuid),
                )
            )
        else:
            statement = statement.where(
                sa.or_(
                    Session.created_at < created,
                    sa.and_(Session.created_at == created, Session.id < cursor_uuid),
                )
            )

    if sort == "popular":
        statement = statement.order_by(
            star_expr.desc(), Session.created_at.desc(), Session.id.desc()
        )
    elif sort == "oldest":
        statement = statement.order_by(Session.created_at.asc(), Session.id.asc())
    else:
        statement = statement.order_by(Session.created_at.desc(), Session.id.desc())

    statement = statement.limit(limit + 1)
    rows = (await session.execute(statement)).all()

    star_counts = {row[0].id: int(row[1] or 0) for row in rows}
    has_more = len(rows) > limit
    items = [row[0] for row in rows[:limit]]

    next_cursor: str | None = None
    if has_more and items:
        last = items[-1]
        payload_out: dict[str, Any] = {
            "id": str(last.id),
            "t": last.created_at.isoformat(),
        }
        if sort == "popular":
            payload_out["s"] = star_counts.get(last.id, 0)
        next_cursor = encode_cursor(payload_out)
    return items, next_cursor, star_counts


async def update_session(session: AsyncSession, record: Session, payload: SessionUpdate) -> Session:
    """Apply a partial update to a session."""
    data = payload.model_dump(exclude_unset=True, exclude_none=True)
    if "title" in data:
        record.title = data["title"].strip() or record.title
    if "visibility" in data:
        record.visibility = data["visibility"]
    if "metadata" in data:
        record.metadata_json = dict(data["metadata"] or {})
    if "repo_url" in data:
        record.repo_url = data["repo_url"]
    if "branch" in data:
        record.branch = data["branch"]
    if "status" in data:
        record.status = data["status"]
    if "tags" in data:
        await attach_tags(session, record, list(data["tags"]))
    record.updated_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(record)
    return record


async def soft_delete_session(session: AsyncSession, record: Session) -> None:
    """Soft delete a session (events are preserved)."""
    record.deleted_at = datetime.now(UTC)
    record.updated_at = datetime.now(UTC)
    await session.commit()


async def publish_session(session: AsyncSession, record: Session) -> Session:
    """Publish a session: make it public and allocate a share slug."""
    if record.share_slug is None:
        record.share_slug = await _unique_slug(session)
    record.visibility = SessionVisibility.public
    record.published_at = record.published_at or datetime.now(UTC)
    record.updated_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(record)
    return record


async def _unique_slug(session: AsyncSession) -> str:
    for _ in range(12):
        slug = generate_slug()
        exists = await session.scalar(
            sa.select(Session.id).where(Session.share_slug == slug).limit(1)
        )
        if exists is None:
            return slug
    raise InvalidInputError("Could not allocate a share slug", code="slug_exhausted")


async def attach_tags(session: AsyncSession, record: Session, names: list[str]) -> None:
    """Attach tags to a session, creating missing ones."""
    cleaned = [name.strip().lower()[:64] for name in names if name and name.strip()]
    if not cleaned:
        return
    existing = (await session.execute(sa.select(Tag).where(Tag.name.in_(cleaned)))).scalars().all()
    by_name = {tag.name: tag for tag in existing}
    for name in cleaned:
        if name not in by_name:
            tag = Tag(name=name)
            session.add(tag)
            await session.flush()
            by_name[name] = tag
    current = (
        (await session.execute(sa.select(SessionTag).where(SessionTag.session_id == record.id)))
        .scalars()
        .all()
    )
    existing_tag_ids = {link.tag_id for link in current}
    for name in cleaned:
        tag = by_name[name]
        if tag.id not in existing_tag_ids:
            session.add(SessionTag(session_id=record.id, tag_id=tag.id))


async def star_session(session: AsyncSession, record: Session, user_id: uuid.UUID) -> int:
    """Add a star and return the new star count."""
    existing = await session.get(SessionStar, (record.id, user_id))
    if existing is None:
        session.add(SessionStar(session_id=record.id, user_id=user_id))
        await session.commit()
    return await count_stars(session, record.id)


async def unstar_session(session: AsyncSession, record: Session, user_id: uuid.UUID) -> int:
    """Remove a star and return the new star count."""
    existing = await session.get(SessionStar, (record.id, user_id))
    if existing is not None:
        await session.delete(existing)
        await session.commit()
    return await count_stars(session, record.id)


async def count_stars(session: AsyncSession, session_id: uuid.UUID) -> int:
    """Number of stars for a session."""
    return int(
        await session.scalar(
            sa.select(sa.func.count())
            .select_from(SessionStar)
            .where(SessionStar.session_id == session_id)
        )
        or 0
    )


__all__ = [
    "SORT_ORDERS",
    "attach_tags",
    "count_stars",
    "create_session",
    "get_session_or_404",
    "list_sessions",
    "publish_session",
    "soft_delete_session",
    "star_session",
    "unstar_session",
    "update_session",
]
