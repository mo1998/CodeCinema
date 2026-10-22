"""Agent registry and ingest endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.registry import list_adapters
from app.api.deps import enforce_write_rate_limit
from app.core.db import get_db_session
from app.models.session import SessionVisibility
from app.schemas.comment import IngestRequest, IngestResponse
from app.services.ingest import ingest_raw

router = APIRouter(tags=["agents"])


@router.get("/agents")
async def list_agents() -> dict[str, Any]:
    """List the supported agents and their capabilities."""
    return {"items": list_adapters()}


@router.post(
    "/ingest/{agent}",
    response_model=IngestResponse,
    dependencies=[Depends(enforce_write_rate_limit)],
)
async def ingest(
    agent: str,
    payload: IngestRequest,
    session: AsyncSession = Depends(get_db_session),
) -> IngestResponse:
    """Ingest a raw agent transcript.

    The transcript is normalised by the agent adapter into canonical events
    and appended to the (optionally supplied) session.
    """
    visibility: SessionVisibility | None = None
    if payload.visibility:
        try:
            visibility = SessionVisibility(payload.visibility)
        except ValueError:
            visibility = None
    result = await ingest_raw(
        session,
        agent=agent,
        raw=payload.raw,
        session_id=payload.session_id,
        title=payload.title,
        prompt=payload.prompt,
        repo_url=payload.repo_url,
        branch=payload.branch,
        visibility=visibility,
    )
    return IngestResponse(
        session_id=result.session_id,
        agent=result.agent,
        appended=result.appended,
        duplicates=result.duplicates,
        session_event_count=result.session_event_count,
    )


__all__ = ["router"]
