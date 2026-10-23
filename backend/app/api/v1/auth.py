"""Authentication helpers."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db_session
from app.core.security import generate_api_key
from app.models.user import ApiKey, User

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/anonymous")
async def anonymous(
    session: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    """Create an anonymous user and return a fresh API key."""
    user = User(
        email=f"anon-{uuid.uuid4()}@codecinema.local",
        display_name="Anonymous",
    )
    session.add(user)
    await session.flush()
    raw, prefix, hashed = generate_api_key()
    session.add(
        ApiKey(
            user_id=user.id,
            name="anonymous",
            key_prefix=prefix,
            key_hash=hashed,
        )
    )
    await session.commit()
    return {"api_key": raw}


__all__ = ["router"]
