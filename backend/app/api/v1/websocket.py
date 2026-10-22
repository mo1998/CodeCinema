"""Live websocket endpoints."""

from __future__ import annotations

import asyncio
import contextlib
import uuid
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import get_settings
from app.core.db import get_database
from app.core.logging import get_logger
from app.services.stats import get_stats
from app.ws.manager import get_manager

logger = get_logger(__name__)

router = APIRouter(tags=["live"])


async def _stats_payload(session_id: uuid.UUID) -> dict[str, Any]:
    """Collect the current stats of a session (never raises)."""
    try:
        async with get_database().session() as session:
            stats = await get_stats(session, session_id)
            return {
                "session_id": str(session_id),
                "files_created": stats.files_created,
                "files_modified": stats.files_modified,
                "files_deleted": stats.files_deleted,
                "lines_added": stats.lines_added,
                "lines_deleted": stats.lines_deleted,
                "commands": stats.commands,
                "errors": stats.errors,
                "fixes": stats.fixes,
                "builds": stats.builds,
                "duration_ms": stats.duration_ms,
            }
    except Exception as exc:  # noqa: BLE001 - stats are best effort
        logger.warning("ws.stats_failed", extra={"error": str(exc)})
        return {"session_id": str(session_id)}


@router.websocket("/sessions/{session_id}/live")
async def live(websocket: WebSocket, session_id: uuid.UUID) -> None:
    """Stream events of a session as they are recorded.

    Server frames: ``{"type": "event", "event": {...}}``, ``{"type": "stats",
    "stats": {...}}`` and ``{"type": "done"}``.  Clients may send
    ``{"type": "ping"}``.
    """
    manager = get_manager()
    key = str(session_id)
    await manager.connect(key, websocket)
    interval = max(1.0, get_settings().ws_stats_interval_seconds)

    async def stats_loop() -> None:
        try:
            while True:
                await asyncio.sleep(interval)
                payload = await _stats_payload(session_id)
                await websocket.send_json({"type": "stats", "stats": payload})
        except asyncio.CancelledError:  # pragma: no cover - shutdown path
            raise
        except Exception:  # noqa: BLE001 - the socket is gone
            return

    stats_task = asyncio.create_task(stats_loop())
    try:
        await websocket.send_json({"type": "stats", "stats": await _stats_payload(session_id)})
        while True:
            message = await websocket.receive_json()
            if not isinstance(message, dict):
                continue
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
            elif message.get("type") == "close":
                break
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001 - never crash on a bad frame
        logger.debug("ws.live_error", extra={"error": str(exc)})
    finally:
        stats_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await stats_task
        await manager.disconnect(key, websocket)


@router.websocket("/sessions/{session_id}/presence")
async def presence(websocket: WebSocket, session_id: uuid.UUID) -> None:
    """Broadcast the number of viewers watching a session."""
    manager = get_manager()
    key = str(session_id)
    await manager.connect(key, websocket)

    async def broadcast_count() -> None:
        count = manager.viewer_count(key)
        await manager.broadcast_local(
            key, {"type": "presence", "viewers": count, "session_id": key}
        )

    await broadcast_count()
    try:
        while True:
            message = await websocket.receive_json()
            if not isinstance(message, dict):
                continue
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
                await broadcast_count()
            elif message.get("type") == "close":
                break
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001
        logger.debug("ws.presence_error", extra={"error": str(exc)})
    finally:
        await manager.disconnect(key, websocket)
        await broadcast_count()


__all__ = ["router"]
