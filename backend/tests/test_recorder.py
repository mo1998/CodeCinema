"""Recorder tests — the polling watcher against a real git worktree."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from app.adapters.base import SessionEvent
from app.recorder.cli import build_parser
from app.recorder.command_capture import ShellHistoryTailer, ToolCallParser
from app.recorder.repo_watcher import RepoWatcher, WatcherConfig
from app.recorder.session_recorder import RecorderConfig, SessionRecorder


def make_watcher(repo: Path) -> RepoWatcher:
    """A watcher with a fast poll interval."""
    return RepoWatcher(WatcherConfig(repo=repo, poll_interval=0.01))


def actions(events: list[SessionEvent]) -> list[str]:
    """The ordered action list."""
    return [event.action for event in events]


def test_watcher_detects_a_new_file(git_repo: Path) -> None:
    watcher = make_watcher(git_repo)
    watcher.prime()
    (git_repo / "app.py").write_text("print('hi')\n", encoding="utf-8")

    events = watcher.poll_once()
    assert "file.create" in actions(events)
    created = next(event for event in events if event.action == "file.create")
    assert created.file == "app.py"
    typed = [event for event in events if event.action == "type"]
    assert typed
    assert "".join(event.content or "" for event in typed) == "print('hi')\n"


def test_watcher_emits_typed_chunks(git_repo: Path) -> None:
    watcher = make_watcher(git_repo)
    watcher.prime()
    (git_repo / "long.py").write_text("x = 1\n" * 10, encoding="utf-8")

    events = watcher.poll_once()
    typed = [event for event in events if event.action == "type"]
    assert len(typed) > 1
    assert all(len(event.content or "") <= 40 for event in typed)
    # The offsets must advance so the chunks are replayed in order.
    offsets = [event.offset for event in typed]
    assert offsets == sorted(offsets)


def test_watcher_detects_a_modified_file(git_repo: Path) -> None:
    watcher = make_watcher(git_repo)
    watcher.prime()
    (git_repo / "README.md").write_text("# demo\n\nmore text\n", encoding="utf-8")

    events = watcher.poll_once()
    kinds = actions(events)
    assert "type" in kinds or "replace" in kinds
    assert "focus" in kinds


def test_watcher_detects_a_deleted_file(git_repo: Path) -> None:
    watcher = make_watcher(git_repo)
    watcher.prime()
    (git_repo / "README.md").unlink()

    events = watcher.poll_once()
    deleted = next(event for event in events if event.action == "file.delete")
    assert deleted.file == "README.md"


def test_watcher_detects_a_rename(git_repo: Path) -> None:
    original = git_repo / "old_name.py"
    original.write_text("value = 1\n", encoding="utf-8")
    watcher = make_watcher(git_repo)
    watcher.prime()
    original.rename(git_repo / "new_name.py")

    events = watcher.poll_once()
    renamed = next(event for event in events if event.action == "file.rename")
    assert renamed.file == "old_name.py"
    assert renamed.to == "new_name.py"


def test_watcher_detects_new_dependencies(git_repo: Path) -> None:
    (git_repo / "package.json").write_text(
        json.dumps({"dependencies": {"react": "18.0.0"}}), encoding="utf-8"
    )
    watcher = make_watcher(git_repo)
    watcher.prime()
    (git_repo / "package.json").write_text(
        json.dumps({"dependencies": {"react": "18.0.0", "lodash": "4.17.21"}}), encoding="utf-8"
    )

    events = watcher.poll_once()
    added = next(event for event in events if event.action == "dependency.add")
    assert added.name == "lodash"
    assert added.version == "4.17.21"
    assert added.manager == "npm"


def test_watcher_ignores_noise_directories(git_repo: Path) -> None:
    (git_repo / "node_modules" / "pkg").mkdir(parents=True)
    (git_repo / "node_modules" / "pkg" / "index.js").write_text("x\n", encoding="utf-8")
    watcher = make_watcher(git_repo)
    watcher.prime()
    (git_repo / "node_modules" / "pkg" / "index.js").write_text("y\n", encoding="utf-8")
    assert watcher.poll_once() == []


def test_session_recorder_records_a_command(git_repo: Path) -> None:
    script = "open('created.py', 'w').write('value = 42\\n')"
    recorder = SessionRecorder(
        RecorderConfig(repo=git_repo, agent="claude-code", poll_interval=0.05)
    )
    events = asyncio.run(recorder.record(["python3", "-c", script]))

    kinds = actions(events)
    assert kinds[0] == "session.start"
    assert "file.create" in kinds
    created = next(event for event in events if event.action == "file.create")
    assert created.file == "created.py"
    assert kinds[-1] == "session.end"


def test_session_recorder_writes_ndjson(git_repo: Path, tmp_path: Path) -> None:
    output = tmp_path / "session.ndjson"
    recorder = SessionRecorder(
        RecorderConfig(
            repo=git_repo, agent="generic", output=output, poll_interval=0.05, duration=0.3
        )
    )
    events = asyncio.run(recorder.record(None))
    path = recorder.write_ndjson(events)
    assert path == output
    lines = [line for line in output.read_text(encoding="utf-8").splitlines() if line]
    assert len(lines) == len(events)
    assert json.loads(lines[0])["action"] == "session.start"


def test_shell_history_tailer_reads_new_commands(tmp_path: Path) -> None:
    history = tmp_path / ".bash_history"
    history.write_text("ls -la\n", encoding="utf-8")
    tailer = ShellHistoryTailer(history_paths=[history])
    tailer.prime()
    assert tailer.poll() == []

    with history.open("a", encoding="utf-8") as handle:
        handle.write("npm run build\n")
    events = tailer.poll()
    assert len(events) == 1
    assert events[0].action == "terminal.command"
    assert events[0].command == "npm run build"


def test_tool_call_parser_emits_terminal_events() -> None:
    parser = ToolCallParser()
    events = parser.parse_tool_call("Bash", {"command": "pytest", "output": "ok", "exit_code": 0})
    assert [event.action for event in events] == [
        "terminal.command",
        "terminal.write",
        "terminal.exit",
    ]
    assert parser.parse_tool_call("Read", {"file_path": "a.py"}) == []


def test_cli_parser_accepts_the_documented_usage() -> None:
    parser = build_parser()
    args = parser.parse_args(
        [
            "record",
            "--repo",
            ".",
            "--agent",
            "claude-code",
            "--output",
            "session.ndjson",
            "--",
            "claude",
            "hello",
        ]
    )
    assert args.command == "record"
    assert args.agent == "claude-code"
    assert args.output == "session.ndjson"
    assert args.argv == ["--", "claude", "hello"]
