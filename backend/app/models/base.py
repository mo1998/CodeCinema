"""Declarative base and portable column types."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB as PGJSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase

#: ``JSONB`` on PostgreSQL, plain ``JSON`` everywhere else (SQLite tests).
JSONBType = sa.JSON().with_variant(PGJSONB, "postgresql")

#: Native ``uuid`` on PostgreSQL, 32 char hex on SQLite.
UUIDType = PGUUID(as_uuid=True).with_variant(sa.Uuid(as_uuid=True), "sqlite")

#: ``bigserial`` on PostgreSQL, autoincrementing ``INTEGER`` on SQLite.
BigIntPK = sa.BigInteger().with_variant(sa.Integer, "sqlite")

#: Timestamps are always timezone aware.
TimestampType = sa.DateTime(timezone=True)


def utcnow() -> datetime:
    """Timezone-aware ``now`` used as a Python-side column default."""
    return datetime.now(UTC)


def new_uuid() -> uuid.UUID:
    """Primary-key default."""
    return uuid.uuid4()


class Base(DeclarativeBase):
    """Base class for every ORM model."""

    type_annotation_map = {
        uuid.UUID: UUIDType,
        datetime: TimestampType,
        dict: JSONBType,
    }
