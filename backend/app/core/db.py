"""Async SQLAlchemy engine, session factory and FastAPI dependency."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool


class Database:
    """Owns the async engine and hands out sessions.

    The URL is pluggable: PostgreSQL in production, SQLite (aiosqlite) for tests.
    """

    def __init__(self, url: str, *, echo: bool = False) -> None:
        self.url = url
        self._echo = echo
        self._engine: AsyncEngine | None = None
        self._factory: async_sessionmaker[AsyncSession] | None = None

    def engine(self) -> AsyncEngine:
        """Return (and lazily create) the async engine."""
        if self._engine is None:
            options: dict[str, Any] = {"echo": self._echo, "future": True, "pool_pre_ping": True}
            if self.url.startswith("sqlite"):
                options["connect_args"] = {"check_same_thread": False}
                if ":memory:" in self.url or "mode=memory" in self.url:
                    options["poolclass"] = StaticPool
            self._engine = create_async_engine(self.url, **options)
            self._factory = async_sessionmaker(
                self._engine, expire_on_commit=False, autoflush=False
            )
        return self._engine

    def session_factory(self) -> async_sessionmaker[AsyncSession]:
        """Return the configured session factory."""
        if self._factory is None:
            self.engine()
        assert self._factory is not None  # noqa: S101 - set by engine()
        return self._factory

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        """Async context manager yielding a session."""
        factory = self.session_factory()
        async with factory() as session:
            yield session

    async def dispose(self) -> None:
        """Dispose the engine and release connections."""
        if self._engine is not None:
            await self._engine.dispose()
        self._engine = None
        self._factory = None


_database: Database | None = None


def get_database() -> Database:
    """Return the process-wide database handle."""
    global _database
    if _database is None:
        from app.core.config import get_settings

        _database = Database(get_settings().database_url)
    return _database


def set_database(database: Database | None) -> None:
    """Replace the process-wide database handle (used by tests)."""
    global _database
    _database = database


async def get_db_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding an :class:`AsyncSession`."""
    async with get_database().session() as session:
        yield session
