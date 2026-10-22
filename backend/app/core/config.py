"""Application settings.

Values are read from the process environment (or a local ``.env`` file) via
``pydantic-settings``.  Never log these values — they contain secrets.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the API, recorder and export worker."""

    model_config = SettingsConfigDict(
        env_file=(".env",),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # -- service ------------------------------------------------------------
    app_name: str = "codecinema-backend"
    environment: str = "development"
    debug: bool = False
    log_level: str = "INFO"

    # -- datastores ---------------------------------------------------------
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/codecinema"
    redis_url: str = "redis://localhost:6379/0"

    # -- auth ---------------------------------------------------------------
    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_ttl_seconds: int = 7 * 24 * 3600
    api_key_prefix: str = "cc"
    api_key_iterations: int = 120_000
    require_auth: bool = False

    # -- storage / urls -----------------------------------------------------
    storage_dir: Path = Path("/var/lib/codecinema")
    public_url: str = "http://localhost:3000"
    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    # -- limits -------------------------------------------------------------
    max_events_per_request: int = 5_000
    max_event_page_size: int = 2_000
    default_page_size: int = 40
    max_page_size: int = 200

    # -- rate limiting ------------------------------------------------------
    rate_limit_capacity: int = 30
    rate_limit_refill_per_second: float = 1.0

    # -- exports ------------------------------------------------------------
    export_worker_enabled: bool = True
    export_queue_name: str = "codecinema:exports"
    export_ffmpeg_binary: str = "ffmpeg"

    # -- websockets ---------------------------------------------------------
    ws_heartbeat_seconds: float = 15.0
    ws_stats_interval_seconds: float = 5.0

    # -- misc ---------------------------------------------------------------
    auto_create_tables: bool = False

    @property
    def cors_origin_list(self) -> list[str]:
        """CORS origins parsed from a comma separated string."""
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def is_sqlite(self) -> bool:
        """True when the configured database is a local SQLite file."""
        return self.database_url.startswith("sqlite")


_settings_override: Settings | None = None


@lru_cache(maxsize=1)
def _load_settings() -> Settings:
    return Settings()


def get_settings() -> Settings:
    """Return the active settings (overridable for tests)."""
    if _settings_override is not None:
        return _settings_override
    return _load_settings()


def set_settings(settings: Settings | None) -> None:
    """Override the active settings. Passing ``None`` restores env-based config."""
    global _settings_override
    _settings_override = settings
