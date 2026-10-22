"""Generic adapter — turns a unified diff into canonical events.

This is the fallback used when no agent-specific transcript format matches.
"""

from __future__ import annotations

from typing import Any

from app.adapters.base import AgentAdapter, EventBuilder, chunk_text
from app.adapters.diff import parse_unified_diff


class GenericAdapter(AgentAdapter):
    """Normalises plain git / unified diffs."""

    name = "generic"
    display_name = "Generic diff"
    capabilities = frozenset({"files", "edits", "diffs"})

    def iter_documents(self, raw: str | dict[str, Any] | list[Any]) -> Any:
        """Accept raw diff text as well as JSON."""
        if isinstance(raw, str):
            if raw.lstrip().startswith("{") or raw.lstrip().startswith("["):
                yield from super().iter_documents(raw)
            else:
                yield {"__diff__": raw}
            return
        yield from super().iter_documents(raw)

    def handle(self, document: Any, builder: EventBuilder) -> None:
        if not isinstance(document, dict):
            return
        diff_text = document.get("__diff__")
        if isinstance(diff_text, str):
            self._handle_diff(diff_text, builder)
            return
        files = document.get("files")
        if isinstance(files, list):
            for item in files:
                if isinstance(item, dict) and isinstance(item.get("patch"), str):
                    self._handle_diff(item["patch"], builder)

    def _handle_diff(self, text: str, builder: EventBuilder) -> None:
        for diff_file in parse_unified_diff(text):
            if not diff_file.path:
                continue
            if diff_file.status == "deleted":
                builder.file_delete(diff_file.path)
                continue
            if diff_file.status == "renamed" and diff_file.old_path:
                builder.file_rename(diff_file.old_path, diff_file.path)
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


__all__ = ["GenericAdapter"]
