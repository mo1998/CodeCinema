"""Reducer tests: folding a canonical event stream into session state."""

from __future__ import annotations

import json
from pathlib import Path

from app.services.state import SessionState, fold

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_FIXTURE = REPO_ROOT / "shared" / "fixtures" / "sample-session.json"

FIXTURE: list[dict] = [
    {"timestamp": 0, "action": "session.start", "title": "Demo", "agent": "claude-code"},
    {"timestamp": 100, "action": "narrate", "text": "Let us build it", "category": "decision"},
    {"timestamp": 200, "action": "think", "duration": 400, "thought": "use a dataclass"},
    {"timestamp": 300, "action": "file.create", "file": "app/main.py", "language": "python"},
    {"timestamp": 400, "action": "focus", "file": "app/main.py"},
    {"timestamp": 500, "action": "type", "file": "app/main.py", "content": "hello ", "offset": 0},
    {"timestamp": 600, "action": "type", "file": "app/main.py", "content": "world\n", "offset": 6},
    {
        "timestamp": 700,
        "action": "replace",
        "file": "app/main.py",
        "offset": 0,
        "count": 5,
        "content": "HELLO",
    },
    {"timestamp": 800, "action": "delete", "file": "app/main.py", "count": 1, "offset": 5},
    {"timestamp": 900, "action": "terminal.command", "command": "pytest -q"},
    {"timestamp": 1000, "action": "terminal.write", "text": "1 failed", "kind": "error"},
    {"timestamp": 1100, "action": "terminal.exit", "exitCode": 1},
    {
        "timestamp": 1200,
        "action": "error",
        "message": "AssertionError",
        "file": "app/main.py",
        "line": 2,
    },
    {"timestamp": 1300, "action": "fix", "message": "fixed the assertion", "file": "app/main.py"},
    {
        "timestamp": 1400,
        "action": "dependency.add",
        "name": "httpx",
        "version": "0.27.0",
        "manager": "pip",
    },
    {"timestamp": 1500, "action": "build.start", "target": "npm run build"},
    {"timestamp": 1600, "action": "build.success", "durationMs": 900},
    {"timestamp": 1700, "action": "file.rename", "file": "app/main.py", "to": "app/core.py"},
    {"timestamp": 1800, "action": "session.end", "durationMs": 1800},
]


def test_fold_produces_file_content() -> None:
    state = fold(FIXTURE)
    files = {item["path"]: item for item in state["files"]}
    assert "app/core.py" in files
    # "hello " + "world\n" -> "HELLO" replaces "hello", then the space is deleted.
    assert files["app/core.py"]["text"] == "HELLOworld\n"
    assert files["app/core.py"]["language"] == "python"


def test_fold_tracks_tabs_and_active_file() -> None:
    state = fold(FIXTURE)
    assert state["tabs"] == ["app/core.py"]
    assert state["activeFile"] == "app/core.py"
    assert state["fileOrder"] == ["app/core.py"]
    # ``touchedFiles`` records the path as it was first touched (like the frontend).
    assert state["touchedFiles"] == ["app/main.py"]


def test_fold_collects_terminal_lines() -> None:
    state = fold(FIXTURE)
    terminal = state["terminal"]
    assert terminal["open"] is True
    assert terminal["lastExitCode"] == 1
    kinds = [line["kind"] for line in terminal["lines"]]
    assert kinds == ["command", "error", "error"]
    assert terminal["lines"][0]["text"] == "pytest -q"


def test_fold_builds_a_timeline() -> None:
    state = fold(FIXTURE)
    timeline = state["timeline"]
    # Only "notable" actions produce timeline entries (mirrors the frontend).
    assert len(timeline) == 14
    assert timeline[0]["kind"] == "session"
    assert timeline[0]["label"] == "Session started"
    assert timeline[-1]["label"] == "Session finished"
    # ``eventIndex`` refers to the index in the source event array.
    assert [entry["eventIndex"] for entry in timeline] == [
        0,
        1,
        2,
        3,
        9,
        10,
        11,
        12,
        13,
        14,
        15,
        16,
        17,
        18,
    ]


def test_fold_resolves_errors_with_fixes() -> None:
    state = fold(FIXTURE)
    errors = state["errors"]
    assert len(errors) == 1
    assert errors[0]["message"] == "AssertionError"
    assert errors[0]["resolved"] is True
    assert state["fixes"][0]["message"] == "fixed the assertion"


def test_fold_records_narration_dependencies_and_build() -> None:
    state = fold(FIXTURE)
    assert state["narration"][0]["text"] == "Let us build it"
    assert state["narration"][0]["category"] == "decision"
    assert state["dependencies"][0]["name"] == "httpx"
    assert state["build"]["status"] == "success"
    assert state["build"]["target"] == "npm run build"


def test_fold_until_ms_stops_early() -> None:
    state = fold(FIXTURE, until_ms=700)
    assert state["consumedEvents"] == 8
    files = {item["path"]: item for item in state["files"]}
    assert files["app/main.py"]["text"] == "HELLO world\n"
    assert state["terminal"]["open"] is False


def test_fold_is_deterministic() -> None:
    first = fold(FIXTURE)
    second = fold(FIXTURE)
    assert first == second


def test_state_apply_uses_the_event_index() -> None:
    state = SessionState()
    state.apply(FIXTURE[0], 0)
    assert state.consumed_events == 1
    assert state.meta["title"] == "Demo"
    assert state.meta["agent"] == "claude-code"


def test_fold_handles_the_shared_sample_fixture() -> None:
    if not SAMPLE_FIXTURE.exists():
        return
    events = json.loads(SAMPLE_FIXTURE.read_text(encoding="utf-8"))
    state = fold(events)

    assert state["meta"]["title"] == "Sample session"
    assert state["meta"]["agent"] == "claude-code"
    files = {item["path"]: item for item in state["files"]}
    assert "src/health.py" in files
    assert files["src/health.py"]["text"] == (
        'def health() -> dict[str, str]:\n    return {"status": "ok"}\n'
    )
    assert state["terminal"]["open"] is True
    # The fixture ends with a successful run, so the last exit code is 0.
    assert state["terminal"]["lastExitCode"] == 0
    assert any(line["kind"] == "error" for line in state["terminal"]["lines"])
    assert state["timeline"]
    assert state["consumedEvents"] == len(events)
