"""Redis queue worker consuming export jobs."""

from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path
from typing import Any

from app.core.config import Settings, get_settings
from app.core.db import Database, get_database
from app.core.logging import get_logger
from app.core.redis import RedisManager, get_redis_manager
from app.export.ffmpeg import ExportError, webm_to_gif, webm_to_mp4
from app.export.renderer import render_session
from app.models.export import Export, ExportStatus, ExportType
from app.models.session import Session
from app.services.events import load_events
from app.services.exports import export_storage_path, update_export_status
from app.services.shares import share_url

logger = get_logger(__name__)


class ExportWorker:
    """Consumes export jobs from the Redis queue."""

    def __init__(
        self,
        *,
        database: Database | None = None,
        redis: RedisManager | None = None,
        settings: Settings | None = None,
    ) -> None:
        self._database = database
        self._redis = redis
        self._settings = settings

    @property
    def database(self) -> Database:
        return self._database or get_database()

    @property
    def redis(self) -> RedisManager:
        return self._redis or get_redis_manager()

    @property
    def settings(self) -> Settings:
        return self._settings or get_settings()

    # -- loop --------------------------------------------------------------

    async def run(self) -> None:
        """Consume jobs until cancelled."""
        queue = self.settings.export_queue_name
        logger.info("export.worker_started", extra={"queue": queue})
        while True:
            try:
                item = await self.redis.client().blpop(queue, timeout=5)
            except asyncio.CancelledError:  # pragma: no cover - shutdown path
                raise
            except Exception as exc:  # noqa: BLE001 - keep the worker alive
                logger.warning("export.queue_error", extra={"error": str(exc)})
                await asyncio.sleep(2)
                continue
            if not item:
                continue
            _key, raw = item
            try:
                export_id = uuid.UUID(str(raw))
            except ValueError:
                logger.warning("export.invalid_job", extra={"payload": str(raw)[:120]})
                continue
            try:
                await self.process(export_id)
            except asyncio.CancelledError:  # pragma: no cover - shutdown path
                raise
            except Exception as exc:  # noqa: BLE001 - one bad job must not kill the worker
                logger.error(
                    "export.job_failed",
                    extra={"export_id": str(export_id), "error": str(exc)},
                )

    # -- processing --------------------------------------------------------

    async def process(self, export_id: uuid.UUID) -> Export:
        """Render one export job."""
        async with self.database.session() as session:
            job = await session.get(Export, export_id)
            if job is None:
                logger.warning("export.missing_job", extra={"export_id": str(export_id)})
                raise ExportError("Export job not found")
            record = await session.get(Session, job.session_id)
            if record is None:
                await update_export_status(
                    session, job, status=ExportStatus.failed, error="Session no longer exists"
                )
                return job

            job = await update_export_status(
                session, job, status=ExportStatus.running, progress=0.05
            )
            target = export_storage_path(job.id, job.type)

            try:
                if job.type == ExportType.json:
                    path = await self._export_json(session, job, record, target)
                else:
                    path = await self._export_video(session, job, record, target)
            except ExportError as exc:
                logger.warning("export.render_failed", extra={"error": str(exc)})
                return await update_export_status(
                    session, job, status=ExportStatus.failed, error=str(exc)
                )
            except Exception as exc:  # noqa: BLE001
                logger.error("export.render_crashed", extra={"error": str(exc)})
                return await update_export_status(
                    session, job, status=ExportStatus.failed, error=str(exc)
                )

            size = path.stat().st_size if path.exists() else None
            return await update_export_status(
                session,
                job,
                status=ExportStatus.succeeded,
                progress=1.0,
                file_path=str(path),
                file_size=size,
            )

    # -- strategies --------------------------------------------------------

    async def _export_json(self, session: Any, job: Export, record: Session, target: Path) -> Path:
        events = await load_events(session, record.id)
        payload = {
            "version": 1,
            "exported_at": job.created_at.isoformat(),
            "session": {
                "id": str(record.id),
                "title": record.title,
                "prompt": record.prompt,
                "agent": record.agent,
                "repo_url": record.repo_url,
                "branch": record.branch,
                "status": record.status.value,
                "visibility": record.visibility.value,
                "duration_ms": record.duration_ms,
                "event_count": record.event_count,
                "metadata": record.metadata_dict(),
                "created_at": record.created_at.isoformat(),
                "published_at": record.published_at.isoformat() if record.published_at else None,
            },
            "events": events,
        }
        target.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(
            target.write_text,
            json.dumps(payload, indent=2, default=str),
            "utf-8",
        )
        await update_export_status(session, job, progress=0.9)
        return target

    async def _export_video(self, session: Any, job: Export, record: Session, target: Path) -> Path:
        if not record.share_slug:
            raise ExportError("Session must be published before it can be rendered")
        work_dir = target.parent / "frames"
        work_dir.mkdir(parents=True, exist_ok=True)
        public_url = self.settings.public_url
        # Playwright and ffmpeg are blocking: keep them off the event loop.
        webm = await asyncio.to_thread(
            render_session,
            record.share_slug,
            public_url=public_url,
            out_dir=work_dir,
        )
        await update_export_status(session, job, progress=0.6)
        if job.type == ExportType.mp4:
            return await asyncio.to_thread(webm_to_mp4, webm, target)
        if job.type == ExportType.gif:
            return await asyncio.to_thread(webm_to_gif, webm, target)
        raise ExportError(f"Unsupported export type '{job.type}'")


async def run_worker() -> None:
    """Entrypoint used by ``python -m app.export.worker``."""
    worker = ExportWorker()
    await worker.run()


def share_link(settings: Settings, slug: str) -> str:
    """Public URL of a shared session (helper for logs)."""
    return share_url(settings.public_url, slug)


__all__ = ["ExportWorker", "run_worker", "share_link"]
