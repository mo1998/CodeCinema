"""Snapshot (checkpoint) service."""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.snapshot import SessionSnapshot
from app.services.events import load_events
from app.services.state import fold


async def build_snapshot(
    session: AsyncSession,
    session_id: uuid.UUID,
    *,
    event_index: int | None = None,
    events: list[dict] | None = None,
) -> SessionSnapshot:
    """Fold the session events and persist the resulting checkpoint."""
    if events is None:
        events = await load_events(session, session_id)
    if event_index is None:
        event_index = max(0, len(events) - 1)
    state = fold(events)
    snapshot = SessionSnapshot(
        session_id=session_id,
        event_index=int(event_index),
        state=state,
    )
    session.add(snapshot)
    await session.flush()
    return snapshot


async def get_latest_snapshot(
    session: AsyncSession, session_id: uuid.UUID
) -> SessionSnapshot | None:
    """Return the newest checkpoint of a session."""
    return await session.scalar(
        sa.select(SessionSnapshot)
        .where(SessionSnapshot.session_id == session_id)
        .order_by(SessionSnapshot.event_index.desc())
        .limit(1)
    )


async def prune_snapshots(session: AsyncSession, session_id: uuid.UUID, keep: int = 20) -> None:
    """Keep only the newest ``keep`` checkpoints."""
    ids = (
        (
            await session.execute(
                sa.select(SessionSnapshot.id)
                .where(SessionSnapshot.session_id == session_id)
                .order_by(SessionSnapshot.event_index.desc())
                .offset(keep)
            )
        )
        .scalars()
        .all()
    )
    for snapshot_id in ids:
        snapshot = await session.get(SessionSnapshot, snapshot_id)
        if snapshot is not None:
            await session.delete(snapshot)


__all__ = ["build_snapshot", "get_latest_snapshot", "prune_snapshots"]
