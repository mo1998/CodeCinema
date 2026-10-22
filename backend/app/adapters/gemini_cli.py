"""Gemini CLI adapter — parses ``gemini --output-format json`` transcripts."""

from __future__ import annotations

from typing import Any

from app.adapters.base import AgentAdapter, EventBuilder, chunk_text


class GeminiCliAdapter(AgentAdapter):
    """Normalises Gemini CLI transcripts."""

    name = "gemini-cli"
    display_name = "Gemini CLI"
    capabilities = frozenset({"files", "edits", "terminal", "narration", "streaming"})

    def __init__(self) -> None:
        self._pending: dict[str, str] = {}

    def handle(self, document: Any, builder: EventBuilder) -> None:
        if not isinstance(document, dict):
            return
        kind = document.get("type")
        if kind == "content":
            content = document.get("content")
            if isinstance(content, str) and content.strip():
                builder.narrate(content.strip(), "explanation")
            elif isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and isinstance(part.get("text"), str):
                        builder.narrate(part["text"].strip(), "explanation")
            return
        if kind == "thought":
            thought = document.get("content") or document.get("text")
            if isinstance(thought, str) and thought.strip():
                builder.think(duration=700, thought=thought.strip())
            return
        if kind in {"tool_use", "tool_call"}:
            self._handle_tool(document, builder)
            return
        if kind == "tool_result":
            self._handle_tool_result(document, builder)
            return
        if kind == "stats":
            builder.session_end()
            return
        if kind == "error":
            message = document.get("message") or document.get("error")
            if isinstance(message, str):
                builder.error(message)

    def _handle_tool(self, document: dict[str, Any], builder: EventBuilder) -> None:
        name = _string(document.get("name"))
        arguments = document.get("input") or document.get("args") or document.get("arguments")
        if not isinstance(arguments, dict):
            arguments = {}
        call_id = _string(document.get("callId")) or _string(document.get("id"))

        if name in {"replace", "replace_file", "edit", "edit_file"}:
            path = _path(
                arguments.get("file_path")
                or arguments.get("path")
                or arguments.get("absolute_path")
            )
            old_string = arguments.get("old_string") or arguments.get("oldString")
            new_string = arguments.get("new_string") or arguments.get("newString")
            if not path or not isinstance(old_string, str) or not isinstance(new_string, str):
                return
            builder.focus(path)
            builder.replace(path, 0, len(old_string), new_string)
            return

        if name in {"write_file", "write", "create_file"}:
            path = _path(arguments.get("file_path") or arguments.get("path"))
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

        if name in {"read_file", "read_many_files"}:
            path = _path(arguments.get("file_path") or arguments.get("path"))
            builder.narrate(f"read {path}" if path else "read file", "explanation")
            return

        if name in {"run_shell_command", "shell", "bash"}:
            command = arguments.get("command")
            if not isinstance(command, str) or not command.strip():
                return
            if call_id:
                self._pending[call_id] = "shell"
            builder.terminal_command(command)
            return

        if name in {"glob", "search_file_content", "search", "grep"}:
            pattern = arguments.get("pattern") or arguments.get("query")
            detail = f"{name} {pattern}" if isinstance(pattern, str) and pattern else name
            builder.narrate(detail, "explanation")
            return

        if name:
            builder.narrate(f"tool: {name}", "explanation")

    def _handle_tool_result(self, document: dict[str, Any], builder: EventBuilder) -> None:
        call_id = _string(document.get("callId")) or _string(document.get("id"))
        pending = self._pending.pop(call_id, None) if call_id else None
        output = document.get("output")
        text = output if isinstance(output, str) else _flatten(output)
        if pending == "shell":
            if text:
                builder.terminal_write(text, "output")
            builder.terminal_exit(0)
        elif text:
            builder.narrate(text.strip()[:2000], "explanation")


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
            elif isinstance(item, dict) and isinstance(item.get("output"), str):
                parts.append(item["output"])
        return "\n".join(parts)
    return ""


__all__ = ["GeminiCliAdapter"]
