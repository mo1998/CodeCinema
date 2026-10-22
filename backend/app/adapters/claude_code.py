"""Claude Code adapter.

Parses ``claude --output-format stream-json`` transcripts: one JSON object per
line with ``type`` in ``{system, assistant, user, result}``.
"""

from __future__ import annotations

from typing import Any

from app.adapters.base import AgentAdapter, EventBuilder, chunk_text

_BASH_TOOLS = {"bash", "bashoutput", "killbash", "run_command"}


class ClaudeCodeAdapter(AgentAdapter):
    """Normalises Claude Code transcripts."""

    name = "claude-code"
    display_name = "Claude Code"
    capabilities = frozenset(
        {
            "files",
            "edits",
            "terminal",
            "thinking",
            "narration",
            "streaming",
            "dependencies",
        }
    )

    def __init__(self) -> None:
        # tool_use_id -> "bash" | "file" | "read"
        self._pending: dict[str, str] = {}

    # -- entry point -------------------------------------------------------

    def handle(self, document: Any, builder: EventBuilder) -> None:
        if not isinstance(document, dict):
            return
        kind = document.get("type")
        if kind == "assistant":
            self._handle_assistant(document, builder)
        elif kind == "user":
            self._handle_user(document, builder)
        elif kind == "result":
            self._handle_result(document, builder)
        # `system` and unknown types are ignored on purpose.

    # -- handlers ----------------------------------------------------------

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
            elif block_type == "thinking":
                thought = block.get("thinking") or block.get("text")
                if isinstance(thought, str) and thought.strip():
                    builder.think(duration=800, thought=thought.strip())
            elif block_type == "tool_use":
                self._handle_tool_use(block, builder)

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
            if block.get("type") != "tool_result":
                continue
            tool_id = str(block.get("tool_use_id") or "")
            pending = self._pending.pop(tool_id, None)
            text = _flatten_text(block.get("content"))
            if pending == "bash":
                if text:
                    kind = "error" if block.get("is_error") else "output"
                    builder.terminal_write(text, kind)
                builder.terminal_exit(1 if block.get("is_error") else 0)

    def _handle_result(self, document: dict[str, Any], builder: EventBuilder) -> None:
        duration_ms = document.get("duration_ms")
        summary = document.get("result")
        builder.session_end(
            duration_ms=int(duration_ms) if isinstance(duration_ms, (int, float)) else None,
            summary=summary if isinstance(summary, str) else None,
        )

    # -- tool mapping ------------------------------------------------------

    def _handle_tool_use(self, block: dict[str, Any], builder: EventBuilder) -> None:
        tool_name = str(block.get("name") or "")
        tool_input = block.get("input")
        if not isinstance(tool_input, dict):
            tool_input = {}
        tool_id = str(block.get("id") or "")

        if tool_name in {"Write", "Create"}:
            path = _normalise_path(tool_input.get("file_path") or tool_input.get("path"))
            content = tool_input.get("content")
            if not path or not isinstance(content, str):
                return
            self._pending[tool_id] = "file"
            builder.file_create(path)
            builder.focus(path)
            offset = 0
            for chunk in chunk_text(content):
                builder.type_text(path, chunk, offset)
                offset += len(chunk)
            return

        if tool_name == "Edit":
            path = _normalise_path(tool_input.get("file_path") or tool_input.get("path"))
            old_string = tool_input.get("old_string")
            new_string = tool_input.get("new_string")
            if not path or not isinstance(old_string, str) or not isinstance(new_string, str):
                return
            self._pending[tool_id] = "file"
            builder.focus(path)
            builder.replace(path, 0, len(old_string), new_string)
            offset = 0
            for chunk in chunk_text(new_string):
                builder.type_text(path, chunk, offset)
                offset += len(chunk)
            return

        if tool_name == "MultiEdit":
            path = _normalise_path(tool_input.get("file_path") or tool_input.get("path"))
            edits = tool_input.get("edits")
            if not path or not isinstance(edits, list):
                return
            self._pending[tool_id] = "file"
            builder.focus(path)
            for edit in edits:
                if not isinstance(edit, dict):
                    continue
                old_string = edit.get("old_string")
                new_string = edit.get("new_string")
                if not isinstance(old_string, str) or not isinstance(new_string, str):
                    continue
                builder.replace(path, 0, len(old_string), new_string)
            return

        if tool_name == "NotebookEdit":
            path = _normalise_path(tool_input.get("notebook_path") or tool_input.get("file_path"))
            new_source = tool_input.get("new_source")
            if not path or not isinstance(new_source, str):
                return
            self._pending[tool_id] = "file"
            builder.file_create(path, "jupyter")
            builder.focus(path)
            offset = 0
            for chunk in chunk_text(new_source):
                builder.type_text(path, chunk, offset)
                offset += len(chunk)
            return

        if tool_name.lower() in _BASH_TOOLS:
            command = tool_input.get("command")
            if not isinstance(command, str) or not command.strip():
                return
            self._pending[tool_id] = "bash"
            builder.terminal_command(command)
            return

        if tool_name in {"Read", "Grep", "Glob", "LS", "WebFetch", "WebSearch", "Task"}:
            path = _normalise_path(tool_input.get("file_path") or tool_input.get("path"))
            detail = tool_name
            if path:
                detail = f"{tool_name} {path}"
            builder.narrate(detail, "explanation")
            return
        # Unknown tools are ignored.

    # -- helpers -----------------------------------------------------------

    def new_builder(self, session_id: str) -> EventBuilder:
        """Fresh builder (used by tests)."""
        return EventBuilder(session_id=session_id)


def _normalise_path(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    path = value.strip()
    if not path:
        return ""
    return path.replace("\\", "/")


def _flatten_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts)
    return ""


__all__ = ["ClaudeCodeAdapter"]
