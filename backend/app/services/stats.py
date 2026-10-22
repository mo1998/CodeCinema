"""Incremental session statistics."""

from __future__ import annotations

import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.session import Session
from app.models.snapshot import SessionSnapshot, SessionStats

logger = get_logger(__name__)


async def get_stats(session: AsyncSession, session_id: uuid.UUID) -> SessionStats:
    """Return (creating if needed) the stats row of a session."""
    stats = await session.get(SessionStats, session_id)
    if stats is None:
        stats = SessionStats(session_id=session_id)
        session.add(stats)
        await session.flush()
    return stats


async def update_stats(
    session: AsyncSession,
    record: Session,
    events: list[dict[str, Any]],
) -> SessionStats:
    """Apply the deltas of ``events`` to the session statistics."""
    stats = await get_stats(session, record.id)
    texts = await _load_file_texts(session, record.id)

    for event in events:
        action = str(event.get("action") or "")
        if action == "file.create":
            path = str(event.get("file") or "")
            stats.files_created += 1
            texts[path] = event.get("content") or ""
        elif action == "file.delete":
            path = str(event.get("file") or "")
            stats.files_deleted += 1
            texts.pop(path, None)
        elif action == "file.rename":
            source = str(event.get("file") or "")
            target = str(event.get("to") or "")
            if source in texts:
                texts[target] = texts.pop(source)
        elif action in {"type", "insert"}:
            path = str(event.get("file") or "")
            text = texts.get(path, "")
            content = event.get("content") or ""
            offset = event.get("offset")
            offset = offset if isinstance(offset, int) else len(text)
            stats.lines_added += content.count("\n")
            texts[path] = _splice(text, offset, 0, content)
            stats.files_modified += 1
        elif action == "replace":
            path = str(event.get("file") or "")
            text = texts.get(path, "")
            offset = int(event.get("offset") or 0)
            count = max(0, int(event.get("count") or 0))
            content = event.get("content") or ""
            removed = text[offset : offset + count]
            stats.lines_deleted += removed.count("\n")
            stats.lines_added += content.count("\n")
            texts[path] = _splice(text, offset, count, content)
            stats.files_modified += 1
        elif action == "delete":
            path = str(event.get("file") or "")
            text = texts.get(path, "")
            offset = event.get("offset")
            count = max(0, int(event.get("count") or 0))
            if not isinstance(offset, int):
                offset = max(0, len(text) - count)
            removed = text[offset : offset + count]
            stats.lines_deleted += removed.count("\n")
            texts[path] = _splice(text, offset, count, "")
            stats.files_modified += 1
        elif action in {"terminal", "terminal.command"}:
            stats.commands += 1
        elif action == "error":
            stats.errors += 1
        elif action == "fix":
            stats.fixes += 1
        elif action == "build.start":
            stats.builds += 1

    duration = int(record.duration_ms or 0)
    stats.duration_ms = max(int(stats.duration_ms or 0), duration)
    session.add(stats)
    return stats


async def _load_file_texts(session: AsyncSession, session_id: uuid.UUID) -> dict[str, str]:
    """Rebuild the per-file text map from the newest snapshot."""
    state = await session.scalar(
        sa.select(SessionSnapshot.state)
        .where(SessionSnapshot.session_id == session_id)
        .order_by(SessionSnapshot.event_index.desc())
        .limit(1)
    )
    if not isinstance(state, dict):
        return {}
    texts: dict[str, str] = {}
    for entry in state.get("files") or []:
        if isinstance(entry, dict):
            path = entry.get("path")
            if isinstance(path, str):
                texts[path] = entry.get("text") or ""
    return texts


def _splice(text: str, offset: int, count: int, insert: str) -> str:
    offset = max(0, min(offset, len(text)))
    end = min(len(text), offset + max(0, count))
    return text[:offset] + insert + text[end:]


__all__ = ["get_stats", "update_stats"]
