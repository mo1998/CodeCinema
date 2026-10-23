"""Export request/response schemas."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict

from app.models.export import ExportStatus, ExportType
from app.schemas.common import UtcDateTime


class ExportCreate(BaseModel):
    """Body of ``POST /v1/sessions/{id}/exports``."""

    type: ExportType = ExportType.json


class ExportOut(BaseModel):
    """Public representation of an export job."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    session_id: uuid.UUID
    type: ExportType
    status: ExportStatus
    progress: float = 0.0
    file_path: str | None = None
    file_size: int | None = None
    error: str | None = None
    created_at: UtcDateTime
    completed_at: UtcDateTime | None = None
    download_url: str | None = None


__all__ = ["ExportCreate", "ExportOut"]
