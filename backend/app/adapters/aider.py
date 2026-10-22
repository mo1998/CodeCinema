"""Aider adapter.

Aider talks in markdown chat history: prose plus fenced code blocks.  Edits are
expressed as ``SEARCH``/``REPLACE`` blocks, and ``--apply`` output shows plain
unified diffs.  Both are supported.
"""

from __future__ import annotations

import re
from typing import Any

from app.adapters.base import AgentAdapter, EventBuilder, chunk_text
from app.adapters.diff import parse_unified_diff
from app.adapters.searchreplace import parse_search_replace

_PATH_RE = re.compile(r"^[\w./\-]+\.[A-Za-z0-9]+$")


class AiderAdapter(AgentAdapter):
    """Normalises Aider chat history / verbose output."""

    name = "aider"
    display_name = "Aider"
    capabilities = frozenset({"files", "edits", "narration", "diffs"})

    def iter_documents(self, raw: str | dict[str, Any] | list[Any]) -> Any:
        """Aider output is plain text, not JSON."""
        if isinstance(raw, str):
            yield {"__text__": raw}
            return
        yield from super().iter_documents(raw)

    def handle(self, document: Any, builder: EventBuilder) -> None:
        if not isinstance(document, dict):
            return
        text = document.get("__text__")
        if not isinstance(text, str):
            return
        self._handle_text(text, builder)

    # -- parsing -----------------------------------------------------------

    def _handle_text(self, text: str, builder: EventBuilder) -> None:
        sections = _split_sections(text)
        for role, body in sections:
            prose, blocks = _extract_code_blocks(body)
            if prose.strip():
                builder.narrate(prose.strip(), "explanation")
            path: str | None = None
            for block_path, block in blocks:
                path = block_path or path
                self._handle_code_block(path, block, builder)
            if "apply" in role.lower() or "diff" in role.lower():
                continue

    def _handle_code_block(self, path: str | None, block: str, builder: EventBuilder) -> None:
        pairs = parse_search_replace(block)
        if pairs:
            if not path:
                return
            builder.focus(path)
            for pair in pairs:
                builder.replace(path, 0, len(pair.old), pair.new)
            return

        if _looks_like_diff(block):
            self._handle_diff(block, builder)
            return

        if path and block.strip():
            builder.file_create(path)
            builder.focus(path)
            offset = 0
            for chunk in chunk_text(block):
                builder.type_text(path, chunk, offset)
                offset += len(chunk)

    def _handle_diff(self, text: str, builder: EventBuilder) -> None:
        for diff_file in parse_unified_diff(text):
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
            if diff_file.status == "renamed" and diff_file.old_path:
                builder.file_rename(diff_file.old_path, diff_file.path)
                continue
            builder.focus(diff_file.path)
            for hunk in diff_file.hunks:
                removed = "".join(hunk.removed)
                added = "".join(hunk.added)
                if removed:
                    builder.replace(diff_file.path, 0, len(removed), added)
                elif added:
                    builder.type_text(diff_file.path, added, 0)


def _looks_like_diff(text: str) -> bool:
    return "--- " in text and "+++ " in text and "@@" in text


def _split_sections(text: str) -> list[tuple[str, str]]:
    """Split aider chat history into ``(role, body)`` sections."""
    sections: list[tuple[str, str]] = []
    role = "assistant"
    buffer: list[str] = []
    for line in text.splitlines():
        if line.startswith("#### "):
            sections.append((role, "\n".join(buffer)))
            role = line[5:].strip() or "assistant"
            buffer = []
            continue
        buffer.append(line)
    sections.append((role, "\n".join(buffer)))
    return sections


def _extract_code_blocks(body: str) -> tuple[str, list[tuple[str | None, str]]]:
    """Split a body into prose and fenced code blocks.

    The path of a block is taken from the last standalone path-looking line
    before the fence (that is how aider names the file it is about to edit).
    """
    prose_lines: list[str] = []
    blocks: list[tuple[str | None, str]] = []
    last_path: str | None = None
    lines = body.splitlines()
    index = 0
    total = len(lines)
    while index < total:
        line = lines[index]
        if line.strip().startswith("```"):
            content: list[str] = []
            index += 1
            while index < total and not lines[index].strip().startswith("```"):
                content.append(lines[index])
                index += 1
            index += 1
            blocks.append((last_path, "\n".join(content) + "\n"))
            continue
        stripped = line.strip()
        if stripped and _PATH_RE.match(stripped) and " " not in stripped:
            last_path = stripped
        else:
            prose_lines.append(line)
        index += 1
    return "\n".join(prose_lines), blocks


__all__ = ["AiderAdapter"]
