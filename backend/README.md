# CodeCinema — Backend

FastAPI backend that records AI coding-agent sessions and replays them like a
human developer typing in VS Code.

The canonical event model lives in `app/adapters/base.py` — a Python
projection of `frontend/lib/engine/events.ts`, validated against
`shared/schemas/event.schema.json`.

## Layout

```
app/
  main.py              FastAPI factory, lifespan, CORS, gzip, error envelope
  core/                config, db, redis, security, errors, logging, ratelimit
  models/              SQLAlchemy 2.0 declarative models
  schemas/             Pydantic v2 request/response models
  api/v1/              REST + websocket routers
  services/            sessions, events, state, snapshots, shares, exports, ingest
  adapters/            one normaliser per agent (7 agents + generic fallback)
  recorder/            repo watcher, command capture, session recorder, CLI
  export/              Playwright renderer, ffmpeg muxing, redis queue worker
  ws/                  connection manager with redis pub/sub fan-out
alembic/               migrations (0001_initial creates the whole schema)
tests/                 pytest suite (runs on SQLite, no Postgres needed)
```

## Requirements

* Python 3.11+
* PostgreSQL (production) — SQLite works for local experiments
* Redis (export queue, websocket fan-out, rate limiting — optional)

## Run it

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

cp .env.example .env          # adjust DATABASE_URL / REDIS_URL
alembic upgrade head          # create the schema

uvicorn app.main:app --reload --port 8000
```

Interactive API docs: <http://localhost:8000/docs>

## Tests

```bash
python -m pytest -q
ruff check app
```

The suite uses `sqlite+aiosqlite` (via the `DATABASE_URL` override) so it needs
no Postgres and no Docker. The models are portable: `JSONB` falls back to
`JSON`, `UUID` falls back to a 32 char hex column and `BIGSERIAL` falls back to
an autoincrementing `INTEGER`.

## API

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/v1/health` | Service health (`db`, `redis`) |
| POST | `/v1/sessions` | Create a session |
| GET | `/v1/sessions` | List sessions (`cursor`, `limit`, `q`, `agent`, `tag`, `sort`) |
| GET | `/v1/sessions/{id}` | Session metadata |
| PATCH | `/v1/sessions/{id}` | Update title / visibility / metadata |
| DELETE | `/v1/sessions/{id}` | Soft delete |
| POST | `/v1/sessions/{id}/events` | Append events (idempotent on `id`) |
| GET | `/v1/sessions/{id}/events` | Cursor-paginated events (`after_seq`, `include_payload`) |
| GET | `/v1/sessions/{id}/events.ndjson` | Newline delimited JSON stream |
| GET | `/v1/sessions/{id}/state?at=` | Folded session state (same shape as the frontend reducer) |
| GET | `/v1/sessions/{id}/stats` | Aggregate counters |
| POST | `/v1/sessions/{id}/publish` | Publish + allocate a share slug |
| GET | `/v1/shares/{slug}` | Public session metadata |
| GET | `/v1/shares/{slug}/events` | Public event stream |
| POST | `/v1/sessions/{id}/exports` | Queue a `json` / `mp4` / `gif` export |
| GET | `/v1/exports/{id}` | Export status |
| GET | `/v1/exports/{id}/download` | Download the artefact |
| GET/POST | `/v1/sessions/{id}/comments` | List / create comments |
| DELETE | `/v1/sessions/{id}/comments/{comment_id}` | Soft delete a comment |
| POST/DELETE | `/v1/sessions/{id}/star` | Star / unstar |
| GET | `/v1/agents` | Adapter registry with capabilities |
| POST | `/v1/ingest/{agent}` | Ingest a raw agent transcript |

Websockets:

| Path | Description |
| ---- | ----------- |
| `WS /v1/sessions/{id}/live` | `{"type":"event"}` frames while recording, periodic `{"type":"stats"}`, `{"type":"done"}`; clients may send `{"type":"ping"}` |
| `WS /v1/sessions/{id}/presence` | Viewer count broadcasts |

Errors always use the envelope `{"error": {"code", "message"}}`.

## Recorder

Record what an agent really does to a worktree (file writes, edits, deletes,
renames, dependency changes, shell commands) and upload it:

```bash
python -m app.recorder.cli record --repo . --agent claude-code \
    --output session.ndjson -- claude "add a login page"

# or upload straight to the API
python -m app.recorder.cli record --repo . --agent claude-code \
    --api-url http://localhost:8000 --api-key cc_... -- claude "add a login page"
```

The watcher polls the worktree (no hard dependency on `watchfiles`) and emits
real diffs: new files are typed out in ~40 character chunks, modified files
produce `select` + `replace` / `type` / `delete` events, and manifest changes
produce `dependency.add` / `dependency.remove` events.

## Exports

* `json` — the canonical session + event stream, no external dependency.
* `mp4` / `gif` — Playwright records the replay page
  (`${PUBLIC_URL}/share/{slug}?export=1&autoplay=1&speed=1`) and ffmpeg
  converts the webm. When ffmpeg is missing the job fails with a clear error
  instead of crashing the worker.

The worker consumes `codecinema:exports` from Redis; run it standalone with:

```bash
python -m app.export.worker
```

## Docker

```bash
docker build -t codecinema-backend ./backend
docker run --rm -p 8000:8000 --env-file backend/.env codecinema-backend
```
