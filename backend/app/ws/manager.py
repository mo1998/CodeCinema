"""Websocket connection management."""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

from fastapi import WebSocket

from app.core.logging import get_logger
from app.core.redis import RedisManager

logger = get_logger(__name__)

CHANNEL_PREFIX = "codecinema:session:"


class ConnectionManager:
    """Tracks websocket connections per session and fans out messages.

    Messages published locally are also published to Redis so that every API
    worker connected to the same session receives them.
    """

    def __init__(self, redis: RedisManager | None = None) -> None:
        self._local: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()
        self._redis = redis
        self._instance_id = uuid.uuid4().hex
        self._listener_task: asyncio.Task[None] | None = None
        self._pubsub: Any = None

    # -- connections -------------------------------------------------------

    async def connect(self, session_id: str, websocket: WebSocket) -> None:
        """Accept a websocket and register it for the session."""
        await websocket.accept()
        async with self._lock:
            self._local.setdefault(session_id, set()).add(websocket)

    async def disconnect(self, session_id: str, websocket: WebSocket) -> None:
        """Unregister a websocket."""
        async with self._lock:
            connections = self._local.get(session_id)
            if connections is not None:
                connections.discard(websocket)
                if not connections:
                    self._local.pop(session_id, None)

    def viewer_count(self, session_id: str) -> int:
        """Number of websockets watching a session."""
        return len(self._local.get(session_id, ()))

    def sessions(self) -> list[str]:
        """Sessions with at least one live connection."""
        return list(self._local.keys())

    # -- broadcasting ------------------------------------------------------

    async def broadcast(self, session_id: str, message: dict[str, Any]) -> None:
        """Send a message to local listeners and publish it to Redis."""
        await self.broadcast_local(session_id, message)
        await self._publish(session_id, message)

    async def broadcast_local(self, session_id: str, message: dict[str, Any]) -> None:
        """Send a message to the websockets of this process only."""
        async with self._lock:
            connections = list(self._local.get(session_id, ()))
        for websocket in connections:
            try:
                await websocket.send_json(message)
            except Exception:  # noqa: BLE001 - a dead socket must not break the rest
                logger.debug("ws.send_failed", extra={"session_id": session_id})
                await self.disconnect(session_id, websocket)

    async def _publish(self, session_id: str, message: dict[str, Any]) -> None:
        if self._redis is None:
            return
        import json

        envelope = {
            "origin": self._instance_id,
            "session_id": session_id,
            "payload": message,
        }
        try:
            await self._redis.client().publish(
                f"{CHANNEL_PREFIX}{session_id}", json.dumps(envelope, default=str)
            )
        except Exception as exc:  # noqa: BLE001 - pub/sub is best effort
            logger.warning("ws.publish_failed", extra={"error": str(exc)})

    # -- redis listener ----------------------------------------------------

    async def start_listener(self) -> None:
        """Start the Redis pub/sub listener (no-op without Redis)."""
        if self._redis is None or self._listener_task is not None:
            return
        self._listener_task = asyncio.create_task(self._listen())

    async def stop(self) -> None:
        """Stop the listener and close the pub/sub connection."""
        if self._listener_task is not None:
            self._listener_task.cancel()
            try:
                await self._listener_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._listener_task = None
        if self._pubsub is not None:
            try:
                await self._pubsub.aclose()
            except Exception:  # noqa: BLE001
                pass
            self._pubsub = None

    async def _listen(self) -> None:
        import json

        redis = self._redis
        if redis is None:
            return
        try:
            self._pubsub = redis.client().pubsub(ignore_subscribe_messages=True)
            await self._pubsub.psubscribe(f"{CHANNEL_PREFIX}*")
            logger.info("ws.listener_started")
            while True:
                message = await self._pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=1.0
                )
                if not message:
                    continue
                data = message.get("data")
                if not isinstance(data, str):
                    continue
                try:
                    envelope = json.loads(data)
                except ValueError:
                    continue
                if not isinstance(envelope, dict):
                    continue
                if envelope.get("origin") == self._instance_id:
                    continue
                session_id = envelope.get("session_id")
                payload = envelope.get("payload")
                if not isinstance(session_id, str) or not isinstance(payload, dict):
                    continue
                await self.broadcast_local(session_id, payload)
        except asyncio.CancelledError:  # pragma: no cover - shutdown path
            raise
        except Exception as exc:  # noqa: BLE001 - the listener must never die loudly
            logger.warning("ws.listener_stopped", extra={"error": str(exc)})


_manager: ConnectionManager | None = None


def get_manager() -> ConnectionManager:
    """Return the process-wide connection manager."""
    global _manager
    if _manager is None:
        from app.core.redis import get_redis_manager

        _manager = ConnectionManager(get_redis_manager())
    return _manager


def set_manager(manager: ConnectionManager | None) -> None:
    """Replace the process-wide connection manager (used by tests)."""
    global _manager
    _manager = manager


__all__ = ["CHANNEL_PREFIX", "ConnectionManager", "get_manager", "set_manager"]
