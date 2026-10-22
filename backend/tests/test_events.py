"""Event model tests: builder behaviour and JSON Schema conformance."""

from __future__ import annotations

import random

import jsonschema
import pytest

from app.adapters.base import EVENT_ACTIONS, EventBuilder, SessionEvent


class FakeClock:
    """A deterministic monotonic clock."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        self.now += 0.25
        return self.now


def build_sample_events() -> list[SessionEvent]:
    """Build one event of every action that carries a payload."""
    builder = EventBuilder(session_id="session-1", clock=FakeClock(), rng=random.Random(7))
    builder.session_start(title="Demo", agent="claude-code", prompt="build a thing")
    builder.narrate("planning the change", "decision")
    builder.think(duration=500, thought="maybe use a dataclass")
    builder.file_create("app/main.py", "python")
    builder.focus("app/main.py")
    builder.type_text("app/main.py", "print('hello')\n", 0)
    builder.insert("app/main.py", "\n", 16)
    builder.replace("app/main.py", 0, 5, "def main():\n    pass\n")
    builder.cursor("app/main.py", 12)
    builder.select("app/main.py", 0, 4)
    builder.scroll("app/main.py", 120)
    builder.close("app/main.py")
    builder.file_rename("app/main.py", "app/core.py")
    builder.file_delete("app/core.py")
    builder.terminal_open()
    builder.terminal_command("pytest -q")
    builder.terminal_write("2 passed", "output")
    builder.terminal_exit(0)
    builder.build_start("npm run build")
    builder.build_success(duration_ms=1200)
    builder.test_start("pytest")
    builder.test_result(passed=3, failed=0)
    builder.error("boom", file="app/core.py", line=3)
    builder.fix("fixed the boom", file="app/core.py")
    builder.pause(250)
    builder.dependency_add("httpx", "0.27.0", "pip")
    builder.dependency_remove("httpx", "pip")
    builder.session_end(duration_ms=9000)
    return builder.events


def test_event_builder_timestamps_are_monotonic() -> None:
    events = build_sample_events()
    timestamps = [event.timestamp for event in events]
    assert timestamps == sorted(timestamps)
    assert timestamps[0] >= 0
    assert all(isinstance(value, int) for value in timestamps)


def test_event_builder_timestamps_never_go_backwards_with_a_frozen_clock() -> None:
    builder = EventBuilder(session_id="s", clock=lambda: 5.0, rng=random.Random(1))
    first = builder.narrate("one")
    second = builder.narrate("two")
    third = builder.narrate("three")
    assert first.timestamp <= second.timestamp <= third.timestamp


def test_event_builder_advance_moves_the_timeline_forward() -> None:
    builder = EventBuilder(session_id="s", clock=FakeClock(), rng=random.Random(3))
    before = builder.narrate("hello").timestamp
    builder.advance(5000)
    after = builder.narrate("world").timestamp
    assert after - before >= 5000


def test_event_builder_assigns_stable_ids() -> None:
    first = EventBuilder(session_id="abc", clock=FakeClock(), rng=random.Random(1)).events
    second = EventBuilder(session_id="abc", clock=FakeClock(), rng=random.Random(1)).events
    assert [event.id for event in first] == [event.id for event in second]
    assert all(event.id for event in first)


def test_every_emitted_action_is_canonical() -> None:
    for event in build_sample_events():
        assert event.action in EVENT_ACTIONS


@pytest.mark.parametrize("event", build_sample_events(), ids=lambda e: e.action)
def test_events_validate_against_the_shared_schema(event: SessionEvent, event_schema: dict) -> None:
    payload = event.to_dict()
    jsonschema.validate(payload, event_schema)


def test_event_to_dict_uses_camel_case_aliases() -> None:
    builder = EventBuilder(session_id="s", clock=FakeClock(), rng=random.Random(2))
    event = builder.terminal_exit(3)
    assert event.to_dict()["exitCode"] == 3
    assert "exit_code" not in event.to_dict()


def test_unknown_extra_fields_are_preserved() -> None:
    event = SessionEvent.model_validate(
        {"timestamp": 5, "action": "narrate", "text": "hi", "custom": {"a": 1}}
    )
    assert event.to_dict()["custom"] == {"a": 1}
