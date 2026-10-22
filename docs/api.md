# API reference

Base URL: `http://localhost:8000` · prefix: `/v1`

Interactive documentation (OpenAPI UI): **`/docs`** · schema: **`/openapi.json`**

## Conventions

**Errors** are always JSON:

```json
{ "error": { "code": "not_found", "message": "Session not found" } }
```

| Status | Meaning |
| --- | --- |
| `400` | Malformed request |
| `401` | Authentication required |
| `404` | Resource does not exist |
| `409` | Conflict (e.g. duplicate event id with different content) |
| `422` | Validation failed — the body names the offending field |
| `429` | Rate limited |

**Authentication** is optional. Read endpoints are public; write endpoints
accept either an API key or a bearer token:

```
Authorization: Bearer cc_live_xxxxxxxxxxxx
```

**Pagination** is cursor-based. List endpoints return
`{"items": [...], "next_cursor": "..."}`; pass `next_cursor` back as `cursor`
to get the next page. Cursors are opaque.

**Rate limiting** applies to write endpoints (token bucket in Redis).

---

## Health

### `GET /v1/health`

```json
{ "status": "ok", "database": "ok", "redis": "ok", "version": "0.1.0" }
```

Returns `503` when a dependency is unreachable.

---

## Sessions

### `POST /v1/sessions`

Create a session.

```json
{
  "title": "Building a task-tracking REST API",
  "prompt": "Build a small Express + TypeScript task API",
  "agent": "claude-code",
  "repo_url": "https://github.com/demo/task-api",
  "branch": "main",
  "visibility": "private"
}
```

`visibility` ∈ `private` · `unlisted` · `public`.

**201** → the session object.

### `GET /v1/sessions`

| Parameter | Default | Notes |
| --- | --- | --- |
| `cursor` | – | Opaque pagination cursor |
| `limit` | `40` | 1–200 |
| `q` | – | Free-text search over title and prompt |
| `agent` | – | Filter by agent |
| `tag` | – | Filter by tag |
| `sort` | `newest` | `newest` · `popular` · `duration` |

```json
{
  "items": [
    {
      "id": "0f9c…",
      "title": "Building a task-tracking REST API",
      "prompt": "…",
      "agent": "claude-code",
      "repo_url": "…",
      "visibility": "public",
      "share_slug": "k3f9d1",
      "duration_ms": 128652,
      "event_count": 286,
      "created_at": "2026-10-22T14:02:11Z",
      "published_at": "2026-10-22T14:03:02Z",
      "stars": 12
    }
  ],
  "next_cursor": "eyJzZXFf…"
}
```

### `GET /v1/sessions/{session_id}`

Returns one session, or `404`.

### `PATCH /v1/sessions/{session_id}`

Update `title`, `visibility`, `repo_url`, `branch`, `tags` or `metadata`.

### `DELETE /v1/sessions/{session_id}`

Soft delete → `204`. The row keeps a `deleted_at` timestamp; the events are
removed by a separate retention job.

### `POST /v1/sessions/{session_id}/publish`

Publishes the session and allocates a share slug.

```json
{
  "id": "0f9c…",
  "visibility": "public",
  "share_slug": "k3f9d1",
  "share_url": "https://codecinema.example.com/share/k3f9d1",
  "published_at": "2026-10-22T14:03:02Z"
}
```

### `GET /v1/sessions/{session_id}/stats`

```json
{
  "files_created": 9,
  "files_modified": 4,
  "files_deleted": 0,
  "lines_added": 412,
  "lines_deleted": 13,
  "commands": 9,
  "errors": 2,
  "fixes": 2,
  "builds": 2,
  "duration_ms": 128652
}
```

---

## Events

### `POST /v1/sessions/{session_id}/events`

Append events. **Idempotent** on each event's `id`: re-posting the same batch
does not duplicate anything.

```json
{
  "events": [
    { "timestamp": 0, "action": "session.start", "title": "…", "agent": "claude-code" },
    { "timestamp": 600, "action": "think", "duration": 2400, "thought": "…" }
  ]
}
```

Every event is validated against
[`shared/schemas/event.schema.json`](../shared/schemas/event.schema.json).
An invalid event is rejected with `422` and the offending field.

```json
{
  "appended": 2,
  "duplicates": 0,
  "session_event_count": 2
}
```

Appending also broadcasts the events over the session's live WebSocket.

### `GET /v1/sessions/{session_id}/events`

| Parameter | Default | Notes |
| --- | --- | --- |
| `after_seq` | – | Return events with a higher sequence number |
| `cursor` | – | Opaque pagination cursor |
| `limit` | `500` | 1–2000 |
| `include_payload` | `true` | Set `false` for a metadata-only listing |

```json
{
  "items": [
    { "seq": 0, "timestamp": 0, "action": "session.start", "payload": { "…": "…" } }
  ],
  "next_cursor": "…"
}
```

### `GET /v1/sessions/{session_id}/events.ndjson`

The same events as **newline-delimited JSON**, streamed. This is what the
player uses to load a session: it parses incrementally and compresses well.

```
Content-Type: application/x-ndjson

{"seq":0,"timestamp":0,"action":"session.start","payload":{…}}
{"seq":1,"timestamp":600,"action":"think","payload":{…}}
```

### `GET /v1/sessions/{session_id}/state?at=<ms>`

The folded session state at a point in time — the server-side mirror of the
playback engine's reducer.

| Parameter | Default | Notes |
| --- | --- | --- |
| `at` | end of session | Milliseconds since `session.start` |

```json
{
  "at": 60000,
  "files": { "src/auth.ts": { "text": "…", "language": "typescript" } },
  "file_order": ["package.json", "src/auth.ts"],
  "tabs": ["src/auth.ts"],
  "active_file": "src/auth.ts",
  "terminal": { "lines": [ { "id": 3, "kind": "command", "text": "npm test" } ] },
  "narration": [],
  "timeline": [],
  "dependencies": [],
  "build": { "status": "failed", "errors": ["src/auth.ts(11,25): error TS2532"] },
  "errors": [],
  "fixes": [],
  "meta": { "title": "…", "agent": "claude-code" }
}
```

---

## Shares

### `GET /v1/shares/{slug}`

Public session metadata. No authentication.

### `GET /v1/shares/{slug}/events`

Public event stream. No authentication.

---

## Ingest

### `GET /v1/agents`

The adapter registry.

```json
{
  "items": [
    {
      "name": "claude-code",
      "display_name": "Claude Code",
      "capabilities": ["stream", "thinking", "tools"],
      "description": "…"
    }
  ]
}
```

### `POST /v1/ingest/{agent}`

The main ingestion path. The adapter normalises a raw agent transcript into
canonical events and appends them.

```json
{
  "session_id": "0f9c…",
  "raw": "…the transcript…",
  "title": "Building a task-tracking REST API",
  "prompt": "…",
  "repo_url": "…",
  "visibility": "private"
}
```

`raw` accepts a string, a JSON array or a JSON object, depending on what the
agent produced. `session_id` is optional — omit it to create a new session.

```json
{
  "session_id": "0f9c…",
  "agent": "claude-code",
  "appended": 286,
  "duplicates": 0,
  "session_event_count": 286
}
```

Supported `agent` values: `opencode`, `claude-code`, `cursor`, `gemini-cli`,
`aider`, `cline`, `roo-code`, `generic`.

The `generic` adapter accepts a unified diff:

```json
{ "raw": "diff --git a/src/app.py b/src/app.py\n@@ …" }
```

---

## Comments

### `GET /v1/sessions/{session_id}/comments`

### `POST /v1/sessions/{session_id}/comments`

```json
{ "body": "The type error at 14:02 is a great teaching moment." }
```

### `DELETE /v1/sessions/{session_id}/comments/{comment_id}`

---

## Stars

### `GET /v1/sessions/{session_id}/stars`

```json
{ "session_id": "0f9c…", "stars": 12, "starred": false }
```

### `POST /v1/sessions/{session_id}/star` · `DELETE /v1/sessions/{session_id}/star`

Requires authentication.

---

## Exports

### `POST /v1/sessions/{session_id}/exports`

```json
{ "type": "mp4" }
```

`type` ∈ `json` · `mp4` · `gif`.

**201** →

```json
{
  "id": "e1f2…",
  "session_id": "0f9c…",
  "type": "mp4",
  "status": "queued",
  "progress": 0.0,
  "file_size": null,
  "error": null,
  "created_at": "2026-10-22T14:05:00Z"
}
```

### `GET /v1/exports/{export_id}`

Poll for progress. `status` moves `queued` → `running` → `succeeded` |
`failed`.

### `GET /v1/exports/{export_id}/download`

Streams the rendered file. `409` if the job has not succeeded.

---

## WebSockets

### `WS /v1/sessions/{session_id}/live`

Pushes every appended event as it is recorded.

```json
{ "type": "event", "event": { "seq": 12, "timestamp": 4200, "action": "type", "payload": { "…": "…" } } }
{ "type": "stats", "stats": { "event_count": 286, "duration_ms": 128652 } }
{ "type": "done" }
```

Send `{"type": "ping"}` to keep the connection warm; the server replies with
`{"type": "pong"}`.

### `WS /v1/sessions/{session_id}/presence`

Viewer counts.

```json
{ "type": "presence", "viewers": 7 }
```

---

## The recorder CLI

Recording is a client-side concern; the CLI writes NDJSON and pushes it.

```bash
cd backend
python -m app.recorder.cli record \
  --repo ~/projects/my-app \
  --agent claude-code \
  --output session.ndjson \
  -- claude -p "add a health endpoint and tests"

# Push it to the API
curl -X POST http://localhost:8000/v1/ingest/claude-code \
  -H 'Content-Type: application/json' \
  -d "{\"raw\": $(jq -Rs . < session.ndjson)}"
```

| Flag | Default | Notes |
| --- | --- | --- |
| `--repo` | cwd | The working tree to watch |
| `--agent` | `generic` | Adapter used to enrich the stream |
| `--output` | stdout | NDJSON destination |
| `--interval` | `0.25` | Polling interval in seconds |
| `--push` | off | Push to the API as the session records |

---

## Client SDK (TypeScript)

`frontend/lib/api/client.ts` wraps the endpoints used by the player:

```ts
import { api, fetchEvents } from '@/lib/api/client';

const sessions = await api.listSessions({ limit: 20, agent: 'claude-code' });
const events = await fetchEvents(sessions.items[0].id);
const job = await api.createExport(sessions.items[0].id, 'mp4');
```

Live sessions use `useLiveSession` (`frontend/lib/api/live.ts`), which
reconnects with exponential backoff and appends incoming events to the
playback engine.
