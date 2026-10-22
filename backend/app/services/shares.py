"""Share slug helpers and public access."""

from __future__ import annotations

import secrets

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.models.session import Session

# Unambiguous alphabet (no look-alike characters).
_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"
_SLUG_LENGTH = 10


def generate_slug(length: int = _SLUG_LENGTH) -> str:
    """Generate a random, URL friendly share slug."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


async def get_session_by_slug(session: AsyncSession, slug: str) -> Session:
    """Fetch a published session by its share slug."""
    record = await session.scalar(sa.select(Session).where(Session.share_slug == slug))
    if record is None or record.deleted_at is not None:
        raise NotFoundError("Share not found", code="share_not_found")
    return record


def share_url(base_url: str, slug: str) -> str:
    """Public URL of a shared session."""
    return f"{base_url.rstrip('/')}/share/{slug}"


__all__ = ["generate_slug", "get_session_by_slug", "share_url"]
