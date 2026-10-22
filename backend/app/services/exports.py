"""Export service — job creation, queueing and storage paths."""

from __future__ import annotations

import uuid
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import NotFoundError
from app.core.logging import get_logger
from app.core.redis import RedisManager, get_redis_manager
from app.models.export import Export, ExportStatus, ExportType
from app.models.session import Session

logger = get_logger(__name__)


async def create_export(
    session: AsyncSession,
    record: Session,
    export_type: ExportType,
    *,
    requested_by: uuid.UUID | None = None,
) -> Export:
    """Create a queued export job."""
    job = Export(
        session_id=record.id,
        type=export_type,
        status=ExportStatus.queued,
        progress=0.0,
        requested_by=requested_by,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    return job


async def get_export_or_404(session: AsyncSession, export_id: uuid.UUID) -> Export:
    """Fetch an export job or raise :class:`NotFoundError`."""
    job = await session.get(Export, export_id)
    if job is None:
        raise NotFoundError("Export not found", code="export_not_found")
    return job


def export_storage_path(export_id: uuid.UUID, export_type: ExportType) -> Path:
    """Where the rendered artefact is written."""
    settings = get_settings()
    directory = Path(settings.storage_dir) / "exports" / str(export_id)
    directory.mkdir(parents=True, exist_ok=True)
    suffix = "json" if export_type == ExportType.json else export_type.value
    return directory / f"session.{suffix}"


async def enqueue_export(export_id: uuid.UUID, *, redis: RedisManager | None = None) -> bool:
    """Push an export job onto the Redis queue."""
    manager = redis if redis is not None else get_redis_manager()
    settings = get_settings()
    try:
        await manager.client().rpush(settings.export_queue_name, str(export_id))
    except Exception as exc:  # noqa: BLE001 - the queue is best effort
        logger.warning("export.enqueue_failed", extra={"error": str(exc)})
        return False
    return True


async def update_export_status(
    session: AsyncSession,
    job: Export,
    *,
    status: ExportStatus | None = None,
    progress: float | None = None,
    file_path: str | None = None,
    file_size: int | None = None,
    error: str | None = None,
) -> Export:
    """Persist a job status transition."""
    if status is not None:
        job.status = status
    if progress is not None:
        job.progress = max(0.0, min(1.0, float(progress)))
    if file_path is not None:
        job.file_path = file_path
    if file_size is not None:
        job.file_size = file_size
    if error is not None:
        job.error = error[:4000]
    if job.status in {ExportStatus.succeeded, ExportStatus.failed}:
        from datetime import UTC, datetime

        job.completed_at = datetime.now(UTC)
    await session.commit()
    return job


async def list_exports(session: AsyncSession, session_id: uuid.UUID) -> list[Export]:
    """All export jobs of a session, newest first."""
    return list(
        (
            await session.execute(
                sa.select(Export)
                .where(Export.session_id == session_id)
                .order_by(Export.created_at.desc())
            )
        )
        .scalars()
        .all()
    )


__all__ = [
    "create_export",
    "enqueue_export",
    "export_storage_path",
    "get_export_or_404",
    "list_exports",
    "update_export_status",
]
