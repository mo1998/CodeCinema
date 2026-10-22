# The event model

The canonical event model is the contract between every part of CodeCinema:
the recorders that produce events, the API that stores them, and the browser
that replays them.

* **Machine-readable schema:** [`shared/schemas/event.schema.json`](../shared/schemas/event.schema.json)
* **TypeScript projection:** [`frontend/lib/engine/events.ts`](../frontend/lib/engine/events.ts)
* **Python projection:** `backend/app/adapters/base.py`
* **Golden fixture:** [`shared/fixtures/sample-session.json`](../shared/fixtures/sample-session.json)

CI validates every fixture against the JSON Schema and both projections
against the fixture, so the three cannot drift.

## Principles

1. **A session is a list of events.** Nothing else is stored. Every view —
   the editor, the terminal, the timeline, the architecture graph — is derived.
2. **Time is relative.** `timestamp` is milliseconds since `session.start`,
   not a wall-clock timestamp. A replay is identical regardless of when it was
   recorded.
3. **Events are immutable and idempotent.** Every event may carry an `id`;
   re-ingesting the same event must not duplicate it.
4. **Monotonic order.** `timestamp` never decreases within a session. `seq`
   (assigned by the server) is the tiebreaker.
5. **Unknown fields are preserved.** Adapters may attach extra detail; the
   schema allows it and the reducer ignores what it does not understand.

## The envelope

```jsonc
{
  "timestamp": 1200,          // ms since session.start
  "action": "type",           // discriminator
  "seq": 42,                  // server-assigned, monotonic
  "actor": "agent",           // agent | human | system | tool
  "id": "evt_01H..."          // idempotency key
}
```

## Action catalogue

### Session lifecycle

| Action | Payload | Notes |
| --- | --- | --- |
| `session.start` | `title`, `agent`, `prompt`, `repo`, `model` | Always the first event. |
| `session.end` | `durationMs`, `summary` | Optional closing marker. |

### Cognition

| Action | Payload | Notes |
| --- | --- | --- |
| `think` | `duration`, `thought` | The agent is reasoning. `duration` drives the "Thinking…" indicator. |
| `narrate` | `text`, `category`, `file?` | Educational mode. `category` ∈ `explanation`, `decision`, `warning`, `summary`, `todo`. |
| `pause` | `duration` | An idle beat with no explanation attached. |

### Filesystem — the code changes

| Action | Payload | Notes |
| --- | --- | --- |
| `file.create` | `file`, `language?` | Also opens the file (it becomes the active tab). |
| `file.delete` | `file` | |
| `file.rename` | `file`, `to` | |
| `type` | `file`, `content`, `offset?`, `profile?` | **Progressive.** `offset` defaults to end-of-file. |
| `insert` | `file`, `content`, `offset` | Atomic insertion. |
| `delete` | `file`, `count`, `offset?` | Removes `count` characters. |
| `replace` | `file`, `offset`, `count`, `content` | Atomic replacement of a block. |

`type` is the workhorse. `insert`, `delete` and `replace` exist for agents
that report atomic operations (a `Write` tool call, a whole-block `Edit`).

The difference between `type` and `insert` matters: `type` is animated
character by character, `insert` appears at once. A `Write` tool call that
dumps 400 lines at once is an `insert`; a human typing a function line by
line is a sequence of `type` events.

#### Typing profiles

`type` may carry a `profile` that biases the simulated keyboard:

```jsonc
{
  "cps": 7.5,                 // base characters per second
  "jitter": 0.35,             // per-character variance
  "punctuationPauseMs": 90,
  "newlinePauseMs": 160,
  "indentPauseMs": 120,
  "keywordPauseMs": 320       // the beat before a def/class/function block
}
```

The playback engine honours these; a profile with a high `cps` produces a
brisk agent, a low one a deliberate one.

### Interface — what the human would see

| Action | Payload | Notes |
| --- | --- | --- |
| `focus` | `file` | Switch to (or open) a tab. |
| `close` | `file` | Close a tab. |
| `cursor` | `file`, `offset` | Character offset. |
| `select` | `file`, `offset`, `length` | Selection highlight. |
| `scroll` | `file`, `top` | Scroll position in lines. |

### Execution — what the agent ran

| Action | Payload | Notes |
| --- | --- | --- |
| `terminal` | `command?`, `text?`, `exitCode?` | Catch-all terminal event. |
| `terminal.open` | — | Terminal panel opened. |
| `terminal.command` | `command` | Streamed character by character. |
| `terminal.write` | `text`, `kind?` | Output (`output` or `error`). |
| `terminal.exit` | `exitCode` | Process result. |
| `build.start` | `target?` | |
| `build.success` | `durationMs?` | |
| `build.failure` | `errors?`, `durationMs?` | |
| `test.start` | `command?` | |
| `test.result` | `passed`, `failed`, `durationMs?` | |
| `error` | `message`, `file?`, `line?`, `column?` | An error the agent encountered. |
| `fix` | `message`, `file?` | A correction. Resolves the most recent unresolved error. |
| `dependency.add` | `name`, `version?`, `manager?` | |
| `dependency.remove` | `name`, `manager?` | |

## Worked example

A single logical edit — the agent fixing a type error — becomes four events:

```jsonc
// 1. the agent notices and reads the error
{ "timestamp": 3900, "action": "error",
  "message": "AssertionError: expected 200, got 404",
  "file": "tests/test_health.py", "line": 12 }

// 2. it selects the line it is about to rewrite
{ "timestamp": 4300, "action": "select",
  "file": "src/health.py", "offset": 0, "length": 13 }

// 3. it rewrites the line
{ "timestamp": 4700, "action": "replace",
  "file": "src/health.py", "offset": 0, "count": 13,
  "content": "def health() -> dict[str, str]:" }

// 4. it says what it did
{ "timestamp": 5200, "action": "fix",
  "message": "Added the missing return type annotation.",
  "file": "src/health.py" }
```

The playback engine turns (3) into a character-by-character rewrite, because
`replace` is rendered as a selection followed by typed replacement. The
selection event (2) is what makes the viewer *see* the agent select the old
line before overwriting it — the detail that makes a replay feel human.

## Offsets

`offset` and `count` are **character** offsets into the file's content *at the
moment the event is applied*, not line/column pairs. The reducer applies
events strictly in order, so the content at any offset is well-defined.

The `select` event is the exception in spirit: it describes what the human
*highlighted*, so it should cover the region that the following `replace` will
overwrite.

## Adapters: producing canonical events

Adapters never invent events. They translate:

| Native concept | Canonical events |
| --- | --- |
| A file was written in one shot | `file.create` + `insert` |
| A block was edited | `select` + `replace` (+ `type` for the new text) |
| A shell command ran | `terminal.command` + `terminal.write`* + `terminal.exit` |
| The model paused to think | `think` |
| The model wrote prose | `narrate` |
| The build failed | `build.failure` + `error`* |
| A dependency was added | `dependency.add` |

\* optional — the recorder may have captured it already. Events are
idempotent, so a duplicate is harmless.

## Validation

The schema is enforced in three places:

1. **CI** validates every fixture in `shared/fixtures/`.
2. **Ingest** validates the incoming batch before it is written.
3. **Tests** in both languages assert that a malformed event is rejected.

An event that does not validate is rejected with a 422 and a pointer to the
offending field — never silently dropped.
