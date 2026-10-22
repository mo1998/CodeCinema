"""Parsing of aider/cline style ``SEARCH``/``REPLACE`` blocks."""

from __future__ import annotations

from dataclasses import dataclass

_SEARCH_MARKER = "<<<<<<< SEARCH"
_SEPARATOR = "======="
_REPLACE_MARKER = ">>>>>>> REPLACE"


@dataclass(frozen=True)
class SearchReplace:
    """One searched-for / replaced-with pair."""

    old: str
    new: str


def parse_search_replace(text: str) -> list[SearchReplace]:
    """Extract every ``SEARCH``/``REPLACE`` pair from ``text``.

    Unterminated blocks are ignored.
    """
    if not text:
        return []
    lines = text.splitlines(keepends=True)
    pairs: list[SearchReplace] = []
    index = 0
    total = len(lines)
    while index < total:
        if lines[index].strip().startswith(_SEARCH_MARKER):
            index += 1
            old_lines: list[str] = []
            while index < total and lines[index].strip() != _SEPARATOR:
                old_lines.append(lines[index])
                index += 1
            if index >= total:
                break
            index += 1
            new_lines: list[str] = []
            while index < total and not lines[index].strip().startswith(_REPLACE_MARKER):
                new_lines.append(lines[index])
                index += 1
            index += 1  # consume the REPLACE marker
            pairs.append(SearchReplace(old="".join(old_lines), new="".join(new_lines)))
            continue
        index += 1
    return pairs


__all__ = ["SearchReplace", "parse_search_replace"]
