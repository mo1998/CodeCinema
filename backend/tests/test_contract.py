"""The shared contract test.

The event schema in ``shared/schemas/event.schema.json`` is the source of
truth. The TypeScript projection (``frontend/lib/engine/events.ts``) and the
Python projection (``app/adapters/base.py``) must both agree with it, and the
golden fixture must validate against it.

If this test fails, one of the three has drifted.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import jsonschema
import pytest

from app.adapters.base import EVENT_ACTIONS

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = REPO_ROOT / "shared" / "schemas" / "event.schema.json"
FIXTURES_DIR = REPO_ROOT / "shared" / "fixtures"
TYPESCRIPT_EVENTS = REPO_ROOT / "frontend" / "lib" / "engine" / "events.ts"


def test_schema_declares_every_action() -> None:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    assert set(schema["properties"]["action"]["enum"]) == set(EVENT_ACTIONS)


def test_typescript_projection_matches_the_schema() -> None:
    """The TypeScript action list must match, action for action."""
    source = TYPESCRIPT_EVENTS.read_text(encoding="utf-8")
    match = re.search(r"EVENT_ACTIONS = \[(.*?)\] as const", source, re.S)
    assert match, "could not find EVENT_ACTIONS in frontend/lib/engine/events.ts"
    actions = set(re.findall(r"'([^']+)'", match.group(1)))
    assert actions == set(EVENT_ACTIONS)


@pytest.mark.parametrize("path", sorted(FIXTURES_DIR.glob("*.json")))
def test_fixtures_validate(path: Path, event_schema: dict) -> None:
    events = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(events, list)
    validator = jsonschema.Draft202012Validator(event_schema)
    for index, event in enumerate(events):
        errors = sorted(validator.iter_errors(event), key=lambda e: list(e.path))
        assert not errors, f"{path.name}[{index}]: {errors[0].message}"


@pytest.mark.parametrize("path", sorted(FIXTURES_DIR.glob("*.json")))
def test_fixtures_are_monotonic(path: Path) -> None:
    events = json.loads(path.read_text(encoding="utf-8"))
    previous = -1
    for event in events:
        assert event["timestamp"] >= previous, f"{path.name}: timestamps must not decrease"
        previous = event["timestamp"]
