"""Session recorder — orchestrates the watcher, the command capture and output."""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

from app.adapters.base import EventBuilder, SessionEvent
from app.core.logging import get_logger
from app.recorder.command_capture import ShellHistoryTailer, ToolCallParser
from app.recorder.repo_watcher import RepoWatcher, WatcherConfig

logger = get_logger(__name__)


@dataclass
class RecorderConfig:
    """Configuration of a recording run."""

    repo: Path
    agent: str = "generic"
    output: Path | None = None
    api_url: str | None = None
    api_key: str | None = None
    session_id: uuid.UUID | None = None
    poll_interval: float = 0.4
    duration: float | None = None
    title: str | None = None
    extra_ignores: frozenset[str] = field(default_factory=frozenset)

    def __post_init__(self) -> None:
        self.repo = Path(self.repo).resolve()


class SessionRecorder:
    """Records a session: runs a command while watching the worktree."""

    def __init__(self, config: RecorderConfig, *, builder: EventBuilder | None = None) -> None:
        self.config = config
        self.builder = builder or EventBuilder(session_id=str(config.session_id or "local"))
        self.watcher = RepoWatcher(
            WatcherConfig(
                repo=config.repo,
                poll_interval=config.poll_interval,
                extra_ignores=config.extra_ignores,
            ),
            builder=self.builder,
        )
        self.history = ShellHistoryTailer(builder=self.builder)
        self.tool_calls = ToolCallParser(builder=self.builder)

    # -- recording ---------------------------------------------------------

    async def record(self, command: Sequence[str] | None = None) -> list[SessionEvent]:
        """Run ``command`` (if any) while recording the worktree."""
        self.builder.session_start(
            title=self.config.title,
            agent=self.config.agent,
            repo=str(self.config.repo),
        )
        self.watcher.prime()
        self.history.prime()

        process: asyncio.subprocess.Process | None = None
        waiter: asyncio.Task[int] | None = None
        if command:
            self.builder.terminal_command(" ".join(command))
            process = await asyncio.create_subprocess_exec(
                *command,
                cwd=str(self.config.repo),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env={**os.environ, "CODECINEMA_RECORDING": "1"},
            )
            waiter = asyncio.create_task(process.wait())

        deadline = None
        if self.config.duration is not None:
            deadline = asyncio.get_running_loop().time() + self.config.duration

        while True:
            for event in self.watcher.poll_once():
                logger.debug("recorder.event", extra={"action": event.action})
            for event in self.history.poll():
                logger.debug("recorder.command", extra={"command": event.command})

            if waiter is not None and waiter.done():
                break
            if deadline is not None and asyncio.get_running_loop().time() >= deadline:
                break
            await asyncio.sleep(self.config.poll_interval)

        exit_code = 0
        if process is not None:
            try:
                output = await process.communicate()
                exit_code = process.returncode or 0
                text = output[0].decode("utf-8", errors="replace") if output[0] else ""
                if text.strip():
                    self.builder.terminal_write(text.strip()[-4000:], "output")
            except Exception as exc:  # noqa: BLE001
                logger.warning("recorder.command_failed", extra={"error": str(exc)})
            self.builder.terminal_exit(exit_code)
            if waiter is not None:
                waiter.cancel()

        # One last sweep so the final state of the worktree is captured.
        for _event in self.watcher.poll_once():
            pass

        self.builder.session_end(duration_ms=int(self.builder.events[-1].timestamp))
        return self.builder.events

    # -- output ------------------------------------------------------------

    def write_ndjson(self, events: Sequence[SessionEvent]) -> Path:
        """Write the events as newline delimited JSON."""
        target = self.config.output or (self.config.repo / "codecinema-session.ndjson")
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("w", encoding="utf-8") as handle:
            for event in events:
                handle.write(json.dumps(event.to_dict(), separators=(",", ":")) + "\n")
        return target

    async def post(self, events: Sequence[SessionEvent]) -> uuid.UUID:
        """Upload the events to the CodeCinema API."""
        import httpx

        if not self.config.api_url:
            raise RuntimeError("No api_url configured")
        headers = {"Content-Type": "application/json"}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"

        session_id = self.config.session_id
        async with httpx.AsyncClient(
            base_url=self.config.api_url.rstrip("/"), timeout=30.0
        ) as client:
            if session_id is None:
                response = await client.post(
                    "/v1/sessions",
                    json={
                        "title": self.config.title or f"{self.config.agent} session",
                        "agent": self.config.agent,
                        "visibility": "private",
                    },
                    headers=headers,
                )
                response.raise_for_status()
                session_id = uuid.UUID(response.json()["id"])
                self.config.session_id = session_id
            response = await client.post(
                f"/v1/sessions/{session_id}/events",
                json={"events": [event.to_dict() for event in events]},
                headers=headers,
            )
            response.raise_for_status()
        return session_id


__all__ = ["RecorderConfig", "SessionRecorder"]
