"""Pure event reducer — Python projection of ``frontend/lib/engine/state.ts``.

The reducer is a *pure fold* over the event stream: the same events in the
same order always produce the same state.  It is used server side to answer
``GET /v1/sessions/{id}/state?at=…`` with results identical to the browser.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from app.core.languages import detect_language

#: Actions that produce a timeline entry in the UI.
TIMELINE_ACTIONS = frozenset(
    {
        "session.start",
        "session.end",
        "think",
        "narrate",
        "file.create",
        "file.delete",
        "file.rename",
        "terminal",
        "terminal.open",
        "terminal.command",
        "terminal.write",
        "terminal.exit",
        "build.start",
        "build.success",
        "build.failure",
        "test.start",
        "test.result",
        "error",
        "fix",
        "dependency.add",
        "dependency.remove",
        "pause",
    }
)

#: Terminal line kinds.
TERMINAL_KINDS = ("command", "output", "error", "info", "success")

#: Maximum number of retained terminal lines (mirrors the frontend).
MAX_TERMINAL_LINES = 2000


@dataclass
class FileRecord:
    """A file open in the virtual editor."""

    path: str
    text: str = ""
    language: str = "plaintext"
    created_at: int = 0
    last_modified_at: int = 0
    cursor: int = 0
    selection: dict[str, int] | None = None
    scroll_top: int = 0
    revision: int = 0


@dataclass
class TerminalLine:
    """One line in the virtual terminal."""

    id: int
    kind: str
    text: str
    timestamp: int
    streamed: bool = True


@dataclass
class TerminalRecord:
    """The virtual terminal."""

    open: bool = False
    lines: list[TerminalLine] = field(default_factory=list)
    next_id: int = 0
    last_exit_code: int | None = None


def _as_dict(event: Any) -> dict[str, Any]:
    """Normalise an event (model or mapping) into a plain dict."""
    if isinstance(event, dict):
        return event
    dump = getattr(event, "model_dump", None)
    if callable(dump):
        return dump(mode="json", by_alias=True, exclude_none=True)
    return dict(event)  # pragma: no cover - defensive


def _splice(text: str, offset: int, count: int, insert: str) -> str:
    """Replace ``count`` characters at ``offset`` (JS ``String.splice`` semantics)."""
    if offset < 0:
        offset = 0
    if offset > len(text):
        offset = len(text)
    end = min(len(text), offset + max(0, count))
    return text[:offset] + insert + text[end:]


class SessionState:
    """Mutable fold state for one session."""

    def __init__(self) -> None:
        self.files: dict[str, FileRecord] = {}
        self.file_order: list[str] = []
        self.touched_files: list[str] = []
        self.tabs: list[str] = []
        self.active_file: str | None = None
        self.terminal = TerminalRecord()
        self.narration: list[dict[str, Any]] = []
        self.timeline: list[dict[str, Any]] = []
        self.dependencies: list[dict[str, Any]] = []
        self.build: dict[str, Any] = {"status": "idle", "errors": []}
        self.errors: list[dict[str, Any]] = []
        self.fixes: list[dict[str, Any]] = []
        self.meta: dict[str, Any] = {}
        self.consumed_events: int = 0
        self._next_narration_id = 0
        self._next_error_id = 0
        self._next_fix_id = 0

    # -- folding -----------------------------------------------------------

    def apply(self, event: Any, event_index: int) -> None:
        """Apply one event."""
        data = _as_dict(event)
        self.consumed_events = event_index + 1
        timestamp = int(data.get("timestamp") or 0)
        action = str(data.get("action") or "")

        if action == "session.start":
            self.meta = {
                "title": data.get("title", self.meta.get("title")),
                "agent": data.get("agent", self.meta.get("agent")),
                "prompt": data.get("prompt", self.meta.get("prompt")),
                "repo": data.get("repo", self.meta.get("repo")),
                "model": data.get("model", self.meta.get("model")),
            }
        elif action == "narrate":
            entry: dict[str, Any] = {
                "id": self._next_narration_id,
                "timestamp": timestamp,
                "text": data.get("text", ""),
                "category": data.get("category", "explanation"),
            }
            self._next_narration_id += 1
            if data.get("file"):
                entry["file"] = data["file"]
            self.narration.append(entry)
        elif action == "file.create":
            self._apply_file_create(data, timestamp)
        elif action == "file.delete":
            self._apply_file_delete(data)
        elif action == "file.rename":
            self._apply_file_rename(data)
        elif action in {"type", "insert"}:
            record = self._ensure_file(str(data.get("file") or ""), timestamp)
            offset = data.get("offset")
            offset = offset if isinstance(offset, int) else len(record.text)
            content = data.get("content") or ""
            record.text = _splice(record.text, offset, 0, content)
            record.cursor = offset + len(content)
            record.selection = None
            record.last_modified_at = timestamp
            record.revision += 1
        elif action == "delete":
            existing = self.files.get(str(data.get("file") or ""))
            if existing is not None:
                count = max(0, int(data.get("count") or 0))
                offset = data.get("offset")
                if not isinstance(offset, int):
                    offset = max(0, len(existing.text) - count)
                existing.text = _splice(existing.text, offset, count, "")
                existing.cursor = offset
                existing.selection = None
                existing.last_modified_at = timestamp
                existing.revision += 1
        elif action == "replace":
            record = self._ensure_file(str(data.get("file") or ""), timestamp)
            offset = int(data.get("offset") or 0)
            count = max(0, int(data.get("count") or 0))
            content = data.get("content") or ""
            record.text = _splice(record.text, offset, count, content)
            record.cursor = offset + len(content)
            record.selection = None
            record.last_modified_at = timestamp
            record.revision += 1
        elif action == "cursor":
            existing = self.files.get(str(data.get("file") or ""))
            if existing is not None:
                existing.cursor = int(data.get("offset") or 0)
                existing.selection = None
        elif action == "select":
            existing = self.files.get(str(data.get("file") or ""))
            if existing is not None:
                offset = int(data.get("offset") or 0)
                existing.cursor = offset
                existing.selection = {
                    "start": offset,
                    "length": max(0, int(data.get("length") or 0)),
                }
        elif action == "scroll":
            existing = self.files.get(str(data.get("file") or ""))
            if existing is not None:
                existing.scroll_top = int(data.get("top") or 0)
        elif action == "focus":
            self._open_file(str(data.get("file") or ""), timestamp)
        elif action == "close":
            path = str(data.get("file") or "")
            self.tabs = [tab for tab in self.tabs if tab != path]
            if self.active_file == path:
                self.active_file = self.tabs[-1] if self.tabs else None
        elif action in {"terminal", "terminal.command"}:
            command = data.get("command") or data.get("text") or ""
            if command:
                self._push_terminal_line("command", str(command), timestamp, True)
            self.terminal.open = True
        elif action == "terminal.write":
            text = data.get("text") or ""
            if text:
                kind = "error" if data.get("kind") == "error" else "output"
                self._push_terminal_line(kind, str(text), timestamp, True)
            self.terminal.open = True
        elif action == "terminal.open":
            self.terminal.open = True
        elif action == "terminal.exit":
            exit_code = data.get("exitCode")
            exit_code = int(exit_code) if exit_code is not None else 0
            self.terminal.last_exit_code = exit_code
            if exit_code != 0:
                self._push_terminal_line(
                    "error", f"Process exited with code {exit_code}", timestamp, False
                )
            else:
                self._push_terminal_line("success", "Process exited with code 0", timestamp, False)
        elif action == "build.start":
            self.build = {
                "status": "running",
                "errors": [],
                "startedAt": timestamp,
            }
            if data.get("target"):
                self.build["target"] = data["target"]
        elif action == "build.success":
            self.build = {**self.build, "status": "success", "finishedAt": timestamp}
        elif action == "build.failure":
            self.build = {
                **self.build,
                "status": "failed",
                "finishedAt": timestamp,
                "errors": list(data.get("errors") or []),
            }
        elif action == "test.start":
            self.build = {
                "status": "running",
                "errors": [],
                "startedAt": timestamp,
            }
            if data.get("command"):
                self.build["target"] = data["command"]
        elif action == "test.result":
            failed = int(data.get("failed") or 0)
            self.build = {
                **self.build,
                "status": "failed" if failed > 0 else "success",
                "finishedAt": timestamp,
                "errors": [f"{failed} test(s) failed"] if failed > 0 else [],
            }
        elif action == "error":
            entry = {
                "id": self._next_error_id,
                "timestamp": timestamp,
                "message": data.get("message", ""),
                "resolved": False,
            }
            self._next_error_id += 1
            for key in ("file", "line", "column"):
                if data.get(key) is not None:
                    entry[key] = data[key]
            self.errors.append(entry)
        elif action == "fix":
            entry = {
                "id": self._next_fix_id,
                "timestamp": timestamp,
                "message": data.get("message", ""),
            }
            self._next_fix_id += 1
            if data.get("file"):
                entry["file"] = data["file"]
            self.fixes.append(entry)
            for error in reversed(self.errors):
                if not error["resolved"]:
                    error["resolved"] = True
                    break
        elif action == "dependency.add":
            name = data.get("name") or ""
            if not any(dep["name"] == name for dep in self.dependencies):
                dep: dict[str, Any] = {"name": name, "addedAt": timestamp}
                if data.get("version"):
                    dep["version"] = data["version"]
                if data.get("manager"):
                    dep["manager"] = data["manager"]
                self.dependencies.append(dep)
        elif action == "dependency.remove":
            name = data.get("name") or ""
            self.dependencies = [dep for dep in self.dependencies if dep["name"] != name]

        if action in TIMELINE_ACTIONS:
            timeline_entry = self._build_timeline_entry(data, event_index, timestamp)
            if timeline_entry is not None:
                self.timeline.append(timeline_entry)

    # -- file helpers ------------------------------------------------------

    def _apply_file_create(self, data: dict[str, Any], timestamp: int) -> None:
        path = str(data.get("file") or "")
        if path not in self.files:
            self.file_order.append(path)
            self.touched_files.append(path)
        language = data.get("language") or detect_language(path)
        self.files[path] = FileRecord(
            path=path,
            text="",
            language=language,
            created_at=timestamp,
            last_modified_at=timestamp,
            cursor=0,
            selection=None,
            scroll_top=0,
            revision=0,
        )
        content = data.get("content")
        if isinstance(content, str) and content:
            record = self.files[path]
            record.text = content
            record.revision += 1

    def _apply_file_delete(self, data: dict[str, Any]) -> None:
        path = str(data.get("file") or "")
        self.files.pop(path, None)
        self.tabs = [tab for tab in self.tabs if tab != path]
        if self.active_file == path:
            self.active_file = self.tabs[-1] if self.tabs else None

    def _apply_file_rename(self, data: dict[str, Any]) -> None:
        source = str(data.get("file") or "")
        target = str(data.get("to") or "")
        record = self.files.pop(source, None)
        if record is not None:
            record.path = target
            record.language = detect_language(target)
            self.files[target] = record
            self.file_order = [target if path == source else path for path in self.file_order]
            self.tabs = [target if tab == source else tab for tab in self.tabs]
            if self.active_file == source:
                self.active_file = target

    def _ensure_file(self, path: str, timestamp: int) -> FileRecord:
        record = self.files.get(path)
        if record is None:
            record = FileRecord(
                path=path,
                text="",
                language=detect_language(path),
                created_at=timestamp,
                last_modified_at=timestamp,
                cursor=0,
                selection=None,
                scroll_top=0,
                revision=0,
            )
            self.files[path] = record
            self.file_order.append(path)
            self.touched_files.append(path)
        return record

    def _open_file(self, path: str, timestamp: int) -> None:
        if path not in self.files:
            self._ensure_file(path, timestamp)
        if path not in self.tabs:
            self.tabs.append(path)
        self.active_file = path

    def _push_terminal_line(self, kind: str, text: str, timestamp: int, streamed: bool) -> None:
        line = TerminalLine(
            id=self.terminal.next_id,
            kind=kind,
            text=text,
            timestamp=timestamp,
            streamed=streamed,
        )
        self.terminal.next_id += 1
        self.terminal.lines.append(line)
        if len(self.terminal.lines) > MAX_TERMINAL_LINES:
            del self.terminal.lines[: len(self.terminal.lines) - MAX_TERMINAL_LINES]

    # -- timeline ----------------------------------------------------------

    def _build_timeline_entry(
        self, data: dict[str, Any], event_index: int, timestamp: int
    ) -> dict[str, Any] | None:
        action = str(data.get("action") or "")
        base: dict[str, Any] = {
            "id": event_index,
            "eventIndex": event_index,
            "timestamp": timestamp,
            "action": action,
        }

        def entry(kind: str, label: str, detail: Any = None, file: Any = None) -> dict[str, Any]:
            item = {**base, "kind": kind, "label": label}
            if detail is not None:
                item["detail"] = detail
            if file is not None:
                item["file"] = file
            return item

        if action == "session.start":
            return entry("session", "Session started", data.get("agent"))
        if action == "session.end":
            return entry("session", "Session finished")
        if action == "think":
            return entry("think", "Thinking", data.get("thought"))
        if action == "narrate":
            label = "Decision" if data.get("category") == "decision" else "Note"
            return entry("narration", label, data.get("text"))
        if action == "file.create":
            return entry("file", "Created", data.get("file"), data.get("file"))
        if action == "file.delete":
            return entry("file", "Deleted", data.get("file"), data.get("file"))
        if action == "file.rename":
            return entry(
                "file",
                "Renamed",
                f"{data.get('file')} → {data.get('to')}",
                data.get("to"),
            )
        if action in {"terminal", "terminal.command"}:
            return entry("terminal", "Command", data.get("command") or data.get("text"))
        if action == "terminal.write":
            return entry("terminal", "Output", data.get("text"))
        if action == "terminal.exit":
            return entry("terminal", "Exit", f"code {data.get('exitCode')}")
        if action == "terminal.open":
            return entry("terminal", "Terminal opened")
        if action == "build.start":
            return entry("build", "Build started", data.get("target"))
        if action == "build.success":
            return entry("build", "Build succeeded")
        if action == "build.failure":
            errors = data.get("errors") or []
            return entry("build", "Build failed", "\n".join(errors) if errors else None)
        if action == "test.start":
            return entry("test", "Tests started", data.get("command"))
        if action == "test.result":
            return entry(
                "test",
                "Tests finished",
                f"{data.get('passed', 0)} passed, {data.get('failed', 0)} failed",
            )
        if action == "error":
            return entry("error", "Error", data.get("message"), data.get("file"))
        if action == "fix":
            return entry("fix", "Fixed", data.get("message"), data.get("file"))
        if action == "dependency.add":
            name = str(data.get("name") or "")
            version = data.get("version")
            return entry("dependency", "Added dependency", f"{name}@{version}" if version else name)
        if action == "dependency.remove":
            return entry("dependency", "Removed dependency", data.get("name"))
        if action == "pause":
            return entry("think", "Paused")
        return None

    # -- output ------------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        """JSON-serialisable snapshot (same shape as the frontend reducer)."""
        files = [
            {
                "path": record.path,
                "text": record.text,
                "language": record.language,
                "createdAt": record.created_at,
                "lastModifiedAt": record.last_modified_at,
                "cursor": record.cursor,
                "selection": dict(record.selection) if record.selection else None,
                "scrollTop": record.scroll_top,
                "revision": record.revision,
            }
            for record in self.files.values()
        ]
        build = dict(self.build)
        return {
            "files": files,
            "fileOrder": list(self.file_order),
            "tabs": list(self.tabs),
            "activeFile": self.active_file,
            "terminal": {
                "open": self.terminal.open,
                "lines": [
                    {
                        "id": line.id,
                        "kind": line.kind,
                        "text": line.text,
                        "timestamp": line.timestamp,
                        "streamed": line.streamed,
                    }
                    for line in self.terminal.lines
                ],
                "nextId": self.terminal.next_id,
                "lastExitCode": self.terminal.last_exit_code,
            },
            "narration": [dict(item) for item in self.narration],
            "timeline": [dict(item) for item in self.timeline],
            "dependencies": [dict(item) for item in self.dependencies],
            "build": build,
            "errors": [dict(item) for item in self.errors],
            "fixes": [dict(item) for item in self.fixes],
            "meta": dict(self.meta),
            "consumedEvents": self.consumed_events,
            "touchedFiles": list(self.touched_files),
        }


def fold(events: Iterable[Any], until_ms: int | None = None) -> dict[str, Any]:
    """Fold a stream of events into the session state.

    ``until_ms`` stops the fold at the first event whose timestamp is greater
    than the given value.
    """
    state = SessionState()
    index = 0
    for event in events:
        data = _as_dict(event)
        timestamp = int(data.get("timestamp") or 0)
        if until_ms is not None and timestamp > until_ms:
            break
        state.apply(data, index)
        index += 1
    return state.snapshot()


__all__ = [
    "FileRecord",
    "MAX_TERMINAL_LINES",
    "SessionState",
    "TERMINAL_KINDS",
    "TIMELINE_ACTIONS",
    "fold",
]
