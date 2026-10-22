"""Watch a git worktree and emit canonical file events.

The watcher works with or without ``watchfiles``: a polling snapshot diff is
always available, so there is no hard dependency on the optional package.
"""

from __future__ import annotations

import asyncio
import difflib
import hashlib
import os
import time
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.adapters.base import EventBuilder, SessionEvent
from app.core.languages import detect_language
from app.core.logging import get_logger

logger = get_logger(__name__)

DEFAULT_IGNORED_DIRS = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        "node_modules",
        ".venv",
        "venv",
        "env",
        "__pycache__",
        "dist",
        "build",
        ".next",
        ".nuxt",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        ".tox",
        ".gradle",
        ".idea",
        ".vscode",
        ".cache",
        "target",
        "coverage",
    }
)

DEFAULT_IGNORED_FILES = frozenset(
    {
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "poetry.lock",
        "Cargo.lock",
        "go.sum",
        "composer.lock",
        "Gemfile.lock",
        ".DS_Store",
    }
)

DEPENDENCY_FILES: dict[str, str] = {
    "package.json": "npm",
    "requirements.txt": "pip",
    "pyproject.toml": "poetry",
    "Cargo.toml": "cargo",
    "go.mod": "go",
}


@dataclass
class WatcherConfig:
    """Configuration of the repository watcher."""

    repo: Path
    poll_interval: float = 0.4
    ignored_dirs: frozenset[str] = DEFAULT_IGNORED_DIRS
    ignored_files: frozenset[str] = DEFAULT_IGNORED_FILES
    ignore_lockfiles: bool = True
    chunk_size: int = 40
    max_file_bytes: int = 2_000_000
    typing_cps: float = 7.5
    watch_submodules: bool = False
    extra_ignores: frozenset[str] = field(default_factory=frozenset)

    def __post_init__(self) -> None:
        self.repo = Path(self.repo).resolve()


class RepoWatcher:
    """Polls a worktree and turns file changes into canonical events."""

    def __init__(self, config: WatcherConfig, *, builder: EventBuilder | None = None) -> None:
        self.config = config
        self.builder = builder or EventBuilder()
        self._contents: dict[str, str] = {}
        self._hashes: dict[str, str] = {}
        self._primed = False

    # -- scanning ----------------------------------------------------------

    def _is_ignored(self, relative: str) -> bool:
        parts = Path(relative).parts
        for part in parts[:-1]:
            if part in self.config.ignored_dirs or part in self.config.extra_ignores:
                return True
        name = parts[-1] if parts else ""
        if name in self.config.extra_ignores:
            return True
        if self.config.ignore_lockfiles and name in DEFAULT_IGNORED_FILES:
            return True
        return False

    def scan(self) -> dict[str, str]:
        """Return ``{relative_path: content}`` for every relevant text file."""
        repo = self.config.repo
        contents: dict[str, str] = {}
        if not repo.exists():
            return contents
        for dirpath, dirnames, filenames in os.walk(repo):
            current = Path(dirpath)
            relative_dir = current.relative_to(repo)
            dirnames[:] = [
                name
                for name in dirnames
                if name not in self.config.ignored_dirs and name not in self.config.extra_ignores
            ]
            for filename in filenames:
                absolute = current / filename
                relative = (relative_dir / filename).as_posix()
                if relative.startswith("./"):
                    relative = relative[2:]
                if self._is_ignored(relative):
                    continue
                try:
                    if absolute.stat().st_size > self.config.max_file_bytes:
                        continue
                    text = absolute.read_text(encoding="utf-8")
                except (OSError, UnicodeDecodeError):
                    continue
                contents[relative] = text
        return contents

    def prime(self) -> None:
        """Record the current state without emitting any event."""
        contents = self.scan()
        self._contents = contents
        self._hashes = {path: _hash(text) for path, text in contents.items()}
        self._primed = True

    # -- diffing -----------------------------------------------------------

    def poll_once(self) -> list[SessionEvent]:
        """Compare the worktree with the last snapshot and emit events."""
        if not self._primed:
            self.prime()
            return []
        current = self.scan()
        previous = self._contents
        before = len(self.builder.events)

        added = {path: text for path, text in current.items() if path not in previous}
        removed = {path: text for path, text in previous.items() if path not in current}
        modified = {
            path: text
            for path, text in current.items()
            if path in previous and previous[path] != text
        }

        renames = self._detect_renames(removed, added)
        for source, target in renames:
            removed.pop(source, None)
            added.pop(target, None)
            self.builder.file_rename(source, target)

        for path in sorted(added):
            self._emit_created(path, added[path])
        for path in sorted(modified):
            self._emit_modified(path, previous[path], modified[path])
        for path in sorted(removed):
            self.builder.file_delete(path)

        self._contents = current
        self._hashes = {path: _hash(text) for path, text in current.items()}
        return self.builder.events[before:]

    def _detect_renames(
        self, removed: dict[str, str], added: dict[str, str]
    ) -> list[tuple[str, str]]:
        """Match deleted and added files with identical content."""
        by_hash: dict[str, list[str]] = {}
        for path, text in removed.items():
            by_hash.setdefault(_hash(text), []).append(path)
        renames: list[tuple[str, str]] = []
        for path, text in added.items():
            candidates = by_hash.get(_hash(text))
            if candidates:
                source = candidates.pop(0)
                renames.append((source, path))
        return renames

    # -- event emission ----------------------------------------------------

    def _emit_created(self, path: str, content: str) -> None:
        self.builder.file_create(path, detect_language(path))
        self._emit_typed(path, content, 0)
        self._emit_dependencies(path, "", content)

    def _emit_modified(self, path: str, old_text: str, new_text: str) -> None:
        self.builder.focus(path)
        self._emit_diff(path, old_text, new_text)
        self._emit_dependencies(path, old_text, new_text)

    def _emit_typed(self, path: str, content: str, offset: int) -> None:
        """Emit progressive typing events (chunks of ~40 characters)."""
        chunk_size = max(1, self.config.chunk_size)
        cursor = offset
        for index in range(0, len(content), chunk_size):
            chunk = content[index : index + chunk_size]
            self.builder.type_text(path, chunk, cursor)
            cursor += len(chunk)

    def _emit_diff(self, path: str, old_text: str, new_text: str) -> None:
        old_lines = old_text.splitlines(keepends=True)
        new_lines = new_text.splitlines(keepends=True)
        matcher = difflib.SequenceMatcher(a=old_lines, b=new_lines, autojunk=False)
        current_lines = list(old_lines)

        def offset_of(index: int) -> int:
            return sum(len(line) for line in current_lines[:index])

        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                continue
            if tag == "insert":
                segment = "".join(new_lines[j1:j2])
                offset = offset_of(i1)
                self._emit_typed(path, segment, offset)
                current_lines[i1:i1] = new_lines[j1:j2]
            elif tag == "delete":
                segment = "".join(old_lines[i1:i2])
                offset = offset_of(i1)
                self.builder.delete_chars(path, len(segment), offset)
                del current_lines[i1:i2]
            else:  # replace
                removed = "".join(old_lines[i1:i2])
                added = "".join(new_lines[j1:j2])
                offset = offset_of(i1)
                self.builder.select(path, offset, len(removed))
                self.builder.replace(path, offset, len(removed), added)
                current_lines[i1:i2] = new_lines[j1:j2]

    def _emit_dependencies(self, path: str, old_text: str, new_text: str) -> None:
        manager = DEPENDENCY_FILES.get(path)
        if manager is None:
            return
        old_deps = _parse_dependencies(path, old_text)
        new_deps = _parse_dependencies(path, new_text)
        for name, version in new_deps.items():
            if name not in old_deps:
                self.builder.dependency_add(name, version, manager)  # type: ignore[arg-type]
        for name in old_deps:
            if name not in new_deps:
                self.builder.dependency_remove(name, manager)  # type: ignore[arg-type]

    # -- watching ----------------------------------------------------------

    def watch(self, *, stop: Any = None, timeout: float | None = None) -> Iterator[SessionEvent]:
        """Poll the worktree until stopped (synchronous generator)."""
        self.prime()
        deadline = None if timeout is None else time.monotonic() + timeout
        while True:
            if stop is not None and stop.is_set():
                return
            yield from self.poll_once()
            if deadline is not None and time.monotonic() >= deadline:
                return
            time.sleep(self.config.poll_interval)

    async def watch_async(self, *, timeout: float | None = None) -> AsyncIterator[SessionEvent]:
        """Async variant of :meth:`watch`."""
        self.prime()
        deadline = None if timeout is None else time.monotonic() + timeout
        while True:
            for event in self.poll_once():
                yield event
            if deadline is not None and time.monotonic() >= deadline:
                return
            await asyncio.sleep(self.config.poll_interval)


# --------------------------------------------------------------------------
# Dependency parsing helpers
# --------------------------------------------------------------------------


def _hash(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8", errors="replace")).hexdigest()


def _parse_dependencies(path: str, text: str) -> dict[str, str]:
    """Parse the dependencies declared in a manifest file."""
    if not text:
        return {}
    try:
        if path == "package.json":
            return _parse_package_json(text)
        if path == "requirements.txt":
            return _parse_requirements(text)
        if path == "pyproject.toml":
            return _parse_pyproject(text)
        if path == "Cargo.toml":
            return _parse_cargo(text)
        if path == "go.mod":
            return _parse_go_mod(text)
    except Exception as exc:  # noqa: BLE001 - manifest parsing is best effort
        logger.debug("watcher.dependency_parse_failed", extra={"path": path, "error": str(exc)})
    return {}


def _parse_package_json(text: str) -> dict[str, str]:
    import json

    data = json.loads(text)
    deps: dict[str, str] = {}
    for key in ("dependencies", "devDependencies", "peerDependencies"):
        section = data.get(key)
        if isinstance(section, dict):
            for name, version in section.items():
                if isinstance(name, str) and isinstance(version, str):
                    deps[name] = version
    return deps


def _parse_requirements(text: str) -> dict[str, str]:
    deps: dict[str, str] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("-"):
            continue
        name, _, version = stripped.partition("==")
        if not version:
            name, _, version = stripped.partition(">=")
        if not version:
            name, _, version = stripped.partition("~=")
        deps[name.strip()] = version.strip()
    return deps


def _parse_pyproject(text: str) -> dict[str, str]:
    deps: dict[str, str] = {}
    in_dependencies = False
    for raw in text.splitlines():
        stripped = raw.strip()
        if stripped.startswith("["):
            in_dependencies = False
            continue
        if not stripped:
            continue
        if not in_dependencies:
            if stripped.startswith("dependencies"):
                in_dependencies = True
            continue
        if stripped.startswith("]"):
            in_dependencies = False
            continue
        entry = stripped.split(",")[0].strip().strip("\"'")
        if not entry:
            continue
        name, _, version = entry.partition("==")
        deps[name.strip()] = version.strip()
    return deps


def _parse_cargo(text: str) -> dict[str, str]:
    deps: dict[str, str] = {}
    in_dependencies = False
    for raw in text.splitlines():
        stripped = raw.strip()
        if stripped.startswith("["):
            in_dependencies = stripped.startswith("[dependencies")
            continue
        if not in_dependencies:
            continue
        if "=" not in stripped:
            continue
        name, _, version = stripped.partition("=")
        deps[name.strip().strip('"')] = version.strip().strip('"')
    return deps


def _parse_go_mod(text: str) -> dict[str, str]:
    deps: dict[str, str] = {}
    in_require = False
    for raw in text.splitlines():
        stripped = raw.strip()
        if stripped.startswith("require ("):
            in_require = True
            continue
        if in_require and stripped == ")":
            in_require = False
            continue
        if in_require:
            parts = stripped.split()
            if parts:
                deps[parts[0]] = parts[1] if len(parts) > 1 else ""
            continue
        if stripped.startswith("require "):
            parts = stripped[len("require ") :].split()
            if parts:
                deps[parts[0]] = parts[1] if len(parts) > 1 else ""
    return deps


__all__ = [
    "DEFAULT_IGNORED_DIRS",
    "DEFAULT_IGNORED_FILES",
    "DEPENDENCY_FILES",
    "RepoWatcher",
    "WatcherConfig",
]
