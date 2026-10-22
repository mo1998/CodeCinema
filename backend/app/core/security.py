"""API-key hashing, bearer authentication and lightweight JWT support."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import UnauthorizedError
from app.core.logging import get_logger
from app.models.user import ApiKey

logger = get_logger(__name__)

PBKDF2_ALGORITHM = "pbkdf2_sha256"
API_KEY_MARKER = "cc_"


def _b64u_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64u_decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def generate_api_key(prefix: str | None = None) -> tuple[str, str, str]:
    """Create a new API key.

    Returns ``(raw_key, key_prefix, key_hash)``.  Only the hash is persisted.
    """
    marker = prefix if prefix is not None else get_settings().api_key_prefix
    raw = f"{marker}_{secrets.token_urlsafe(32)}"
    return raw, raw[:12], hash_api_key(raw)


def hash_api_key(raw: str, *, iterations: int | None = None) -> str:
    """Hash an API key with PBKDF2-HMAC-SHA256 and a random salt."""
    rounds = iterations if iterations is not None else get_settings().api_key_iterations
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", raw.encode("utf-8"), salt, rounds)
    return f"{PBKDF2_ALGORITHM}${rounds}${salt.hex()}${digest.hex()}"


def verify_api_key(raw: str, stored: str) -> bool:
    """Constant-time verification of an API key against its stored hash."""
    try:
        algorithm, rounds, salt_hex, digest_hex = stored.split("$")
        if algorithm != PBKDF2_ALGORITHM:
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", raw.encode("utf-8"), bytes.fromhex(salt_hex), int(rounds)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest.hex(), digest_hex)


def create_access_token(
    user_id: str | uuid.UUID,
    *,
    secret: str | None = None,
    expires_in: int | None = None,
) -> str:
    """Create a signed HS256 access token for a user."""
    settings = get_settings()
    signing_secret = secret if secret is not None else settings.jwt_secret
    ttl = expires_in if expires_in is not None else settings.jwt_ttl_seconds
    now = int(time.time())
    header = {"alg": settings.jwt_algorithm, "typ": "JWT"}
    payload = {"sub": str(user_id), "iat": now, "exp": now + ttl}
    encoded_header = _b64u_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    encoded_payload = _b64u_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{encoded_header}.{encoded_payload}"
    signature = hmac.new(
        signing_secret.encode("utf-8"), signing_input.encode("utf-8"), hashlib.sha256
    ).digest()
    return f"{signing_input}.{_b64u_encode(signature)}"


def decode_access_token(token: str, *, secret: str | None = None) -> dict[str, Any]:
    """Verify and decode an HS256 access token."""
    settings = get_settings()
    signing_secret = secret if secret is not None else settings.jwt_secret
    try:
        signing_input, signature = token.rsplit(".", 1)
        _encoded_header, encoded_payload = signing_input.split(".", 1)
    except ValueError as exc:
        raise UnauthorizedError("Malformed access token") from exc
    expected = hmac.new(
        signing_secret.encode("utf-8"), signing_input.encode("utf-8"), hashlib.sha256
    ).digest()
    if not hmac.compare_digest(expected, _b64u_decode(signature)):
        raise UnauthorizedError("Invalid token signature")
    try:
        payload = json.loads(_b64u_decode(encoded_payload))
    except ValueError as exc:
        raise UnauthorizedError("Malformed access token payload") from exc
    if not isinstance(payload, dict):
        raise UnauthorizedError("Malformed access token payload")
    expires_at = payload.get("exp")
    if expires_at is not None and int(expires_at) < int(time.time()):
        raise UnauthorizedError("Access token expired")
    return payload


@dataclass(frozen=True)
class Principal:
    """The authenticated (or anonymous) caller."""

    kind: str = "anonymous"
    user_id: uuid.UUID | None = None
    api_key_id: uuid.UUID | None = None

    @property
    def is_authenticated(self) -> bool:
        return self.kind in {"api_key", "jwt"}

    @property
    def subject(self) -> str:
        return str(self.user_id) if self.user_id else "anonymous"


ANONYMOUS = Principal()


async def authenticate(session: AsyncSession, authorization: str | None) -> Principal:
    """Resolve a bearer credential into a :class:`Principal`."""
    if not authorization:
        return ANONYMOUS
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise UnauthorizedError("Authorization header must use the Bearer scheme")
    token = token.strip()
    if token.startswith(API_KEY_MARKER):
        return await _authenticate_api_key(session, token)
    payload = decode_access_token(token)
    subject = payload.get("sub")
    try:
        user_id = uuid.UUID(str(subject))
    except (ValueError, TypeError) as exc:
        raise UnauthorizedError("Invalid token subject") from exc
    return Principal(kind="jwt", user_id=user_id)


async def _authenticate_api_key(session: AsyncSession, raw: str) -> Principal:
    key_prefix = raw[:12]
    result = await session.execute(select(ApiKey).where(ApiKey.key_prefix == key_prefix))
    api_key = result.scalar_one_or_none()
    if api_key is None:
        raise UnauthorizedError("Invalid API key")
    if api_key.revoked_at is not None:
        raise UnauthorizedError("API key has been revoked")
    if not verify_api_key(raw, api_key.key_hash):
        raise UnauthorizedError("Invalid API key")
    api_key.last_used_at = datetime.now(UTC)
    await session.commit()
    return Principal(kind="api_key", user_id=api_key.user_id, api_key_id=api_key.id)
