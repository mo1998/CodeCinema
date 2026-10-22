# Architecture

> CodeCinema records how AI coding agents actually work and replays the whole
> session like a senior engineer working live in VS Code.

## 1. The problem

AI coding agents produce code. What they do *not* produce is a record of the
work: the first attempt that failed, the error the agent read at 14:02, the
line it rewrote, the build it ran to check. A PR diff is the residue of a
session, not the session.

Existing "AI replay" tools screen-record a terminal. That captures pixels, not
structure: you cannot scrub it, you cannot jump to the error, you cannot
translate it into another agent's format, and you cannot search it.

CodeCinema's answer is **event sourcing**. The session *is* a log. The
replay is a deterministic fold over that log, rendered at 60fps in the
browser.

```
  agent  ──▶  adapter  ──▶  canonical events  ──▶  append-only log
                                                              │
                                                              ▼
                                             browser fold  ──▶  60fps playback
```

Three properties fall out of this:

| Property | Why it follows |
| --- | --- |
| Scrubbable | State at any `t` is a pure function of the events before `t`. |
| Faithful | We store what happened, not a rendering of what happened. |
| Portable | One canonical format; every agent adapter produces it. |

## 2. System shape

```
┌───────────────────────────────────────────────────────────────────────────┐
│                             Browser (Next.js)                             │
│                                                                           │
│  ┌─────────────────┐   ┌───────────────────────────────────────────────┐  │
│  │  PlayerShell    │   │  PlaybackEngine                              │  │
│  │  ┌───────────┐  │   │  ┌────────────┐  ┌───────────┐  ┌─────────┐ │  │
│  │  │ Explorer  │  │   │  │  Reducer   │  │  Clock    │  │ Checkpt │ │  │
│  │  ├───────────┤  │   │  │ (pure fold)│  │ (rAF)     │  │  cache  │ │  │
│  │  │  Monaco   │  │◀──│  └────────────┘  └───────────┘  └─────────┘ │  │
│  │  ├───────────┤  │   │        │               │            │        │  │
│  │  │ Terminal  │  │   │  structural        display      seek O(1)    │  │
│  │  └───────────┘  │   │  channel           channel                 │  │
│  ├─────────────────┤   └───────────────────────────────────────────────┘  │
│  │ Timeline/Reason │              ▲                    ▲               │
│  │ Progress/Arch   │──────────────┘                    │               │
│  └─────────────────┘                          WebSocket (live mode)      │
└───────────────────────────────────┬───────────────────────────────────────┘
                                    │ REST + NDJSON
┌───────────────────────────────────▼───────────────────────────────────────┐
│                              API (FastAPI)                                │
│  sessions · events · state · shares · comments · stars · exports          │
│  WS /sessions/{id}/live  ──▶  broadcast every appended event              │
└───────┬───────────────────────────┬──────────────────────────┬────────────┘
        │                           │                          │
┌───────▼────────┐        ┌─────────▼────────┐      ┌──────────▼─────────┐
│  PostgreSQL    │        │      Redis       │      │  Export worker     │
│  append-only   │        │  live fan-out    │      │  Playwright+ffmpeg │
│  session_events│        │  export queue    │      │  → mp4 / gif       │
└────────────────┘        └──────────────────┘      └────────────────────┘
```

## 3. Event sourcing

### 3.1 The log is the truth

`session_events` is append-only. Nothing ever updates or deletes a row (soft
deletes happen at the *session* level). Every derived artefact — the project
tree, the statistics, the architecture graph — is a projection that can be
rebuilt from the log.

This is not architecture astronautics; it is what makes the product work:

* **Seeking** — restore the nearest checkpoint, replay forward.
* **Sharing** — a share link points at a log, not a rendered artifact.
* **Re-recording** — a session can be re-rendered with different timing
  ("slow motion", "skip to the error") without touching the source.
* **Debugging** — if the replay looks wrong, the log says exactly what the
  agent did.

### 3.2 Event taxonomy

The full catalogue lives in [`event-model.md`](./event-model.md) and the
machine-readable contract is
[`shared/schemas/event.schema.json`](../shared/schemas/event.schema.json).

Events fall into five families:

| Family | Actions | Purpose |
| --- | --- | --- |
| Session | `session.start`, `session.end` | Frame the recording. |
| Cognition | `think`, `narrate`, `pause` | What the agent was reasoning about. |
| Filesystem | `file.create`, `file.delete`, `file.rename`, `type`, `insert`, `delete`, `replace` | The actual code changes. |
| Interface | `focus`, `close`, `cursor`, `select`, `scroll` | What the human would see. |
| Execution | `terminal.*`, `build.*`, `test.*`, `error`, `fix`, `dependency.*` | What the agent ran and what happened. |

The **filesystem** and **execution** families are the ones that matter. They
are recorded from the real repository and the real shell — not inferred from
the agent's chat output.

### 3.3 Why `type` events carry chunks, not characters

One event per character would be honest but absurd: a 400-line file is ~15 000
events, and a busy session would carry millions. The recorded event says
*"these 42 characters were written here"*; the **playback engine** expands it
into per-character timing using a seeded PRNG.

The seed is derived from the session id, file path and event index, so the
expansion is deterministic: two viewers scrubbing to the same millisecond see
exactly the same pixels, and a reload reproduces the session exactly.

The expansion is not arbitrary. `humanizeChunk` adds:

* a base delay of `1000 / cps` ms (default 7.5 cps ≈ an average typist),
* jitter of ±35 %,
* a pause after `,` and `;`,
* a longer pause after a newline,
* a pause after indentation,
* a **deliberate beat before a `def`/`class`/`function` block** — the moment a
  human hesitates before committing to a structure.

If the next recorded event arrives before the chunk has finished typing, the
engine compresses the chunk to fit. That is not a compromise: a 40-character
chunk produced in 150 ms *was* a paste, and it should look like one.

## 4. The playback engine

`frontend/lib/engine/engine.ts` is framework-agnostic and has four
responsibilities.

### 4.1 The reducer is pure

`state.ts` folds events into state. It knows nothing about time, speed or
animation. The same fold in Python (`backend/app/services/state.py`) produces
the same answer, which is how `GET /v1/sessions/{id}/state?at=…` can answer
"what did the repository look like at 14:02" without shipping the client a
second implementation.

### 4.2 Two channels, one clock

The engine publishes **two** separate view channels:

* **structural** — files, tabs, timeline, narration, build status. Changes
  once per event.
* **display** — the text currently visible in the editor, the terminal
  lines. Changes up to 60 times per second.

If these were one channel, a 60fps typing animation would re-render the
timeline, the explorer and the architecture graph on every frame. Splitting
them is what keeps the replay smooth while the rest of the UI stays still.

React binds to the structural channel with `useSyncExternalStore`; Monaco and
the terminal subscribe to the display channel *imperatively*, so a frame's
text change becomes a single `model.applyEdits` call instead of a React
render.

### 4.3 Checkpoints make seeking cheap

Folding 100 000 events takes hundreds of milliseconds. The engine therefore
snapshots the reducer state every `max(200, events / 192)` events. A seek
restores the nearest checkpoint at or before the target and replays forward
from there.

`primeCheckpoints()` builds the whole checkpoint set in the background, in
8 ms slices, so the first scrub to the end of a long session is instant rather
than janky.

### 4.4 Text buffers are ropes, not strings

Replaying 100 000 edits against a plain JS string is O(n²): every edit copies
the whole file. `pieceTable.ts` is a piece table — an edit is O(log n) to
locate plus O(1) to record, and the O(n) flattening is paid only when the
text is actually read. It compacts periodically so the piece array stays
bounded.

## 5. Recording

Two paths produce canonical events.

### 5.1 The generic recorder (any agent)

`backend/app/recorder/` watches a git worktree and the shell. It does not
care which agent is running:

* new file → `file.create` + `type` events, chunked at human typing speed;
* modified file → line diff against the last known content → `replace`
  (rewritten block), `type` (appended lines) and `delete` (removed lines);
* deleted file → `file.delete`;
* renamed file → `file.rename`;
* `package.json` / `requirements.txt` / `Cargo.toml` diffs → `dependency.add`;
* shell commands → `terminal.command` → `terminal.write` → `terminal.exit`.

This is the path that satisfies *"don't just replay the final code — record
the agent's actual changes"*. It works with any agent, including agents we
have never heard of.

### 5.2 Agent adapters (semantic enrichment)

Adapters parse each agent's native output and add what the recorder cannot
see: reasoning (`think`), intent (`narrate`), build results, and structured
tool calls.

| Agent | Native source | Tool mapping |
| --- | --- | --- |
| OpenCode | server `/event` stream | `edit`, `write`, `read`, `bash`, `patch` |
| Claude Code | `--output-format stream-json` | `Write`, `Edit`, `MultiEdit`, `Bash` |
| Cursor | `cursor-agent --output-format stream-json` | `edit_file`, `write_file`, `run_terminal_cmd` |
| Gemini CLI | `--output-format stream-json` | `replace`, `write_file`, `run_shell_command` |
| Aider | chat history + applied diff | `SEARCH/REPLACE` blocks |
| Cline | VS Code `globalStorage` task history | `new/editExistingFile`, `executeCommand` |
| Roo Code | VS Code `globalStorage` task history | same shape, different source |

Adapters are deliberately **tolerant**: an unknown event shape is skipped, not
fatal. Agent output formats change between releases; a parser that crashes on
a new field would take out the whole ingest path.

### 5.3 Why an append-only log beats a diff

A git diff tells you the *net* change. It cannot tell you that the agent
wrote the function, deleted it, rewrote it, and only then got it right. The
event log preserves that sequence, which is precisely the part that teaches a
viewer something.

## 6. Storage

| Table | Purpose |
| --- | --- |
| `session_events` | The append-only log. `(session_id, seq)` and `(session_id, event_id)` are unique. |
| `session_snapshots` | Precomputed reducer states at given event indices. |
| `session_stats` | Incremental aggregates (files, lines, commands, errors, fixes). |
| `sessions` | Metadata, visibility, share slug, lifecycle. |
| `exports` | Render jobs for JSON / MP4 / GIF. |
| `comments`, `session_stars` | The community layer. |

Events are delivered to the browser as NDJSON — one JSON object per line —
which streams, compresses well and parses without a wrapper.

## 7. Export

* **JSON** — the canonical session: metadata plus the full event log.
* **MP4 / GIF** — a Playwright renderer opens the replay URL with
  `?export=1`, waits for `window.__CODECINEMA_READY__`, records the page with
  Playwright's video capture, and converts the WebM with ffmpeg
  (`libx264` + `yuv420p` for MP4, `palettegen`/`paletteuse` for GIF).

The render runs in a separate worker process consuming a Redis queue, so a
ten-minute video never blocks an API request. If ffmpeg is missing the job
fails with a clear message instead of crashing the worker.

Monaco is served from our own origin rather than a CDN precisely so that this
renderer works in a container without egress.

## 8. Performance envelope

The stated target is 100 000+ events at 60 fps.

| Concern | Approach |
| --- | --- |
| Event fold | O(1) amortised per event; piece table for text. |
| Seeking | Checkpoint restore + short forward replay. |
| Timeline list | Windowed rendering — only the visible rows are mounted. |
| Scrubber | Canvas; the density histogram is rendered once and blitted. |
| Terminal | Bounded to 2 000 lines; streamed reveal computed by the engine. |
| React churn | Structural vs. display channels; Monaco updated imperatively. |
| Memory | Snapshots capped at 192; piece tables compact automatically. |

## 9. Extension points

* **New agent** — implement `AgentAdapter` in `backend/app/adapters/`, register
  it, add a fixture. Nothing else changes.
* **New event type** — add it to `shared/schemas/event.schema.json`, the
  TypeScript `EVENT_ACTIONS` list and the Python `EVENT_ACTIONS` list. The
  schema contract job in CI fails if the three drift apart.
* **New playback visualisation** — subscribe to the engine's display channel
  and render whatever you like; the engine does not assume a layout.
* **New export format** — implement it in `backend/app/export/` and register
  it with the job creator.

## 10. Deliberate non-goals

* **No screen recording.** Pixels are not data. The event log is.
* **No plugin sandbox for the browser.** The player renders a *log*; there is
  nothing to execute. The plugin system lives in the recorder and the export
  pipeline, where it can be sandboxed properly.
* **No agent that runs the code for you.** CodeCinema observes; it does not
  modify the agent's behaviour.
