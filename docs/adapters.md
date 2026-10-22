# Agent adapters

An adapter translates one agent's native output into the canonical event
stream described in [event-model.md](./event-model.md). Adapters never invent
events: they map what the agent actually did.

Two mechanisms feed the same log:

```
┌───────────────────────────────────────────────────────────────────┐
│  Generic recorder — works with ANY agent                          │
│  watches the git worktree + the shell                             │
│  → file.create / type / replace / delete / rename                 │
│  → terminal.command / write / exit                                │
│  → dependency.add                                                 │
└───────────────────────────────────────────────────────────────────┘
┌───────────────────────────────────────────────────────────────────┐
│  Agent adapters — semantic enrichment                             │
│  parse the agent's own output stream                              │
│  → think (reasoning) / narrate (intent)                          │
│  → build.* / test.* / error / fix                                 │
│  → more precise edit boundaries (select → replace)               │
└───────────────────────────────────────────────────────────────────┘
```

Run both together for the richest replay.

## The contract

```python
class AgentAdapter(ABC):
    name: str
    display_name: str
    capabilities: set[str]

    def parse(self, raw: str | dict | list, *, session_id: str) -> list[SessionEvent]: ...
    def parse_stream(self, chunks: Iterable[str], *, session_id: str) -> Iterator[SessionEvent]: ...
```

Register an adapter in `backend/app/adapters/registry.py` and it becomes
available at `POST /v1/ingest/{agent}` and `GET /v1/agents`.

### Rules for every adapter

1. **Be tolerant.** An unknown shape is skipped, never raised. Agent output
   formats change between releases; a parser that crashes on a new field
   takes out the whole ingest path.
2. **Never fabricate.** If the agent did not report a build, do not emit a
   `build.success`.
3. **Stay monotonic.** Timestamps must never decrease. `EventBuilder`
   enforces this.
4. **Be idempotent.** Attach a stable `id` derived from the source record so
   re-ingesting a transcript does not duplicate events.

### `EventBuilder`

The builder assigns timestamps, so adapters never compute time themselves:

```python
builder = EventBuilder(session_id=session_id)
builder.think(duration=1800, thought="Designing the API surface")
builder.narrate("Creating the API endpoint")
builder.file_create("src/routes/tasks.py")
builder.type_text("src/routes/tasks.py", "def list_tasks():\n")
builder.terminal_command("pytest -q")
builder.terminal_exit(code=0)
builder.error("AssertionError: expected 200, got 404", file="tests/test_routes.py", line=42)
builder.fix("Returned the correct status code.", file="src/routes/tasks.py")
events = builder.build()
```

## Per-agent mapping

### OpenCode

**Source:** the OpenCode server's event stream (`/event` endpoint) or the SDK.

Relevant messages: `message.updated`, `tool.start`, `tool.execute`,
`tool.finish`, `session.idle`.

| Native tool | Canonical events |
| --- | --- |
| `edit` | `select` + `replace` (old→new string) |
| `write` | `file.create` + `insert` |
| `read` | no file event; optional `narrate` |
| `bash` | `terminal.command` → `terminal.write`* → `terminal.exit` |
| `patch` | `select` + `replace` per hunk |
| `todowrite` | `narrate` with category `todo` |

Assistant text becomes `narrate`; reasoning parts become `think`.

### Claude Code

**Source:** `claude --output-format stream-json` (one JSON object per line).

Structure: objects with `type` ∈ `assistant`, `user`, `system`, `result`;
assistant messages carry `content[]` blocks with `type` ∈ `text`, `thinking`,
`tool_use`.

| Native tool | Canonical events |
| --- | --- |
| `Write` | `file.create` + `insert` |
| `Edit` | `select` (length of `old_string`) + `replace` |
| `MultiEdit` | one `select` + `replace` per edit, in order |
| `Bash` | `terminal.command` + `terminal.write`* + `terminal.exit` |
| `NotebookEdit` | `replace` per cell |
| `Read` / `Grep` / `Glob` | no file events |

`thinking` blocks become `think` with the thought text; `text` blocks become
`narrate`.

### Cursor

**Source:** `cursor-agent --output-format stream-json`.

| Native tool | Canonical events |
| --- | --- |
| `edit_file` | `select` + `replace` |
| `write_file` | `file.create` + `insert` |
| `delete_file` | `file.delete` |
| `read_file` / `grep` / `codebase_search` | no file events |
| `run_terminal_cmd` | `terminal.command` + `terminal.write`* + `terminal.exit` |

### Gemini CLI

**Source:** `gemini --output-format stream-json`.

Events with `type` ∈ `content`, `tool_use`, `tool_call`, `tool_result`,
`stats`.

| Native tool | Canonical events |
| --- | --- |
| `replace` | `select` + `replace` |
| `write_file` | `file.create` + `insert` |
| `read_file` / `glob` / `search_file_content` | no file events |
| `run_shell_command` | `terminal.command` + `terminal.write`* + `terminal.exit` |

### Aider

**Source:** the chat history (`~/.aider.chat.history.md`) plus the applied
diff.

Aider's chat history contains fenced code blocks with `SEARCH/REPLACE`
sections. Those map precisely:

```
<<<<<<< SEARCH
old text
=======
new text
>>>>>>> REPLACE
```

becomes `select` (length of the old text) + `replace`. The `thinking` blocks
in the history become `think`; the prose becomes `narrate`.

### Cline

**Source:** VS Code `globalStorage` task history
(`~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/tasks/*.json`).

Records are typed `ask` / `say` / `tool`.

| Native tool | Canonical events |
| --- | --- |
| `newFile` / `editedExistingFile` | `file.create` + `insert` / `select` + `replace` |
| `readFile` | no file events |
| `executeCommand` | `terminal.command` + `terminal.write`* + `terminal.exit` |
| `listFiles` / `searchFiles` | no file events |

### Roo Code

Same shape as Cline but a different extension id and storage directory
(`rooveterinaryinc.roo-cline`), and the conversation history is nested under
`apiConversationHistory` rather than `messages`.

## The generic recorder

`backend/app/recorder/repo_watcher.py` is the agent-agnostic path. It polls
the working tree (or uses `watchfiles` when available), ignoring `.git`,
`node_modules`, `.venv`, `__pycache__`, `dist`, `build` and `.next`.

For each changed path it compares against the last known content and emits:

| Change | Events |
| --- | --- |
| New file | `file.create`, then `type` chunks (~40 chars) at human speed |
| Line appended | `type` for the new lines |
| Line removed | `delete` for the removed characters |
| Block rewritten | `select` (the old block) + `replace` (the new block) |
| File removed | `file.delete` |
| File moved | `file.rename` |

It also diffs dependency manifests (`package.json`, `requirements.txt`,
`pyproject.toml`, `Cargo.toml`, `go.mod`, `build.gradle`) and emits
`dependency.add` / `dependency.remove`.

`command_capture.py` tails the shell history files and converts detected
commands into `terminal.command` events, so `npm install`, `pytest`, `git
commit` and friends appear in the replay even if the agent never reports them.

## Recording a session

```bash
python -m app.recorder.cli record \
  --repo ~/projects/my-app \
  --agent claude-code \
  --output session.ndjson \
  -- claude -p "add a health endpoint and tests"
```

The output is NDJSON — one canonical event per line. Push it to the API:

```bash
curl -X POST http://localhost:8000/v1/ingest/claude-code \
  -H 'Content-Type: application/json' \
  -d "{\"session_id\": \"$SESSION_ID\", \"raw\": $(jq -Rs . < session.ndjson)}"
```

## Writing a new adapter

1. Create `backend/app/adapters/<agent>.py` with a class implementing
   `AgentAdapter`.
2. Add a fixture under `backend/tests/fixtures/<agent>.json` — a realistic
   transcript, trimmed but not edited into shape.
3. Add `backend/tests/test_adapters.py::test_<agent>` asserting the expected
   canonical events, and validate them against
   `shared/schemas/event.schema.json`.
4. Register it in `registry.py`.

The CI schema job will fail if your adapter emits an event that does not
match the shared contract.
