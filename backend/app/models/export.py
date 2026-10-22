"""Export job model."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampType, UUIDType, new_uuid, utcnow


class ExportType(enum.StrEnum):
    """Supported export formats."""

    json = "json"
    mp4 = "mp4"
    gif = "gif"


class ExportStatus(enum.StrEnum):
    """Lifecycle of an export job."""

    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


def _enum_values(enum_cls: type[enum.Enum]) -> list[str]:
    return [member.value for member in enum_cls]


ExportTypeEnum = sa.Enum(ExportType, name="export_type", values_callable=_enum_values)
ExportStatusEnum = sa.Enum(ExportStatus, name="export_status", values_callable=_enum_values)


class Export(Base):
    """A queued or completed export of a session."""

    __tablename__ = "exports"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=new_uuid)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    type: Mapped[ExportType] = mapped_column(ExportTypeEnum, nullable=False)
    status: Mapped[ExportStatus] = mapped_column(
        ExportStatusEnum, nullable=False, default=ExportStatus.queued
    )
    progress: Mapped[float] = mapped_column(sa.Float, nullable=False, default=0.0)
    file_path: Mapped[str | None] = mapped_column(sa.String(1024), nullable=True)
    file_size: Mapped[int | None] = mapped_column(sa.BigInteger, nullable=True)
    error: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TimestampType, nullable=False, default=utcnow, server_default=sa.func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(TimestampType, nullable=True)
    requested_by: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


__all__ = ["Export", "ExportStatus", "ExportStatusEnum", "ExportType", "ExportTypeEnum"]
