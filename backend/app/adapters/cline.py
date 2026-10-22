"""Cline adapter — parses VS Code extension task history JSON.

Cline stores its tasks in the extension global storage as
``tasks/<id>.json`` with a ``history`` array of ``say`` / ``ask`` / ``tool``
records.
"""

from __future__ import annotations

from typing import Any

from app.adapters.base import AgentAdapter, EventBuilder, chunk_text
from app.adapters.searchreplace import parse_search_replace


class ClineAdapter(AgentAdapter):
    """Normalises Cline task histories."""

    name = "cline"
    display_name = "Cline"
    capabilities = frozenset({"files", "edits", "terminal", "narration"})

    def handle(self, document: Any, builder: EventBuilder) -> None:
        if not isinstance(document, dict):
            return
        history = document.get("history")
        if not isinstance(history, list):
            # A list of task objects is handled by the registry-level splitter.
            return
        for record in history:
            if isinstance(record, dict):
                self._handle_record(record, builder)

    # -- record handling ---------------------------------------------------

    def _handle_record(self, record: dict[str, Any], builder: EventBuilder) -> None:
        record_type = record.get("type")
        if record_type == "say":
            text = _text(record.get("text"))
            if text:
                builder.narrate(text, "explanation")
            return
        if record_type == "ask":
            text = _text(record.get("text"))
            if text:
                builder.narrate(text, "decision")
            return
        if record_type != "tool":
            return

        tool = _text(record.get("tool"))
        path = _path(record.get("path"))
        content = record.get("content")
        diff = record.get("diff")

        if tool in {"newFile", "createFile"}:
            if path and isinstance(content, str):
                builder.file_create(path)
                builder.focus(path)
                offset = 0
                for chunk in chunk_text(content):
                    builder.type_text(path, chunk, offset)
                    offset += len(chunk)
            return

        if tool in {"editExistingFile", "applyDiff"}:
            if not path:
                return
            builder.focus(path)
            if isinstance(diff, str):
                for pair in parse_search_replace(diff):
                    builder.replace(path, 0, len(pair.old), pair.new)
            elif isinstance(content, str):
                builder.replace(path, 0, len(content), content)
            return

        if tool in {"readFile"}:
            builder.narrate(f"read {path}" if path else "read file", "explanation")
            return

        if tool in {"executeCommand", "runCommand"}:
            command = _text(record.get("command"))
            if command:
                builder.terminal_command(command)
            return

        if tool:
            builder.narrate(f"tool: {tool}", "explanation")


def _text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    return ""


def _path(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip().replace("\\", "/")


__all__ = ["ClineAdapter"]
