"""Cursor adapter — parses ``cursor-agent --output-format stream-json``."""

from __future__ import annotations

from typing import Any

from app.adapters.base import AgentAdapter, EventBuilder, chunk_text

_FILE_TOOLS = {"edit_file", "write_file", "delete_file", "read_file"}
_SEARCH_TOOLS = {"codebase_search", "grep", "search", "list_dir"}


class CursorAdapter(AgentAdapter):
    """Normalises Cursor Agent transcripts."""

    name = "cursor"
    display_name = "Cursor Agent"
    capabilities = frozenset({"files", "edits", "terminal", "narration", "streaming"})

    def __init__(self) -> None:
        self._pending: dict[str, str] = {}

    def handle(self, document: Any, builder: EventBuilder) -> None:
        if not isinstance(document, dict):
            return
        kind = document.get("type")
        if kind == "assistant":
            self._handle_assistant(document, builder)
        elif kind == "user":
            self._handle_user(document, builder)
        elif kind == "result":
            duration = document.get("duration_ms") or document.get("durationMs")
            builder.session_end(
                duration_ms=int(duration) if isinstance(duration, (int, float)) else None,
                summary=_string(document.get("result")) or None,
            )

    def _handle_assistant(self, document: dict[str, Any], builder: EventBuilder) -> None:
        message = document.get("message")
        if not isinstance(message, dict):
            return
        content = message.get("content")
        if isinstance(content, str):
            if content.strip():
                builder.narrate(content.strip(), "explanation")
            return
        if not isinstance(content, list):
            return
        for block in content:
            if not isinstance(block, dict):
                continue
            block_type = block.get("type")
            if block_type == "text":
                text = block.get("text")
                if isinstance(text, str) and text.strip():
                    builder.narrate(text.strip(), "explanation")
            elif block_type in {"tool_call", "tool_use", "function_call"}:
                self._handle_tool_call(block, builder)

    def _handle_user(self, document: dict[str, Any], builder: EventBuilder) -> None:
        message = document.get("message")
        if not isinstance(message, dict):
            return
        content = message.get("content")
        if not isinstance(content, list):
            return
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") not in {"tool_result", "tool_output"}:
                continue
            call_id = _string(block.get("call_id")) or _string(block.get("tool_use_id"))
            pending = self._pending.pop(call_id, None)
            text = _flatten(block.get("content"))
            if pending == "terminal":
                if text:
                    builder.terminal_write(text, "output")
                builder.terminal_exit(0)

    def _handle_tool_call(self, block: dict[str, Any], builder: EventBuilder) -> None:
        name = _string(block.get("name")) or _string(block.get("tool_name"))
        arguments = block.get("arguments") or block.get("input") or block.get("args")
        if not isinstance(arguments, dict):
            arguments = {}
        call_id = _string(block.get("call_id")) or _string(block.get("id"))

        if name == "edit_file":
            path = _path(arguments.get("path") or arguments.get("file_path"))
            old_string = arguments.get("old_string") or arguments.get("oldString")
            new_string = arguments.get("new_string") or arguments.get("newString")
            if not path or not isinstance(old_string, str) or not isinstance(new_string, str):
                return
            builder.focus(path)
            builder.replace(path, 0, len(old_string), new_string)
            return

        if name == "write_file":
            path = _path(arguments.get("path") or arguments.get("file_path"))
            content = arguments.get("content")
            if not path or not isinstance(content, str):
                return
            builder.file_create(path)
            builder.focus(path)
            offset = 0
            for chunk in chunk_text(content):
                builder.type_text(path, chunk, offset)
                offset += len(chunk)
            return

        if name == "delete_file":
            path = _path(arguments.get("path") or arguments.get("file_path"))
            if path:
                builder.file_delete(path)
            return

        if name == "run_terminal_cmd":
            command = arguments.get("command") or arguments.get("cmd")
            if not isinstance(command, str) or not command.strip():
                return
            if call_id:
                self._pending[call_id] = "terminal"
            builder.terminal_command(command)
            return

        if name in _SEARCH_TOOLS:
            query = arguments.get("query") or arguments.get("pattern") or arguments.get("path")
            detail = f"{name}"
            if isinstance(query, str) and query:
                detail = f"{name} {query}"
            builder.narrate(detail, "explanation")
            return

        if name in {"read_file"}:
            path = _path(arguments.get("path") or arguments.get("file_path"))
            builder.narrate(f"read {path}" if path else "read file", "explanation")
            return

        if name:
            builder.narrate(f"tool: {name}", "explanation")


def _string(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _path(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip().replace("\\", "/")


def _flatten(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
        return "\n".join(parts)
    return ""


__all__ = ["CursorAdapter"]
