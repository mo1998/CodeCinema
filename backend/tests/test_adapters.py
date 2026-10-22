"""Adapter tests — one realistic fixture per agent."""

from __future__ import annotations

import json
from typing import Any

import jsonschema
import pytest

from app.adapters.base import SessionEvent
from app.adapters.registry import get_adapter, list_adapters

CLAUDE_CODE_TRANSCRIPT = "\n".join(
    json.dumps(item)
    for item in [
        {
            "type": "system",
            "subtype": "init",
            "session_id": "abc",
            "tools": ["Bash", "Read", "Write", "Edit"],
            "model": "claude-sonnet-4",
        },
        {
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [
                    {"type": "thinking", "thinking": "The module needs a dataclass."},
                    {"type": "text", "text": "I will create the module now."},
                    {
                        "type": "tool_use",
                        "id": "toolu_1",
                        "name": "Write",
                        "input": {
                            "file_path": "/repo/app/models.py",
                            "content": "from dataclasses import dataclass\n",
                        },
                    },
                    {
                        "type": "tool_use",
                        "id": "toolu_2",
                        "name": "Bash",
                        "input": {"command": "pytest -q"},
                    },
                ],
            },
        },
        {
            "type": "user",
            "message": {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "toolu_2", "content": "1 passed"}
                ],
            },
        },
        {
            "type": "result",
            "subtype": "success",
            "duration_ms": 4200,
            "result": "done",
        },
    ]
)

OPENCODE_TRANSCRIPT = "\n".join(
    json.dumps(item)
    for item in [
        {
            "type": "message.updated",
            "properties": {
                "parts": [
                    {"type": "text", "text": "Adding the component."},
                    {
                        "type": "tool",
                        "tool": "write",
                        "callID": "call_1",
                        "state": {
                            "status": "running",
                            "input": {"filePath": "src/ui.tsx", "content": "export const Ui = 1\n"},
                        },
                    },
                ]
            },
        },
        {
            "type": "tool.start",
            "properties": {"callID": "call_2", "tool": "bash", "input": {"command": "npm test"}},
        },
        {
            "type": "tool.finish",
            "properties": {"callID": "call_2", "tool": "bash", "output": "ok"},
        },
    ]
)

CURSOR_TRANSCRIPT = "\n".join(
    json.dumps(item)
    for item in [
        {
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [
                    {"type": "text", "text": "Editing the handler."},
                    {
                        "type": "tool_call",
                        "id": "call_9",
                        "name": "edit_file",
                        "arguments": {
                            "path": "src/handler.py",
                            "old_string": "return None",
                            "new_string": "return value",
                        },
                    },
                    {
                        "type": "tool_call",
                        "id": "call_10",
                        "name": "run_terminal_cmd",
                        "arguments": {"command": "ruff check ."},
                    },
                ],
            },
        },
        {
            "type": "user",
            "message": {
                "role": "user",
                "content": [
                    {"type": "tool_result", "call_id": "call_10", "content": "All checks passed"}
                ],
            },
        },
        {"type": "result", "success": True, "duration_ms": 900, "result": "done"},
    ]
)

GEMINI_TRANSCRIPT = "\n".join(
    json.dumps(item)
    for item in [
        {"type": "content", "content": "Adding a helper function."},
        {
            "type": "tool_use",
            "name": "replace",
            "input": {"file_path": "lib/util.py", "old_string": "pass", "new_string": "return 1"},
        },
        {
            "type": "tool_use",
            "name": "run_shell_command",
            "args": {"command": "python -m pytest"},
        },
        {"type": "tool_result", "output": "2 passed"},
        {"type": "stats", "stats": {"models": {}}},
    ]
)

AIDER_TRANSCRIPT = """#### assistant

I will update the configuration module.

config.py
```python
<<<<<<< SEARCH
DEBUG = False
=======
DEBUG = True
>>>>>>> REPLACE
```
"""

CLINE_HISTORY = {
    "id": "task-1",
    "cwd": "/repo",
    "history": [
        {"ts": 1, "type": "say", "say": "task", "text": "Create the service"},
        {
            "ts": 2,
            "type": "tool",
            "tool": "newFile",
            "path": "svc.py",
            "content": "class Svc:\n    pass\n",
        },
        {"ts": 3, "type": "tool", "tool": "executeCommand", "command": "python -m pytest"},
        {"ts": 4, "type": "tool", "tool": "readFile", "path": "svc.py"},
    ],
}

ROO_HISTORY = {
    "apiConversationHistory": [
        {"role": "user", "content": [{"type": "text", "text": "Fix the bug"}]},
        {
            "role": "assistant",
            "content": [
                {"type": "text", "text": "Patching the parser."},
                {
                    "type": "tool_use",
                    "name": "editedExistingFile",
                    "input": {
                        "path": "parser.py",
                        "diff": "<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE\n",
                    },
                },
                {
                    "type": "tool_use",
                    "name": "execute_command",
                    "input": {"command": "cargo test"},
                },
            ],
        },
    ]
}

GENERIC_DIFF = """diff --git a/src/new.py b/src/new.py
new file mode 100644
--- /dev/null
+++ b/src/new.py
@@ -0,0 +1,2 @@
+print("hello")
+print("world")
diff --git a/src/gone.py b/src/gone.py
deleted file mode 100644
--- a/src/gone.py
+++ /dev/null
@@ -1,1 +0,0 @@
-print("bye")
"""


def actions(events: list[SessionEvent]) -> list[str]:
    """The ordered action list of a parsed transcript."""
    return [event.action for event in events]


def find(events: list[SessionEvent], action: str) -> SessionEvent | None:
    """First event with the given action."""
    for event in events:
        if event.action == action:
            return event
    return None


def test_registry_lists_every_adapter() -> None:
    names = {item["name"] for item in list_adapters()}
    assert {
        "claude-code",
        "opencode",
        "cursor",
        "gemini-cli",
        "aider",
        "cline",
        "roo-code",
        "generic",
    } <= names
    for item in list_adapters():
        assert item["display_name"]
        assert item["capabilities"]


def test_unknown_agent_raises() -> None:
    from app.core.errors import NotFoundError

    with pytest.raises(NotFoundError):
        get_adapter("nope")


def test_claude_code_adapter() -> None:
    events = get_adapter("claude-code").parse(CLAUDE_CODE_TRANSCRIPT, session_id="s1")
    assert actions(events)[:3] == ["think", "narrate", "file.create"]
    created = find(events, "file.create")
    assert created is not None
    assert created.file == "/repo/app/models.py"
    typed = [event for event in events if event.action == "type"]
    assert typed and "".join(event.content or "" for event in typed) == (
        "from dataclasses import dataclass\n"
    )
    command = find(events, "terminal.command")
    assert command is not None and command.command == "pytest -q"
    assert find(events, "terminal.exit") is not None
    assert find(events, "session.end") is not None


def test_opencode_adapter() -> None:
    events = get_adapter("opencode").parse(OPENCODE_TRANSCRIPT, session_id="s2")
    assert "file.create" in actions(events)
    created = find(events, "file.create")
    assert created is not None and created.file == "src/ui.tsx"
    command = find(events, "terminal.command")
    assert command is not None and command.command == "npm test"
    assert find(events, "terminal.write") is not None
    assert find(events, "terminal.exit") is not None


def test_cursor_adapter() -> None:
    events = get_adapter("cursor").parse(CURSOR_TRANSCRIPT, session_id="s3")
    replace = find(events, "replace")
    assert replace is not None
    assert replace.file == "src/handler.py"
    assert replace.count == len("return None")
    assert replace.content == "return value"
    command = find(events, "terminal.command")
    assert command is not None and command.command == "ruff check ."
    assert find(events, "session.end") is not None


def test_gemini_cli_adapter() -> None:
    events = get_adapter("gemini-cli").parse(GEMINI_TRANSCRIPT, session_id="s4")
    replace = find(events, "replace")
    assert replace is not None and replace.file == "lib/util.py"
    command = find(events, "terminal.command")
    assert command is not None and command.command == "python -m pytest"
    assert find(events, "session.end") is not None


def test_aider_adapter() -> None:
    events = get_adapter("aider").parse(AIDER_TRANSCRIPT, session_id="s5")
    replace = find(events, "replace")
    assert replace is not None
    assert replace.file == "config.py"
    assert replace.content.strip() == "DEBUG = True"
    assert replace.count == len("DEBUG = False\n")


def test_cline_adapter() -> None:
    events = get_adapter("cline").parse(CLINE_HISTORY, session_id="s6")
    created = find(events, "file.create")
    assert created is not None and created.file == "svc.py"
    typed = [event for event in events if event.action == "type"]
    assert "".join(event.content or "" for event in typed).startswith("class Svc:")
    command = find(events, "terminal.command")
    assert command is not None and command.command == "python -m pytest"


def test_roo_code_adapter() -> None:
    events = get_adapter("roo-code").parse(ROO_HISTORY, session_id="s7")
    replace = find(events, "replace")
    assert replace is not None and replace.file == "parser.py"
    assert replace.content.strip() == "new"
    command = find(events, "terminal.command")
    assert command is not None and command.command == "cargo test"


def test_generic_adapter() -> None:
    events = get_adapter("generic").parse(GENERIC_DIFF, session_id="s8")
    created = find(events, "file.create")
    assert created is not None and created.file == "src/new.py"
    deleted = find(events, "file.delete")
    assert deleted is not None and deleted.file == "src/gone.py"
    typed = [event for event in events if event.action == "type"]
    assert 'print("hello")' in "".join(event.content or "" for event in typed)


@pytest.mark.parametrize(
    ("agent", "raw"),
    [
        ("claude-code", CLAUDE_CODE_TRANSCRIPT),
        ("opencode", OPENCODE_TRANSCRIPT),
        ("cursor", CURSOR_TRANSCRIPT),
        ("gemini-cli", GEMINI_TRANSCRIPT),
        ("aider", AIDER_TRANSCRIPT),
        ("cline", CLINE_HISTORY),
        ("roo-code", ROO_HISTORY),
        ("generic", GENERIC_DIFF),
    ],
)
def test_adapter_events_validate_against_the_schema(
    agent: str, raw: Any, event_schema: dict
) -> None:
    events = get_adapter(agent).parse(raw, session_id="validate")
    assert events
    for event in events:
        jsonschema.validate(event.to_dict(), event_schema)


@pytest.mark.parametrize(
    ("agent", "raw"),
    [
        ("claude-code", CLAUDE_CODE_TRANSCRIPT),
        ("opencode", OPENCODE_TRANSCRIPT),
        ("cursor", CURSOR_TRANSCRIPT),
        ("gemini-cli", GEMINI_TRANSCRIPT),
        ("aider", AIDER_TRANSCRIPT),
        ("cline", CLINE_HISTORY),
        ("roo-code", ROO_HISTORY),
        ("generic", GENERIC_DIFF),
    ],
)
def test_adapters_are_tolerant_to_unknown_shapes(agent: str, raw: Any) -> None:
    adapter = get_adapter(agent)
    events = adapter.parse(raw, session_id="tolerant")
    baseline = len(events)
    assert baseline > 0
    # Unknown/garbage input must not raise.
    assert adapter.parse({"totally": "unknown"}, session_id="tolerant") == []
    assert adapter.parse([1, 2, 3], session_id="tolerant") == []
    adapter.parse("not json at all", session_id="tolerant")


def test_adapters_parse_a_stream() -> None:
    chunks = [CLAUDE_CODE_TRANSCRIPT[:120], CLAUDE_CODE_TRANSCRIPT[120:]]
    events = list(get_adapter("claude-code").parse_stream(chunks, session_id="stream"))
    assert events
    assert find(events, "session.end") is not None
