"""Typed domain errors and their HTTP mapping.

Every error surfaced to a client uses the envelope::

    {"error": {"code": "...", "message": "..."}}
"""

from __future__ import annotations

from typing import Any


class DomainError(Exception):
    """Base class for all expected (non-crash) application errors."""

    code: str = "domain_error"
    status_code: int = 400

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status_code: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        self.details = details or {}

    def to_payload(self) -> dict[str, Any]:
        """Render the wire representation of this error."""
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details:
            error["details"] = self.details
        return {"error": error}


class NotFoundError(DomainError):
    code = "not_found"
    status_code = 404


class UnauthorizedError(DomainError):
    code = "unauthorized"
    status_code = 401


class ForbiddenError(DomainError):
    code = "forbidden"
    status_code = 403


class ConflictError(DomainError):
    code = "conflict"
    status_code = 409


class InvalidInputError(DomainError):
    code = "validation_error"
    status_code = 422


class PayloadTooLargeError(DomainError):
    code = "payload_too_large"
    status_code = 413


class RateLimitError(DomainError):
    code = "rate_limited"
    status_code = 429


class ServiceUnavailableError(DomainError):
    code = "service_unavailable"
    status_code = 503
