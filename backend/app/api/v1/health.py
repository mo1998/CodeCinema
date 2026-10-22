"""Health endpoints."""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db_session
from app.core.redis import get_redis_manager

router = APIRouter(tags=["health"])


async def _check_db(session: AsyncSession) -> bool:
    try:
        await session.execute(sa.text("SELECT 1"))
    except Exception:  # noqa: BLE001 - health checks never raise
        return False
    return True


@router.get("/health")
async def health(session: AsyncSession = Depends(get_db_session)) -> dict[str, Any]:
    """Report the health of the API and its datastores."""
    db_ok = await _check_db(session)
    redis_ok = await get_redis_manager().ping()
    status = "ok" if db_ok else "degraded"
    return {
        "status": status,
        "db": "ok" if db_ok else "unavailable",
        "redis": "ok" if redis_ok else "unavailable",
    }


__all__ = ["router"]
