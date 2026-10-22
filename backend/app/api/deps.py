"""Shared FastAPI dependencies."""

from __future__ import annotations

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_db_session
from app.core.errors import UnauthorizedError
from app.core.ratelimit import RateLimiter
from app.core.security import Principal, authenticate


async def get_principal(
    request: Request,
    session: AsyncSession = Depends(get_db_session),
) -> Principal:
    """Resolve the caller from the ``Authorization`` header (optional)."""
    authorization = request.headers.get("authorization")
    return await authenticate(session, authorization)


async def require_principal(
    principal: Principal = Depends(get_principal),
) -> Principal:
    """Reject anonymous callers when authentication is enforced."""
    if get_settings().require_auth and not principal.is_authenticated:
        raise UnauthorizedError("Authentication required")
    return principal


def get_rate_limiter(request: Request) -> RateLimiter:
    """The application-wide rate limiter."""
    limiter = getattr(request.app.state, "rate_limiter", None)
    if limiter is None:  # pragma: no cover - defensive
        return RateLimiter(None)
    return limiter


async def enforce_write_rate_limit(
    request: Request,
    principal: Principal = Depends(get_principal),
) -> None:
    """Throttle write endpoints with a Redis backed token bucket."""
    limiter = get_rate_limiter(request)
    scope = request.url.path
    await limiter.enforce(f"rl:write:{principal.subject}:{scope}")


__all__ = [
    "enforce_write_rate_limit",
    "get_db_session",
    "get_principal",
    "get_rate_limiter",
    "require_principal",
]
