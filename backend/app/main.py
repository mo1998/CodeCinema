"""FastAPI application factory."""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.config import Settings, get_settings, set_settings
from app.core.db import get_database
from app.core.errors import DomainError
from app.core.logging import configure_logging, get_logger
from app.core.ratelimit import RateLimiter
from app.core.redis import get_redis_manager
from app.models.base import Base
from app.ws.manager import get_manager

logger = get_logger(__name__)

VERSION = "1.0.0"


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the FastAPI application."""
    if settings is not None:
        set_settings(settings)
    active = get_settings()
    configure_logging(active.log_level)

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        database = get_database()
        if active.auto_create_tables:
            async with database.engine().begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
        redis = get_redis_manager()
        await redis.ping()
        manager = get_manager()
        await manager.start_listener()

        worker_task: asyncio.Task[None] | None = None
        if active.export_worker_enabled and redis.available:
            from app.export.worker import ExportWorker

            worker = ExportWorker(database=database, redis=redis, settings=active)
            worker_task = asyncio.create_task(worker.run())

        logger.info(
            "app.started",
            extra={
                "environment": active.environment,
                "export_worker": worker_task is not None,
            },
        )
        try:
            yield
        finally:
            if worker_task is not None:
                worker_task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await worker_task
            await manager.stop()
            await redis.close()
            await database.dispose()

    app = FastAPI(
        title="CodeCinema API",
        version=VERSION,
        description="Record AI coding-agent sessions and replay them like a human developer.",
        lifespan=lifespan,
        docs_url="/docs",
        openapi_url="/openapi.json",
    )

    app.add_middleware(GZipMiddleware, minimum_size=800)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=active.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Cursor"],
    )

    app.include_router(api_router, prefix="/v1")

    app.state.rate_limiter = RateLimiter(
        get_redis_manager(),
        capacity=active.rate_limit_capacity,
        refill_per_second=active.rate_limit_refill_per_second,
    )
    app.state.settings = active

    _register_error_handlers(app)
    return app


def _register_error_handlers(app: FastAPI) -> None:
    """Install the JSON error envelope handlers."""

    @app.exception_handler(DomainError)
    async def _domain_error(_request: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.to_payload())

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "validation_error",
                    "message": "Request validation failed",
                    "details": {"errors": _jsonable_errors(exc)},
                }
            },
        )

    @app.exception_handler(Exception)
    async def _unhandled(_request: Request, exc: Exception) -> JSONResponse:
        logger.error("app.unhandled_error", exc_info=exc)
        return JSONResponse(
            status_code=500,
            content={"error": {"code": "internal_error", "message": "Internal server error"}},
        )


def _jsonable_errors(exc: RequestValidationError) -> list[dict[str, Any]]:
    """Make pydantic validation errors JSON serialisable."""
    errors: list[dict[str, Any]] = []
    for error in exc.errors():
        errors.append(
            {
                "loc": [str(part) for part in error.get("loc", ())],
                "msg": str(error.get("msg", "")),
                "type": str(error.get("type", "")),
            }
        )
    return errors


app = create_app()


def main() -> None:  # pragma: no cover - manual entry point
    """Run the API with uvicorn."""
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False)


if __name__ == "__main__":  # pragma: no cover
    main()
