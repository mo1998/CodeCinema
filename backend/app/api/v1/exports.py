"""Export endpoints."""

from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import enforce_write_rate_limit, get_principal
from app.core.db import get_db_session
from app.core.errors import NotFoundError
from app.core.security import Principal
from app.schemas.export import ExportCreate, ExportOut
from app.services.exports import create_export, enqueue_export, get_export_or_404, list_exports
from app.services.sessions import get_session_or_404

router = APIRouter(tags=["exports"])


def _to_out(job) -> ExportOut:
    return ExportOut(
        id=job.id,
        session_id=job.session_id,
        type=job.type,
        status=job.status,
        progress=job.progress,
        file_path=job.file_path,
        file_size=job.file_size,
        error=job.error,
        created_at=job.created_at,
        completed_at=job.completed_at,
        download_url=f"/v1/exports/{job.id}/download",
    )


@router.post(
    "/sessions/{session_id}/exports",
    response_model=ExportOut,
    status_code=201,
    dependencies=[Depends(enforce_write_rate_limit)],
)
async def create(
    session_id: uuid.UUID,
    payload: ExportCreate,
    session: AsyncSession = Depends(get_db_session),
    principal: Principal = Depends(get_principal),
) -> ExportOut:
    """Queue an export of a session."""
    record = await get_session_or_404(session, session_id)
    job = await create_export(session, record, payload.type, requested_by=principal.user_id)
    await enqueue_export(job.id)
    return _to_out(job)


@router.get("/sessions/{session_id}/exports", response_model=list[ExportOut])
async def index(
    session_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
) -> list[ExportOut]:
    """List export jobs for a session."""
    await get_session_or_404(session, session_id)
    jobs = await list_exports(session, session_id)
    return [_to_out(job) for job in jobs]


@router.get("/exports/{export_id}", response_model=ExportOut)
async def show(
    export_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
) -> ExportOut:
    """Status of an export job."""
    job = await get_export_or_404(session, export_id)
    return _to_out(job)


@router.get("/exports/{export_id}/download")
async def download(
    export_id: uuid.UUID,
    session: AsyncSession = Depends(get_db_session),
) -> FileResponse:
    """Download a finished export."""
    job = await get_export_or_404(session, export_id)
    if not job.file_path:
        raise NotFoundError("Export has no artefact yet", code="export_not_ready")
    path = Path(job.file_path)
    if not path.exists():
        raise NotFoundError("Export artefact is missing", code="export_missing")
    media_type = {
        "json": "application/json",
        "mp4": "video/mp4",
        "gif": "image/gif",
    }.get(job.type.value, "application/octet-stream")
    return FileResponse(
        path,
        media_type=media_type,
        filename=path.name,
    )


__all__ = ["router"]
