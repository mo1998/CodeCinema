# Contributing

## The one rule

**The event schema is the contract.** If you change how CodeCinema records
something, change it in three places:

1. `shared/schemas/event.schema.json` — the machine-readable contract
2. `frontend/lib/engine/events.ts` — the TypeScript projection
3. `backend/app/adapters/base.py` — the Python projection

CI validates every fixture against the schema and both projections against
the fixture, so a missed spot fails the build rather than production.

## Getting set up

```bash
make install      # frontend + backend dependencies
make dev          # API on :8000, web on :3000
make test         # both suites
```

## Repository layout

```
frontend/lib/engine/     the playback engine — no React imports, fully testable
frontend/components/     the player UI
backend/app/adapters/    agent adapters
backend/app/recorder/    the agent-agnostic recorder
backend/app/services/    the server-side reducer and session logic
shared/                  the cross-language contract
docs/                    the design documents
```

## Adding an event type

1. Add the action to `EVENT_ACTIONS` in `shared/schemas/event.schema.json`
   with its payload requirements.
2. Mirror it in `frontend/lib/engine/events.ts` (`EVENT_ACTIONS` +
   `EventPayloadMap`).
3. Mirror it in `backend/app/adapters/base.py` (`EVENT_ACTIONS` +
   the pydantic model + `EventBuilder` method).
4. Handle it in `frontend/lib/engine/state.ts` (the reducer) and, if it
   affects the API, in `backend/app/services/state.py`.
5. If it deserves a timeline entry, add it to `TIMELINE_ACTIONS` and to
   `buildTimelineEntry`.
6. Add a case to `frontend/__tests__/engine.test.ts` and to the Python
   reducer test.

## Adding an agent adapter

See [adapters.md](./adapters.md). The short version: implement `AgentAdapter`,
register it, add a fixture and a test.

## Style

**Frontend** — TypeScript strict, no `any` in public signatures. Tailwind for
styling; design tokens live in `frontend/app/globals.css` under `@theme`. Use
the existing `components/ui` primitives rather than ad-hoc buttons.

**Backend** — `ruff` for lint and format, type hints everywhere, `async` all
the way down the request path. No blocking I/O in a handler. Structured
logging; never log secrets.

## Performance rules

These are not suggestions; they are what keeps a 100 000-event session at
60 fps.

* **Never rebuild a whole file string per frame.** The piece table exists for
  this. Use `PieceTable`, not `content.slice(0, o) + text + content.slice(o)`.
* **Never re-render the whole React tree per frame.** The engine has two
  channels: structural (per event) and display (per frame). Monaco and the
  terminal subscribe to the display channel imperatively.
* **Never mount 100 000 DOM nodes.** The timeline and the explorer use
  windowed rendering.
* **Never rebuild the scrubber histogram per frame.** It is rendered once to
  an offscreen canvas and blitted.

## Testing

```bash
cd frontend && npm run test    # vitest
cd backend  && pytest -q       # pytest
```

Both suites read the same golden fixture from `shared/fixtures/`. If you
change the reducer's behaviour, update the fixture and both expectations.

What deserves a test:

| Change | Test |
| --- | --- |
| Engine behaviour | `frontend/__tests__/engine.test.ts` |
| Text buffer behaviour | `frontend/__tests__/pieceTable.test.ts` |
| Timing simulation | `frontend/__tests__/humanize.test.ts` |
| Adapter mapping | `backend/tests/test_adapters.py` |
| Server-side reducer | `backend/tests/test_state.py` |
| HTTP surface | `backend/tests/test_api_sessions.py` |
| Recorder | `backend/tests/test_recorder.py` |

## Pull requests

* One concern per PR.
* Tests pass locally (`make test`) before you push.
* Describe *why*, not just *what*. The diff already says what.
* Update the docs when you change a contract.

## Reporting bugs

Include the session id (or the NDJSON event log) and what you expected to
see. A replay is reproducible from its log, so the log usually makes the bug
obvious.
