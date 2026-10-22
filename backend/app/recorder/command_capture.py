"""Capture shell commands and adapter-provided tool calls."""

from __future__ import annotations

import os
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from app.adapters.base import EventBuilder, SessionEvent
from app.core.logging import get_logger

logger = get_logger(__name__)

#: History files per shell.
HISTORY_FILES: dict[str, tuple[str, ...]] = {
    "bash": ("~/.bash_history",),
    "zsh": ("~/.zsh_history",),
    "fish": ("~/.local/share/fish/fish_history",),
}

#: Tool names that represent a shell invocation.
TERMINAL_TOOLS = {
    "bash",
    "bashoutput",
    "shell",
    "run_terminal_cmd",
    "run_shell_command",
    "execute_command",
    "executecommand",
    "run_command",
    "terminal",
}


def detect_history_paths() -> list[Path]:
    """Return the history files of the current shell (may be empty)."""
    shell = os.environ.get("SHELL", "")
    name = Path(shell).name if shell else "bash"
    candidates = HISTORY_FILES.get(name)
    if candidates is None:
        candidates = HISTORY_FILES["bash"]
    paths: list[Path] = []
    for candidate in candidates:
        path = Path(candidate).expanduser()
        if path.exists():
            paths.append(path)
    return paths


class ShellHistoryTailer:
    """Tails shell history files and emits ``terminal.command`` events."""

    def __init__(
        self,
        *,
        history_paths: Iterable[Path] | None = None,
        builder: EventBuilder | None = None,
        skip_commands: Iterable[str] | None = None,
    ) -> None:
        self.paths = list(history_paths) if history_paths is not None else detect_history_paths()
        self.builder = builder or EventBuilder()
        self._offsets: dict[Path, int] = {}
        self._skip = set(skip_commands or ())

    def prime(self) -> None:
        """Remember the current end of every history file."""
        for path in self.paths:
            try:
                self._offsets[path] = path.stat().st_size
            except OSError:
                self._offsets[path] = 0

    def poll(self) -> list[SessionEvent]:
        """Return the commands appended since the last poll."""
        events: list[SessionEvent] = []
        for path in self.paths:
            try:
                size = path.stat().st_size
            except OSError:
                continue
            offset = self._offsets.get(path, 0)
            if size < offset:
                # The file was truncated / rotated — restart from the top.
                offset = 0
            try:
                with path.open("r", encoding="utf-8", errors="replace") as handle:
                    handle.seek(offset)
                    chunk = handle.read()
                    self._offsets[path] = handle.tell()
            except OSError:
                continue
            for line in chunk.splitlines():
                command = line.strip()
                if not command or command.startswith("#"):
                    continue
                if command in self._skip:
                    continue
                events.append(self.builder.terminal_command(command))
        return events


class ToolCallParser:
    """Turns adapter style tool calls into terminal events."""

    def __init__(self, builder: EventBuilder | None = None) -> None:
        self.builder = builder or EventBuilder()

    def parse_tool_call(self, tool: str, arguments: dict[str, Any]) -> list[SessionEvent]:
        """Emit terminal events for a terminal-like tool call."""
        name = (tool or "").strip().lower()
        if name not in TERMINAL_TOOLS:
            return []
        command = arguments.get("command") or arguments.get("cmd") or arguments.get("script")
        if not isinstance(command, str) or not command.strip():
            return []
        events = [self.builder.terminal_command(command)]
        output = arguments.get("output")
        if isinstance(output, str) and output:
            kind = "error" if arguments.get("is_error") else "output"
            events.append(self.builder.terminal_write(output, kind))
        exit_code = arguments.get("exit_code")
        if isinstance(exit_code, int):
            events.append(self.builder.terminal_exit(exit_code))
        return events


__all__ = [
    "HISTORY_FILES",
    "ShellHistoryTailer",
    "TERMINAL_TOOLS",
    "ToolCallParser",
    "detect_history_paths",
]
