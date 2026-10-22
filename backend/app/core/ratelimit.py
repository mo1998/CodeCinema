"""Redis-backed token bucket used to throttle write endpoints."""

from __future__ import annotations

import time
from dataclasses import dataclass

from app.core.logging import get_logger
from app.core.redis import RedisManager

logger = get_logger(__name__)

# Token bucket: refill `capacity` tokens over `refill_per_second`, spending one
# token per request.  Implemented as a Lua script so it stays atomic.
_TOKEN_BUCKET_LUA = """
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(bucket[1])
local ts = tonumber(bucket[2])
if tokens == nil then tokens = capacity end
if ts == nil then ts = now end

local elapsed = math.max(0, now - ts) / 1000
tokens = math.min(capacity, tokens + elapsed * refill)

local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end

redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, ttl)
return {allowed, math.floor(tokens)}
"""


@dataclass(frozen=True)
class RateLimitDecision:
    """Outcome of a rate-limit check."""

    allowed: bool
    remaining: int
    retry_after: float = 0.0


class RateLimiter:
    """Token bucket limiter backed by Redis (fails open when Redis is down)."""

    def __init__(
        self,
        redis: RedisManager | None,
        *,
        capacity: int = 30,
        refill_per_second: float = 1.0,
    ) -> None:
        self._redis = redis
        self._capacity = max(1, capacity)
        self._refill = max(0.001, refill_per_second)

    async def check(self, key: str) -> RateLimitDecision:
        """Consume one token for ``key`` and report the decision."""
        if self._redis is None:
            return RateLimitDecision(allowed=True, remaining=self._capacity)
        try:
            client = self._redis.client()
            result = await client.eval(
                _TOKEN_BUCKET_LUA,
                1,
                key,
                self._capacity,
                self._refill,
                int(time.time() * 1000),
                int(max(self._capacity / self._refill, 1.0) * 2000),
            )
        except Exception as exc:  # noqa: BLE001 - never fail a request on rate limiting
            logger.warning("ratelimit.unavailable", extra={"error": str(exc)})
            return RateLimitDecision(allowed=True, remaining=self._capacity)
        allowed = bool(result and int(result[0]) == 1)
        remaining = int(result[1]) if result else 0
        retry_after = 0.0 if allowed else 1.0 / self._refill
        return RateLimitDecision(allowed=allowed, remaining=remaining, retry_after=retry_after)

    async def enforce(self, key: str) -> RateLimitDecision:
        """Like :meth:`check` but raises :class:`RateLimitError` when blocked."""
        from app.core.errors import RateLimitError

        decision = await self.check(key)
        if not decision.allowed:
            raise RateLimitError(
                "Too many requests", details={"retry_after": round(decision.retry_after, 2)}
            )
        return decision
