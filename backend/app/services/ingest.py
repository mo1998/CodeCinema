"""Ingest service — raw agent transcript to stored canonical events."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.registry import get_adapter
from app.core.logging import get_logger
from app.models.session import Session, SessionStatus, SessionVisibility
from app.services.events import append_events
from app.services.sessions import create_session
from app.services.snapshots import build_snapshot

logger = get_logger(__name__)


@dataclass(frozen=True)
class IngestResult:
    """Outcome of an ingest run."""

    session_id: uuid.UUID
    agent: str
    appended: int
    duplicates: int
    session_event_count: int


async def ingest_raw(
    session: AsyncSession,
    *,
    agent: str,
    raw: str | dict[str, Any] | list[Any],
    session_id: uuid.UUID | None = None,
    title: str | None = None,
    prompt: str | None = None,
    repo_url: str | None = None,
    branch: str | None = None,
    visibility: SessionVisibility | None = None,
    owner_id: uuid.UUID | None = None,
) -> IngestResult:
    """Parse an agent transcript and store the resulting events."""
    adapter = get_adapter(agent)
    events = adapter.parse(raw, session_id=str(session_id or "pending"))

    if session_id is not None:
        record = await session.get(Session, session_id)
        if record is None or record.deleted_at is not None:
            from app.core.errors import NotFoundError

            raise NotFoundError("Session not found", code="session_not_found")
        if record.status == SessionStatus.draft:
            record.status = SessionStatus.recording
    else:
        from app.schemas.session import SessionCreate

        record = await create_session(
            session,
            SessionCreate(
                title=title or f"{adapter.display_name} session",
                prompt=prompt,
                agent=adapter.name,
                repo_url=repo_url,
                branch=branch,
                visibility=visibility or SessionVisibility.private,
            ),
            owner_id=owner_id,
        )

    result = await append_events(session, record, events)
    record.status = SessionStatus.complete
    await session.commit()

    if result.appended:
        try:
            await build_snapshot(session, record.id)
            await session.commit()
        except Exception as exc:  # noqa: BLE001 - a checkpoint is optional
            logger.warning("ingest.snapshot_failed", extra={"error": str(exc)})
            await session.rollback()

    logger.info(
        "ingest.completed",
        extra={
            "session_id": str(record.id),
            "agent": adapter.name,
            "appended": result.appended,
            "duplicates": result.duplicates,
        },
    )
    return IngestResult(
        session_id=record.id,
        agent=adapter.name,
        appended=result.appended,
        duplicates=result.duplicates,
        session_event_count=result.session_event_count,
    )


__all__ = ["IngestResult", "ingest_raw"]
