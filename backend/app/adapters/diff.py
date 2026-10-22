"""Unified diff parsing shared by the generic adapter and patch-style tools."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class DiffHunk:
    """A single ``@@`` hunk."""

    old_start: int = 0
    old_count: int = 0
    new_start: int = 0
    new_count: int = 0
    removed: list[str] = field(default_factory=list)
    added: list[str] = field(default_factory=list)


@dataclass
class DiffFile:
    """One file touched by a diff."""

    path: str
    old_path: str | None = None
    status: str = "modified"
    hunks: list[DiffHunk] = field(default_factory=list)

    @property
    def added_text(self) -> str:
        """All added lines joined back together."""
        return "".join(line for hunk in self.hunks for line in hunk.added)

    @property
    def removed_text(self) -> str:
        """All removed lines joined back together."""
        return "".join(line for hunk in self.hunks for line in hunk.removed)


def _strip_prefix(path: str) -> str:
    path = path.strip()
    if path.startswith(("a/", "b/")):
        return path[2:]
    return path


def parse_unified_diff(text: str) -> list[DiffFile]:
    """Parse a unified diff into per-file changes.

    Malformed hunks are skipped; the parser never raises.
    """
    files: list[DiffFile] = []
    current: DiffFile | None = None
    hunk: DiffHunk | None = None

    for raw_line in text.splitlines():
        line = raw_line
        if line.startswith("diff --git "):
            current = None
            hunk = None
            parts = line.split(" ")
            if len(parts) >= 4:
                old_path = _strip_prefix(parts[2])
                new_path = _strip_prefix(parts[3])
                current = DiffFile(path=new_path, old_path=old_path)
                files.append(current)
            continue
        if line.startswith("--- "):
            path = _strip_prefix(line[4:])
            if path == "/dev/null":
                path = ""
            if current is None:
                current = DiffFile(path=path)
                files.append(current)
            current.old_path = path or None
            hunk = None
            continue
        if line.startswith("+++ "):
            path = _strip_prefix(line[4:])
            if path == "/dev/null":
                path = ""
            if current is None:
                current = DiffFile(path=path)
                files.append(current)
            current.path = path or current.path
            hunk = None
            continue
        if line.startswith("rename from "):
            if current is not None:
                current.old_path = _strip_prefix(line[len("rename from ") :])
            continue
        if line.startswith("rename to "):
            if current is not None:
                current.path = _strip_prefix(line[len("rename to ") :])
                current.status = "renamed"
            continue
        if line.startswith("new file mode"):
            if current is not None:
                current.status = "added"
            continue
        if line.startswith("deleted file mode"):
            if current is not None:
                current.status = "deleted"
            continue
        if line.startswith("@@"):
            if current is None:
                continue
            hunk = _parse_hunk_header(line)
            if hunk is not None:
                current.hunks.append(hunk)
            continue
        if hunk is None or current is None:
            continue
        if line.startswith("+"):
            hunk.added.append(line[1:] + "\n")
        elif line.startswith("-"):
            hunk.removed.append(line[1:] + "\n")
        elif line.startswith(" "):
            continue
        elif line == "":
            hunk.added.append("\n")
    return files


def _parse_hunk_header(line: str) -> DiffHunk | None:
    try:
        body = line.split("@@")[1].strip()
        old_part, new_part = body.split(" ")[0:2]
        old_start, old_count = _parse_range(old_part[1:])
        new_start, new_count = _parse_range(new_part[1:])
    except (IndexError, ValueError):
        return None
    return DiffHunk(
        old_start=old_start,
        old_count=old_count,
        new_start=new_start,
        new_count=new_count,
    )


def _parse_range(value: str) -> tuple[int, int]:
    if "," in value:
        start_text, count_text = value.split(",", 1)
        return int(start_text), int(count_text)
    return int(value), 1


__all__ = ["DiffFile", "DiffHunk", "parse_unified_diff"]
