"""Roo Code adapter — parses the extension global storage conversation history.

Roo Code stores ``apiConversationHistory`` — a list of provider messages whose
assistant turns carry ``tool_use`` blocks.
"""

from __future__ import annotations

from typing import Any

from app.adapters.base import AgentAdapter, EventBuilder, chunk_text
from app.adapters.searchreplace import parse_search_replace


class RooCodeAdapter(AgentAdapter):
    """Normalises Roo Code conversation histories."""

    name = "roo-code"
    display_name = "Roo Code"
    capabilities = frozenset({"files", "edits", "terminal", "narration"})

    def handle(self, document: Any, builder: EventBuilder) -> None:
        if not isinstance(document, dict):
            return
        messages = document.get("apiConversationHistory")
        if not isinstance(messages, list):
            messages = document.get("messages")
        if not isinstance(messages, list):
            return
        for message in messages:
            if isinstance(message, dict):
                self._handle_message(message, builder)

    def _handle_message(self, message: dict[str, Any], builder: EventBuilder) -> None:
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
            elif block_type == "tool_use":
                self._handle_tool(block, builder)
            elif block_type == "thinking":
                thought = block.get("thinking") or block.get("text")
                if isinstance(thought, str) and thought.strip():
                    builder.think(duration=700, thought=thought.strip())

    def _handle_tool(self, block: dict[str, Any], builder: EventBuilder) -> None:
        name = _text(block.get("name"))
        arguments = block.get("input")
        if not isinstance(arguments, dict):
            arguments = {}
        path = _path(arguments.get("path") or arguments.get("file_path"))

        if name in {"write_to_file", "write_file", "new_file_created"}:
            content = arguments.get("content")
            if path and isinstance(content, str):
                builder.file_create(path)
                builder.focus(path)
                offset = 0
                for chunk in chunk_text(content):
                    builder.type_text(path, chunk, offset)
                    offset += len(chunk)
            return

        if name in {"editedExistingFile", "edit_file", "apply_diff"}:
            if not path:
                return
            builder.focus(path)
            diff = arguments.get("diff")
            if isinstance(diff, str):
                for pair in parse_search_replace(diff):
                    builder.replace(path, 0, len(pair.old), pair.new)
                return
            old_string = arguments.get("old_string")
            new_string = arguments.get("new_string")
            if isinstance(old_string, str) and isinstance(new_string, str):
                builder.replace(path, 0, len(old_string), new_string)
            return

        if name in {"read_file", "read_many_files"}:
            builder.narrate(f"read {path}" if path else "read file", "explanation")
            return

        if name in {"execute_command", "run_terminal_cmd"}:
            command = arguments.get("command")
            if isinstance(command, str) and command.strip():
                builder.terminal_command(command)
            return

        if name in {"list_files", "search_files", "codebase_search"}:
            builder.narrate(f"tool: {name}", "explanation")
            return

        if name:
            builder.narrate(f"tool: {name}", "explanation")


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _path(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip().replace("\\", "/")


__all__ = ["RooCodeAdapter"]
