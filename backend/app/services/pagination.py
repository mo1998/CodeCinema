"""Opaque cursor encoding for keyset pagination."""

from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime
from typing import Any


def encode_cursor(payload: dict[str, Any]) -> str:
    """Encode a keyset payload into an opaque cursor."""
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def decode_cursor(cursor: str | None) -> dict[str, Any] | None:
    """Decode an opaque cursor, returning ``None`` when it is invalid."""
    if not cursor:
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("ascii"))
        payload = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def decode_datetime(payload: dict[str, Any], key: str = "t") -> datetime | None:
    """Read an ISO timestamp out of a decoded cursor payload."""
    raw = payload.get(key)
    if isinstance(raw, datetime):
        return raw
    if isinstance(raw, str):
        try:
            return datetime.fromisoformat(raw)
        except ValueError:
            return None
    return None


def decode_uuid(payload: dict[str, Any], key: str = "id") -> uuid.UUID | None:
    """Read a UUID out of a decoded cursor payload.

    Cursors travel as text, but the column they are compared against is a
    UUID. Comparing a string to a UUID column is an error on both Postgres
    and SQLite, so the value has to be converted before it reaches the query.
    """
    raw = payload.get(key)
    if isinstance(raw, uuid.UUID):
        return raw
    if isinstance(raw, str):
        try:
            return uuid.UUID(raw)
        except ValueError:
            return None
    return None


__all__ = ["decode_cursor", "decode_datetime", "decode_uuid", "encode_cursor"]
