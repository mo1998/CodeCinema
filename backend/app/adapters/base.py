"""Canonical event model and adapter base classes.

This module is the Python projection of ``frontend/lib/engine/events.ts``.
Both sides are validated against ``shared/schemas/event.schema.json`` so the
two can never drift.

Design rules (identical to the TypeScript projection):

* ``timestamp`` is milliseconds since ``session.start`` (t = 0) and is
  monotonic non-decreasing across a session.
* Events are the *only* source of truth — playback state is a pure fold over
  them.
* Unknown extra properties are preserved (they may carry adapter detail).
"""

from __future__ import annotations

import hashlib
import json
import random
import time
from abc import ABC, abstractmethod
from collections.abc import Callable, Iterable, Iterator
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# --------------------------------------------------------------------------
# Enumerations (mirrors of the TypeScript unions)
# --------------------------------------------------------------------------

EventAction = Literal[
    "session.start",
    "session.end",
    "think",
    "narrate",
    "file.create",
    "file.delete",
    "file.rename",
    "type",
    "insert",
    "delete",
    "replace",
    "cursor",
    "select",
    "scroll",
    "focus",
    "close",
    "pause",
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
]

EVENT_ACTIONS: tuple[str, ...] = (
    "session.start",
    "session.end",
    "think",
    "narrate",
    "file.create",
    "file.delete",
    "file.rename",
    "type",
    "insert",
    "delete",
    "replace",
    "cursor",
    "select",
    "scroll",
    "focus",
    "close",
    "pause",
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
)

Actor = Literal["agent", "human", "system", "tool"]

NarrationCategory = Literal["explanation", "decision", "warning", "summary", "todo"]

NARRATION_CATEGORIES: tuple[str, ...] = (
    "explanation",
    "decision",
    "warning",
    "summary",
    "todo",
)

DependencyManager = Literal[
    "npm",
    "pnpm",
    "yarn",
    "pip",
    "poetry",
    "cargo",
    "go",
    "maven",
    "gradle",
    "gem",
    "composer",
]


class TypingProfile(BaseModel):
    """Hints for the human-like typing simulator (camelCase on the wire)."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    cps: float | None = Field(default=None, gt=0)
    jitter: float | None = Field(default=None, ge=0, le=1)
    punctuation_pause_ms: int | None = Field(default=None, ge=0, alias="punctuationPauseMs")
    newline_pause_ms: int | None = Field(default=None, ge=0, alias="newlinePauseMs")
    indent_pause_ms: int | None = Field(default=None, ge=0, alias="indentPauseMs")
    keyword_pause_ms: int | None = Field(default=None, ge=0, alias="keywordPauseMs")


class SessionEvent(BaseModel):
    """One canonical event.

    All action specific fields are optional on the model — the JSON Schema
    enforces which ones are *required* per action.
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    timestamp: int = Field(ge=0)
    action: EventAction
    seq: int | None = Field(default=None, ge=0)
    actor: Actor = "agent"
    id: str | None = None

    # session.start / session.end
    title: str | None = None
    agent: str | None = None
    prompt: str | None = None
    repo: str | None = None
    model: str | None = None
    duration_ms: int | None = Field(default=None, alias="durationMs")
    summary: str | None = None

    # think / narrate / pause
    duration: int | None = None
    thought: str | None = None
    text: str | None = None
    category: NarrationCategory | None = None

    # file operations
    file: str | None = None
    language: str | None = None
    to: str | None = None
    content: str | None = None
    offset: int | None = None
    profile: TypingProfile | None = None
    count: int | None = None
    length: int | None = None
    top: int | None = None

    # terminal
    command: str | None = None
    exit_code: int | None = Field(default=None, alias="exitCode")
    kind: str | None = None

    # build / test
    target: str | None = None
    errors: list[str] | None = None
    passed: int | None = None
    failed: int | None = None

    # error / fix
    message: str | None = None
    line: int | None = None
    column: int | None = None

    # dependencies
    name: str | None = None
    version: str | None = None
    manager: DependencyManager | None = None

    def to_dict(self) -> dict[str, Any]:
        """JSON-serialisable representation (camelCase aliases, no ``None``s)."""
        return self.model_dump(mode="json", by_alias=True, exclude_none=True)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SessionEvent:
        """Validate a raw mapping into a :class:`SessionEvent`."""
        return cls.model_validate(data)


# --------------------------------------------------------------------------
# Event builder
# --------------------------------------------------------------------------

DEFAULT_TYPING_PROFILE = TypingProfile.model_validate(
    {
        "cps": 7.5,
        "jitter": 0.35,
        "punctuationPauseMs": 90,
        "newlinePauseMs": 160,
        "indentPauseMs": 120,
        "keywordPauseMs": 320,
    }
)


class EventBuilder:
    """Fluent emitter for canonical events.

    The builder owns the clock: every emitted event gets a monotonically
    non-decreasing timestamp expressed in milliseconds since the first event.
    A clock and an RNG can be injected, which makes the output deterministic
    for tests.
    """

    def __init__(
        self,
        *,
        session_id: str | None = None,
        clock: Callable[[], float] | None = None,
        rng: random.Random | None = None,
        actor: Actor = "agent",
        base_timestamp: int = 0,
        pacing: bool = True,
    ) -> None:
        self._clock = clock or time.monotonic
        self._rng = rng if rng is not None else random.Random()
        self._session_id = session_id
        self._actor = actor
        self._base = max(0, int(base_timestamp))
        self._pacing = pacing
        self._start = self._clock()
        self._offset_ms = 0
        self._last_timestamp = 0
        self._events: list[SessionEvent] = []

    # -- internals ---------------------------------------------------------

    @property
    def events(self) -> list[SessionEvent]:
        """Events emitted so far."""
        return list(self._events)

    def _event_id(self, action: str) -> str:
        digest = hashlib.sha1(
            f"{self._session_id}:{len(self._events)}:{action}".encode()
        ).hexdigest()
        return f"ev_{digest[:20]}"

    def _tick(self) -> int:
        elapsed = int(round((self._clock() - self._start) * 1000))
        timestamp = self._base + elapsed + self._offset_ms
        if timestamp < self._last_timestamp:
            timestamp = self._last_timestamp
        self._last_timestamp = timestamp
        return timestamp

    def advance(self, ms: int) -> int:
        """Force the timeline forward by ``ms`` milliseconds."""
        self._offset_ms += max(0, int(ms))
        return self._tick()

    def discard_from(self, index: int) -> None:
        """Drop every event emitted after ``index`` (used on adapter failures)."""
        if 0 <= index < len(self._events):
            del self._events[index:]

    def _emit(
        self,
        action: EventAction,
        payload: dict[str, Any],
        *,
        actor: Actor | None = None,
        gap_ms: int | None = None,
    ) -> SessionEvent:
        if gap_ms is None:
            gap_ms = self._rng.randint(120, 800) if self._pacing else 0
        if gap_ms:
            self._offset_ms += gap_ms
        data: dict[str, Any] = {
            "timestamp": self._tick(),
            "action": action,
            "actor": actor or self._actor,
        }
        if self._session_id:
            data["id"] = self._event_id(action)
        data.update({key: value for key, value in payload.items() if value is not None})
        event = SessionEvent.model_validate(data)
        self._events.append(event)
        return event

    # -- session -----------------------------------------------------------

    def session_start(
        self,
        *,
        title: str | None = None,
        agent: str | None = None,
        prompt: str | None = None,
        repo: str | None = None,
        model: str | None = None,
    ) -> SessionEvent:
        """Emit ``session.start``."""
        return self._emit(
            "session.start",
            {
                "title": title,
                "agent": agent,
                "prompt": prompt,
                "repo": repo,
                "model": model,
            },
            gap_ms=0,
        )

    def session_end(
        self, *, duration_ms: int | None = None, summary: str | None = None
    ) -> SessionEvent:
        """Emit ``session.end``."""
        return self._emit("session.end", {"duration_ms": duration_ms, "summary": summary})

    # -- narration ---------------------------------------------------------

    def think(self, duration: int = 0, thought: str | None = None) -> SessionEvent:
        """Emit a ``think`` event."""
        return self._emit("think", {"duration": max(0, int(duration)), "thought": thought})

    def narrate(self, text: str, category: NarrationCategory = "explanation") -> SessionEvent:
        """Emit a ``narrate`` event."""
        return self._emit("narrate", {"text": text, "category": category})

    def pause(self, duration: int) -> SessionEvent:
        """Emit a ``pause`` event."""
        return self._emit("pause", {"duration": max(0, int(duration))})

    # -- files -------------------------------------------------------------

    def file_create(self, path: str, language: str | None = None) -> SessionEvent:
        """Emit ``file.create``."""
        return self._emit("file.create", {"file": path, "language": language})

    def file_delete(self, path: str) -> SessionEvent:
        """Emit ``file.delete``."""
        return self._emit("file.delete", {"file": path})

    def file_rename(self, from_path: str, to_path: str) -> SessionEvent:
        """Emit ``file.rename``."""
        return self._emit("file.rename", {"file": from_path, "to": to_path})

    def type_text(
        self,
        path: str,
        content: str,
        offset: int | None = None,
        profile: TypingProfile | None = None,
    ) -> SessionEvent:
        """Emit a progressive ``type`` event."""
        return self._emit(
            "type",
            {
                "file": path,
                "content": content,
                "offset": offset,
                "profile": profile.model_dump(by_alias=True, exclude_none=True)
                if profile
                else None,
            },
        )

    def insert(self, path: str, content: str, offset: int) -> SessionEvent:
        """Emit an atomic ``insert`` event."""
        return self._emit("insert", {"file": path, "content": content, "offset": int(offset)})

    def delete_chars(self, path: str, count: int, offset: int | None = None) -> SessionEvent:
        """Emit a ``delete`` event removing ``count`` characters."""
        return self._emit("delete", {"file": path, "count": max(0, int(count)), "offset": offset})

    def replace(self, path: str, offset: int, count: int, content: str) -> SessionEvent:
        """Emit a ``replace`` event."""
        return self._emit(
            "replace",
            {
                "file": path,
                "offset": max(0, int(offset)),
                "count": max(0, int(count)),
                "content": content,
            },
        )

    def cursor(self, path: str, offset: int) -> SessionEvent:
        """Emit a ``cursor`` event."""
        return self._emit("cursor", {"file": path, "offset": max(0, int(offset))})

    def select(self, path: str, offset: int, length: int) -> SessionEvent:
        """Emit a ``select`` event."""
        return self._emit(
            "select", {"file": path, "offset": max(0, int(offset)), "length": max(0, int(length))}
        )

    def scroll(self, path: str, top: int) -> SessionEvent:
        """Emit a ``scroll`` event."""
        return self._emit("scroll", {"file": path, "top": max(0, int(top))})

    def focus(self, path: str) -> SessionEvent:
        """Emit a ``focus`` event."""
        return self._emit("focus", {"file": path})

    def close(self, path: str) -> SessionEvent:
        """Emit a ``close`` event."""
        return self._emit("close", {"file": path})

    # -- terminal ----------------------------------------------------------

    def terminal_open(self) -> SessionEvent:
        """Emit ``terminal.open``."""
        return self._emit("terminal.open", {})

    def terminal_command(self, cmd: str) -> SessionEvent:
        """Emit ``terminal.command``."""
        return self._emit("terminal.command", {"command": cmd})

    def terminal_write(self, text: str, kind: str = "output") -> SessionEvent:
        """Emit ``terminal.write``."""
        return self._emit("terminal.write", {"text": text, "kind": kind})

    def terminal_exit(self, code: int) -> SessionEvent:
        """Emit ``terminal.exit``."""
        return self._emit("terminal.exit", {"exit_code": int(code)})

    # -- build / test ------------------------------------------------------

    def build_start(self, target: str | None = None) -> SessionEvent:
        """Emit ``build.start``."""
        return self._emit("build.start", {"target": target})

    def build_success(self, duration_ms: int | None = None) -> SessionEvent:
        """Emit ``build.success``."""
        return self._emit("build.success", {"duration_ms": duration_ms})

    def build_failure(
        self, errors: list[str] | None = None, duration_ms: int | None = None
    ) -> SessionEvent:
        """Emit ``build.failure``."""
        return self._emit("build.failure", {"errors": errors or [], "duration_ms": duration_ms})

    def test_start(self, cmd: str | None = None) -> SessionEvent:
        """Emit ``test.start``."""
        return self._emit("test.start", {"command": cmd})

    def test_result(self, passed: int, failed: int, duration_ms: int | None = None) -> SessionEvent:
        """Emit ``test.result``."""
        return self._emit(
            "test.result",
            {
                "passed": max(0, int(passed)),
                "failed": max(0, int(failed)),
                "duration_ms": duration_ms,
            },
        )

    # -- problems ----------------------------------------------------------

    def error(self, message: str, file: str | None = None, line: int | None = None) -> SessionEvent:
        """Emit an ``error`` event."""
        return self._emit("error", {"message": message, "file": file, "line": line})

    def fix(self, message: str, file: str | None = None) -> SessionEvent:
        """Emit a ``fix`` event."""
        return self._emit("fix", {"message": message, "file": file})

    # -- dependencies ------------------------------------------------------

    def dependency_add(
        self,
        name: str,
        version: str | None = None,
        manager: DependencyManager | None = None,
    ) -> SessionEvent:
        """Emit ``dependency.add``."""
        return self._emit("dependency.add", {"name": name, "version": version, "manager": manager})

    def dependency_remove(
        self, name: str, manager: DependencyManager | None = None
    ) -> SessionEvent:
        """Emit ``dependency.remove``."""
        return self._emit("dependency.remove", {"name": name, "manager": manager})

    # -- output ------------------------------------------------------------

    def build(self) -> list[SessionEvent]:
        """Return every event emitted so far."""
        return list(self._events)


# --------------------------------------------------------------------------
# Adapter base
# --------------------------------------------------------------------------


#: Default number of characters per progressive ``type`` event.
TYPE_CHUNK_SIZE = 120


def chunk_text(text: str, size: int = TYPE_CHUNK_SIZE) -> list[str]:
    """Split ``text`` into chunks of at most ``size`` characters."""
    if not text:
        return []
    size = max(1, size)
    return [text[index : index + size] for index in range(0, len(text), size)]


def iter_json_documents(text: str) -> Iterator[Any]:
    """Yield JSON documents from NDJSON or concatenated JSON text.

    Malformed fragments are skipped instead of raising — agent transcripts are
    noisy and a truncated line must not kill the whole ingest.
    """
    decoder = json.JSONDecoder()
    index = 0
    length = len(text)
    while index < length:
        while index < length and text[index] in " \t\r\n":
            index += 1
        if index >= length:
            return
        try:
            value, end = decoder.raw_decode(text, index)
        except json.JSONDecodeError:
            newline = text.find("\n", index)
            if newline == -1:
                return
            index = newline + 1
            continue
        yield value
        index = end


class AgentAdapter(ABC):
    """Base class for every agent transcript adapter."""

    name: str = "abstract"
    display_name: str = "Abstract agent"
    capabilities: frozenset[str] = frozenset()

    # -- public API --------------------------------------------------------

    def parse(
        self, raw: str | dict[str, Any] | list[Any], *, session_id: str
    ) -> list[SessionEvent]:
        """Parse a complete transcript into canonical events."""
        builder = EventBuilder(session_id=session_id)
        events: list[SessionEvent] = []
        for document in self.iter_documents(raw):
            events.extend(self._handle_document(document, builder))
        return events

    def parse_stream(self, chunks: Iterable[str], *, session_id: str) -> Iterator[SessionEvent]:
        """Parse a streamed transcript, yielding events as they are decoded."""
        builder = EventBuilder(session_id=session_id)
        for document in self.iter_stream_documents(chunks):
            yield from self._handle_document(document, builder)

    # -- helpers -----------------------------------------------------------

    def iter_documents(self, raw: str | dict[str, Any] | list[Any]) -> Iterator[Any]:
        """Normalise raw input into a stream of JSON-ish documents."""
        if isinstance(raw, str):
            yield from iter_json_documents(raw)
        elif isinstance(raw, dict):
            yield raw
        elif isinstance(raw, list):
            for item in raw:
                if isinstance(item, (dict, list)):
                    yield item
        # Anything else is silently ignored.

    def iter_stream_documents(self, chunks: Iterable[str]) -> Iterator[Any]:
        """Decode a chunked transcript into documents.

        Handles both newline delimited JSON and a single JSON document spread
        over several chunks.
        """
        buffer = ""
        decoder = json.JSONDecoder()
        for chunk in chunks:
            if not chunk:
                continue
            buffer += chunk
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    for document in iter_json_documents(line):
                        yield document
            stripped = buffer.strip()
            if stripped:
                try:
                    document, end = decoder.raw_decode(stripped)
                except json.JSONDecodeError:
                    continue
                buffer = stripped[end:]
                yield document

    def _handle_document(self, document: Any, builder: EventBuilder) -> list[SessionEvent]:
        """Subclass hook: turn one document into events."""
        before = len(builder.events)
        try:
            self.handle(document, builder)
        except Exception:  # noqa: BLE001 - adapters must never be fatal
            builder.discard_from(before)
            return []
        return builder.events[before:]

    @abstractmethod
    def handle(self, document: Any, builder: EventBuilder) -> None:
        """Handle a single transcript document.

        Implementations must be tolerant: unknown shapes are ignored.
        """


__all__ = [
    "Actor",
    "DEFAULT_TYPING_PROFILE",
    "DependencyManager",
    "EVENT_ACTIONS",
    "EventAction",
    "EventBuilder",
    "NARRATION_CATEGORIES",
    "NarrationCategory",
    "SessionEvent",
    "TYPE_CHUNK_SIZE",
    "TypingProfile",
    "AgentAdapter",
    "chunk_text",
    "iter_json_documents",
]
