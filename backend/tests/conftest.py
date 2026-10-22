"""Shared pytest fixtures.

The test suite runs against SQLite (via ``aiosqlite``) so no Postgres server
is required: the models use portable column types (``JSON`` with a ``JSONB``
variant, generic ``Uuid``) that behave identically on both backends.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.config import Settings, set_settings
from app.core.db import Database, set_database
from app.core.redis import RedisManager, set_redis_manager
from app.main import create_app
from app.models.base import Base

REPO_ROOT = Path(__file__).resolve().parents[2]
EVENT_SCHEMA_PATH = REPO_ROOT / "shared" / "schemas" / "event.schema.json"


@pytest.fixture(scope="session")
def event_schema() -> dict:
    """The canonical event JSON Schema (loaded from disk)."""
    assert EVENT_SCHEMA_PATH.exists(), f"missing schema at {EVENT_SCHEMA_PATH}"
    return json.loads(EVENT_SCHEMA_PATH.read_text(encoding="utf-8"))


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    """Test settings backed by a temporary SQLite database."""
    return Settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'codecinema-test.db'}",
        redis_url="",
        storage_dir=str(tmp_path / "storage"),
        public_url="http://localhost:3000",
        require_auth=False,
        export_worker_enabled=False,
        rate_limit_capacity=1000,
        jwt_secret="test-secret",
        log_level="ERROR",
    )


@pytest_asyncio.fixture
async def database(settings: Settings) -> AsyncIterator[Database]:
    """A freshly migrated SQLite database."""
    database = Database(settings.database_url)
    set_database(database)
    async with database.engine().begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield database
    finally:
        await database.dispose()
        set_database(None)


@pytest_asyncio.fixture
async def client(settings: Settings, database: Database) -> AsyncIterator[AsyncClient]:
    """An HTTP client bound to the application under test."""
    set_settings(settings)
    set_redis_manager(RedisManager(None))
    app = create_app(settings)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as http_client:
        yield http_client
    set_settings(None)
    set_redis_manager(None)


@pytest.fixture
def anyio_backend() -> str:
    """Keep pytest-asyncio happy when anyio plugins are installed."""
    return "asyncio"


@pytest.fixture
def git_repo(tmp_path: Path) -> Iterator[Path]:
    """An initialised git repository with one committed file."""
    import subprocess

    repo = tmp_path / "repo"
    repo.mkdir()
    env = {
        "GIT_AUTHOR_NAME": "CodeCinema",
        "GIT_AUTHOR_EMAIL": "test@codecinema.dev",
        "GIT_COMMITTER_NAME": "CodeCinema",
        "GIT_COMMITTER_EMAIL": "test@codecinema.dev",
        "PATH": "/usr/bin:/bin:/usr/local/bin",
        "HOME": str(tmp_path),
    }
    subprocess.run(["git", "init", "-q"], cwd=repo, env=env, check=True)
    (repo / "README.md").write_text("# demo\n", encoding="utf-8")
    subprocess.run(["git", "add", "."], cwd=repo, env=env, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "initial"], cwd=repo, env=env, check=True)
    yield repo
