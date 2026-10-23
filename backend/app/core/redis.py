"""Redis access with graceful degradation.

Redis powers the export queue, the cross-worker websocket fan-out and the rate
limiter.  None of those features are worth crashing the API over, so every
failure is swallowed (and logged) and the feature degrades to a no-op.
"""

from __future__ import annotations

from typing import Any

from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.logging import get_logger

logger = get_logger(__name__)


class RedisManager:
    """Thin wrapper around an async Redis client."""

    def __init__(self, url: str | None = None) -> None:
        self.url = url
        self._client: Redis | None = None
        self.available: bool = False

    def client(self) -> Redis:
        """Return (and lazily create) the Redis client."""
        if self._client is None:
            if not self.url:
                raise RedisError("no redis url configured")
            self._client = Redis.from_url(
                self.url,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=10,
                health_check_interval=30,
            )
        return self._client

    async def ping(self) -> bool:
        """Return True when Redis answers a PING."""
        try:
            await self.client().ping()
        except Exception as exc:  # noqa: BLE001 - any failure means "unavailable"
            if self.available:
                logger.warning("redis.unavailable", extra={"error": str(exc)})
            self.available = False
            return False
        self.available = True
        return True

    async def execute(self, *args: Any, **kwargs: Any) -> Any | None:
        """Run a Redis command, returning ``None`` when Redis is unavailable."""
        try:
            return await self.client().execute_command(*args, **kwargs)
        except Exception as exc:  # noqa: BLE001 - degrade, never crash
            logger.warning("redis.command_failed", extra={"error": str(exc)})
            return None

    async def close(self) -> None:
        """Close the client if it was created."""
        if self._client is not None:
            try:
                await self._client.aclose()
            except Exception:  # noqa: BLE001 - best effort
                logger.debug("redis.close_failed", exc_info=True)
        self._client = None
        self.available = False


_redis_manager: RedisManager | None = None


def get_redis_manager() -> RedisManager:
    """Return the process-wide Redis manager."""
    global _redis_manager
    if _redis_manager is None:
        from app.core.config import get_settings

        _redis_manager = RedisManager(get_settings().redis_url)
    return _redis_manager


def set_redis_manager(manager: RedisManager | None) -> None:
    """Replace the process-wide Redis manager (used by tests)."""
    global _redis_manager
    _redis_manager = manager
