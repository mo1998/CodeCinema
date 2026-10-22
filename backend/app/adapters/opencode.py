"""OpenCode adapter.

Parses the event stream emitted by the OpenCode server (``/event``) or the
JSON lines printed by the CLI.
"""

from __future__ import annotations

from typing import Any

from app.adapters.base import AgentAdapter, EventBuilder, chunk_text
from app.adapters.diff import parse_unified_diff


class OpenCodeAdapter(AgentAdapter):
    """Normalises OpenCode transcripts."""

    name = "opencode"
    display_name = "OpenCode"
    capabilities = frozenset({"files", "edits", "terminal", "narration", "streaming", "patches"})

    def __init__(self) -> None:
        self._pending: dict[str, str] = {}

    def handle(self, document: Any, builder: EventBuilder) -> None:
        if not isinstance(document, dict):
            return
        kind = document.get("type")
        properties = document.get("properties")
        if not isinstance(properties, dict):
            properties = document
        if kind in {"message.updated", "message.part.updated", "message.completed"}:
            self._handle_message(properties, builder)
        elif kind in {"tool.start", "tool.execute", "tool.execute.start"}:
            self._handle_tool_start(properties, builder)
        elif kind in {"tool.finish", "tool.finish.part"}:
            self._handle_tool_finish(properties, builder)
        elif kind in {"session.error", "error"}:
            message = _string(properties.get("message")) or _string(properties.get("error"))
            if message:
                builder.error(message)
        elif kind in {"session.updated", "session.idle", "session.deleted"}:
            if kind == "session.idle":
                builder.session_end()

    # -- handlers ----------------------------------------------------------

    def _handle_message(self, properties: dict[str, Any], builder: EventBuilder) -> None:
        parts = properties.get("parts")
        if not isinstance(parts, list):
            info = properties.get("info")
            if isinstance(info, dict):
                parts = info.get("parts")
            if not isinstance(parts, list):
                return
        for part in parts:
            if not isinstance(part, dict):
                continue
            part_type = part.get("type")
            if part_type == "text":
                text = part.get("text")
                if isinstance(text, str) and text.strip():
                    builder.narrate(text.strip(), "explanation")
            elif part_type == "reasoning":
                thought = part.get("text") or part.get("reasoning")
                if isinstance(thought, str) and thought.strip():
                    builder.think(duration=700, thought=thought.strip())
            elif part_type == "tool":
                self._handle_tool_part(part, builder)

    def _handle_tool_part(self, part: dict[str, Any], builder: EventBuilder) -> None:
        """Handle a ``tool`` part of a message."""
        tool = _string(part.get("tool")) or _string(part.get("name"))
        state = part.get("state")
        tool_input: dict[str, Any] = {}
        if isinstance(state, dict):
            nested = state.get("input")
            if isinstance(nested, dict):
                tool_input = nested
        if not tool_input:
            nested = part.get("input")
            if isinstance(nested, dict):
                tool_input = nested
        properties = {
            "callID": part.get("callID") or part.get("callId"),
            "callId": part.get("callID") or part.get("callId"),
        }
        self._emit_tool(tool, tool_input, properties, builder, is_start=True)

    def _handle_tool_start(self, properties: dict[str, Any], builder: EventBuilder) -> None:
        tool = _string(properties.get("tool")) or _string(properties.get("name"))
        tool_input = properties.get("input")
        if not isinstance(tool_input, dict):
            tool_input = {}
        state = properties.get("state")
        if isinstance(state, dict) and not tool_input:
            nested = state.get("input")
            if isinstance(nested, dict):
                tool_input = nested
        self._emit_tool(tool, tool_input, properties, builder, is_start=True)

    def _handle_tool_finish(self, properties: dict[str, Any], builder: EventBuilder) -> None:
        call_id = _string(properties.get("callID")) or _string(properties.get("callId"))
        output = _string(properties.get("output"))
        state = properties.get("state")
        if isinstance(state, dict):
            call_id = call_id or _string(state.get("callID"))
            if not output:
                output = _string(state.get("output"))
        if call_id and self._pending.get(call_id) == "bash":
            self._pending.pop(call_id, None)
            if output:
                builder.terminal_write(output, "output")
            builder.terminal_exit(0)

    # -- tool mapping ------------------------------------------------------

    def _emit_tool(
        self,
        tool: str,
        tool_input: dict[str, Any],
        properties: dict[str, Any],
        builder: EventBuilder,
        *,
        is_start: bool,
    ) -> None:
        call_id = _string(properties.get("callID")) or _string(properties.get("callId"))
        name = tool.lower()

        if name in {"write", "writefile", "create"}:
            path = _path(tool_input.get("filePath") or tool_input.get("path"))
            content = tool_input.get("content")
            if not path or not isinstance(content, str):
                return
            builder.file_create(path)
            builder.focus(path)
            offset = 0
            for chunk in chunk_text(content):
                builder.type_text(path, chunk, offset)
                offset += len(chunk)
            return

        if name in {"edit", "editfile", "multiedit", "str_replace", "str_replace_editor"}:
            path = _path(tool_input.get("filePath") or tool_input.get("path"))
            old_string = tool_input.get("oldString") or tool_input.get("old_string")
            new_string = tool_input.get("newString") or tool_input.get("new_string")
            if not path or not isinstance(old_string, str) or not isinstance(new_string, str):
                return
            builder.focus(path)
            builder.replace(path, 0, len(old_string), new_string)
            return

        if name == "patch":
            self._emit_patch(tool_input, builder)
            return

        if name == "bash":
            command = tool_input.get("command")
            if not isinstance(command, str) or not command.strip():
                return
            if call_id:
                self._pending[call_id] = "bash"
            builder.terminal_command(command)
            return

        if name in {"read", "readfile", "list", "glob", "grep"}:
            path = _path(tool_input.get("filePath") or tool_input.get("path"))
            detail = name if not path else f"{name} {path}"
            builder.narrate(detail, "explanation")
            return

        if name == "todowrite":
            todos = tool_input.get("todos")
            if isinstance(todos, list) and todos:
                labels = [
                    _string(item.get("content"))
                    for item in todos
                    if isinstance(item, dict) and _string(item.get("content"))
                ]
                if labels:
                    builder.narrate("Todo: " + "; ".join(labels), "todo")
            return

        if name and is_start:
            builder.narrate(f"tool: {name}", "explanation")

    def _emit_patch(self, tool_input: dict[str, Any], builder: EventBuilder) -> None:
        patch_text = tool_input.get("patch") or tool_input.get("diff")
        if not isinstance(patch_text, str):
            return
        for diff_file in parse_unified_diff(patch_text):
            if not diff_file.path:
                continue
            if diff_file.status == "deleted":
                builder.file_delete(diff_file.path)
                continue
            if diff_file.status == "added":
                builder.file_create(diff_file.path)
                builder.focus(diff_file.path)
                offset = 0
                for chunk in chunk_text(diff_file.added_text):
                    builder.type_text(diff_file.path, chunk, offset)
                    offset += len(chunk)
                continue
            builder.focus(diff_file.path)
            for hunk in diff_file.hunks:
                removed = "".join(hunk.removed)
                added = "".join(hunk.added)
                if removed:
                    builder.replace(diff_file.path, 0, len(removed), added)
                elif added:
                    builder.type_text(diff_file.path, added, 0)


def _string(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _path(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip().replace("\\", "/")


__all__ = ["OpenCodeAdapter"]
