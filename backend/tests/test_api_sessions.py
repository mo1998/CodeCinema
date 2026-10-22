"""End-to-end API tests against the SQLite backed application."""

from __future__ import annotations

import uuid

import pytest_asyncio
from httpx import AsyncClient

from app.core.config import Settings, set_settings
from app.core.db import Database, set_database
from app.core.redis import RedisManager, set_redis_manager
from app.core.security import generate_api_key
from app.main import create_app
from app.models.user import ApiKey, User

EVENTS = [
    {
        "timestamp": 0,
        "action": "session.start",
        "title": "Demo session",
        "agent": "claude-code",
        "id": "evt-start",
    },
    {
        "timestamp": 100,
        "action": "narrate",
        "text": "Creating the module",
        "category": "explanation",
        "id": "evt-narrate",
    },
    {
        "timestamp": 200,
        "action": "file.create",
        "file": "app.py",
        "language": "python",
        "id": "evt-create",
    },
    {
        "timestamp": 300,
        "action": "type",
        "file": "app.py",
        "content": "print('hello')\n",
        "offset": 0,
        "id": "evt-type",
    },
    {
        "timestamp": 400,
        "action": "terminal.command",
        "command": "pytest -q",
        "id": "evt-command",
    },
    {
        "timestamp": 500,
        "action": "session.end",
        "durationMs": 500,
        "id": "evt-end",
    },
]


@pytest_asyncio.fixture
async def api_key(database: Database) -> str:
    """Create a user with an API key and return the raw key."""
    async with database.session() as session:
        user = User(email="tester@codecinema.dev", display_name="Tester")
        session.add(user)
        await session.flush()
        raw, prefix, key_hash = generate_api_key()
        session.add(ApiKey(user_id=user.id, name="test", key_hash=key_hash, key_prefix=prefix))
        await session.commit()
    return raw


@pytest_asyncio.fixture
async def session_id(client: AsyncClient) -> uuid.UUID:
    """A session with a handful of events already appended."""
    response = await client.post(
        "/v1/sessions",
        json={"title": "Demo session", "agent": "claude-code", "visibility": "private"},
    )
    assert response.status_code == 201, response.text
    created = response.json()
    append = await client.post(f"/v1/sessions/{created['id']}/events", json={"events": EVENTS})
    assert append.status_code == 200, append.text
    return uuid.UUID(created["id"])


async def test_health(client: AsyncClient) -> None:
    response = await client.get("/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["db"] == "ok"
    assert body["status"] == "ok"


async def test_create_and_fetch_session(client: AsyncClient) -> None:
    response = await client.post(
        "/v1/sessions",
        json={
            "title": "My session",
            "prompt": "do the thing",
            "agent": "opencode",
            "visibility": "unlisted",
            "metadata": {"repo": "demo"},
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "My session"
    assert body["agent"] == "opencode"
    assert body["visibility"] == "unlisted"
    assert body["metadata"] == {"repo": "demo"}
    assert body["event_count"] == 0

    fetched = await client.get(f"/v1/sessions/{body['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == body["id"]


async def test_missing_session_returns_the_error_envelope(client: AsyncClient) -> None:
    response = await client.get(f"/v1/sessions/{uuid.uuid4()}")
    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "session_not_found"
    assert "message" in body["error"]


async def test_append_events_is_idempotent(client: AsyncClient, session_id: uuid.UUID) -> None:
    response = await client.post(f"/v1/sessions/{session_id}/events", json={"events": EVENTS})
    assert response.status_code == 200
    body = response.json()
    assert body["appended"] == 0
    assert body["duplicates"] == len(EVENTS)
    assert body["session_event_count"] == len(EVENTS)


async def test_append_events_assigns_sequence_numbers(
    client: AsyncClient, session_id: uuid.UUID
) -> None:
    response = await client.get(f"/v1/sessions/{session_id}/events")
    assert response.status_code == 200
    body = response.json()
    assert [event["seq"] for event in body["items"]] == list(range(len(EVENTS)))
    assert body["items"][0]["action"] == "session.start"
    assert body["items"][0]["title"] == "Demo session"


async def test_list_events_paginates(client: AsyncClient, session_id: uuid.UUID) -> None:
    first = await client.get(f"/v1/sessions/{session_id}/events", params={"limit": 2})
    assert first.status_code == 200
    body = first.json()
    assert len(body["items"]) == 2
    assert body["next_cursor"]

    second = await client.get(
        f"/v1/sessions/{session_id}/events", params={"cursor": body["next_cursor"]}
    )
    assert second.status_code == 200
    assert second.json()["items"][0]["seq"] == 2


async def test_list_events_can_drop_the_payload(client: AsyncClient, session_id: uuid.UUID) -> None:
    response = await client.get(
        f"/v1/sessions/{session_id}/events", params={"include_payload": "false"}
    )
    assert response.status_code == 200
    typed = [event for event in response.json()["items"] if event["action"] == "type"]
    assert typed and "content" not in typed[0]


async def test_ndjson_stream(client: AsyncClient, session_id: uuid.UUID) -> None:
    response = await client.get(f"/v1/sessions/{session_id}/events.ndjson")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    lines = [line for line in response.text.splitlines() if line]
    assert len(lines) == len(EVENTS)
    assert '"action":"session.start"' in lines[0]


async def test_state_endpoint_folds_the_events(client: AsyncClient, session_id: uuid.UUID) -> None:
    response = await client.get(f"/v1/sessions/{session_id}/state")
    assert response.status_code == 200
    body = response.json()
    files = {item["path"]: item for item in body["files"]}
    assert files["app.py"]["text"] == "print('hello')\n"
    assert body["terminal"]["lines"][0]["text"] == "pytest -q"
    assert body["meta"]["title"] == "Demo session"

    early = await client.get(f"/v1/sessions/{session_id}/state", params={"at": 150})
    assert early.status_code == 200
    assert early.json()["consumedEvents"] == 2


async def test_stats_are_updated_incrementally(client: AsyncClient, session_id: uuid.UUID) -> None:
    response = await client.get(f"/v1/sessions/{session_id}/stats")
    assert response.status_code == 200
    body = response.json()
    assert body["files_created"] == 1
    assert body["commands"] == 1
    assert body["lines_added"] == 1


async def test_publish_and_fetch_the_share(client: AsyncClient, session_id: uuid.UUID) -> None:
    response = await client.post(f"/v1/sessions/{session_id}/publish")
    assert response.status_code == 200
    body = response.json()
    assert body["visibility"] == "public"
    slug = body["share_slug"]
    assert slug

    share = await client.get(f"/v1/shares/{slug}")
    assert share.status_code == 200
    assert share.json()["session"]["id"] == str(session_id)

    events = await client.get(f"/v1/shares/{slug}/events")
    assert events.status_code == 200
    assert len(events.json()["items"]) == len(EVENTS)


async def test_unknown_share_is_not_found(client: AsyncClient) -> None:
    response = await client.get("/v1/shares/does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "share_not_found"


async def test_comments_lifecycle(client: AsyncClient, session_id: uuid.UUID) -> None:
    created = await client.post(f"/v1/sessions/{session_id}/comments", json={"body": "nice work"})
    assert created.status_code == 201
    comment = created.json()
    assert comment["body"] == "nice work"

    listed = await client.get(f"/v1/sessions/{session_id}/comments")
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    deleted = await client.delete(f"/v1/sessions/{session_id}/comments/{comment['id']}")
    assert deleted.status_code == 204

    listed = await client.get(f"/v1/sessions/{session_id}/comments")
    assert listed.json() == []


async def test_starring_requires_authentication(client: AsyncClient, session_id: uuid.UUID) -> None:
    unauthorized = await client.post(f"/v1/sessions/{session_id}/star")
    assert unauthorized.status_code == 401
    assert unauthorized.json()["error"]["code"] == "unauthorized"


async def test_starring_with_an_api_key(
    client: AsyncClient, session_id: uuid.UUID, api_key: str
) -> None:
    headers = {"Authorization": f"Bearer {api_key}"}
    starred = await client.post(f"/v1/sessions/{session_id}/star", headers=headers)
    assert starred.status_code == 200
    assert starred.json()["stars"] == 1
    assert starred.json()["starred"] is True

    again = await client.post(f"/v1/sessions/{session_id}/star", headers=headers)
    assert again.json()["stars"] == 1

    unstarred = await client.delete(f"/v1/sessions/{session_id}/star", headers=headers)
    assert unstarred.status_code == 200
    assert unstarred.json()["stars"] == 0


async def test_listing_sessions_paginates_with_a_cursor(client: AsyncClient) -> None:
    for index in range(5):
        await client.post("/v1/sessions", json={"title": f"Session {index}"})

    first = await client.get("/v1/sessions", params={"limit": 2})
    assert first.status_code == 200
    page = first.json()
    assert len(page["items"]) == 2
    assert page["next_cursor"]

    second = await client.get("/v1/sessions", params={"limit": 2, "cursor": page["next_cursor"]})
    assert second.status_code == 200
    assert len(second.json()["items"]) == 2
    ids = {item["id"] for item in page["items"]}
    assert not ids & {item["id"] for item in second.json()["items"]}


async def test_listing_sessions_supports_filters_and_sorting(
    client: AsyncClient, session_id: uuid.UUID
) -> None:
    await client.post(
        "/v1/sessions",
        json={"title": "Another one", "agent": "cursor", "tags": ["demo"]},
    )
    response = await client.get("/v1/sessions", params={"agent": "cursor"})
    assert response.status_code == 200
    body = response.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["agent"] == "cursor"

    by_tag = await client.get("/v1/sessions", params={"tag": "demo"})
    assert len(by_tag.json()["items"]) == 1

    by_query = await client.get("/v1/sessions", params={"q": "Another"})
    assert len(by_query.json()["items"]) == 1

    popular = await client.get("/v1/sessions", params={"sort": "popular"})
    assert popular.status_code == 200
    assert len(popular.json()["items"]) == 2

    invalid = await client.get("/v1/sessions", params={"sort": "nope"})
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "invalid_sort"


async def test_patch_and_soft_delete(client: AsyncClient, session_id: uuid.UUID) -> None:
    patched = await client.patch(
        f"/v1/sessions/{session_id}", json={"title": "Renamed", "visibility": "unlisted"}
    )
    assert patched.status_code == 200
    assert patched.json()["title"] == "Renamed"
    assert patched.json()["visibility"] == "unlisted"

    deleted = await client.delete(f"/v1/sessions/{session_id}")
    assert deleted.status_code == 204

    gone = await client.get(f"/v1/sessions/{session_id}")
    assert gone.status_code == 404


async def test_export_job_is_created(client: AsyncClient, session_id: uuid.UUID) -> None:
    response = await client.post(f"/v1/sessions/{session_id}/exports", json={"type": "json"})
    assert response.status_code == 201
    job = response.json()
    assert job["status"] == "queued"
    assert job["type"] == "json"

    status_response = await client.get(f"/v1/exports/{job['id']}")
    assert status_response.status_code == 200
    assert status_response.json()["id"] == job["id"]


async def test_json_export_is_rendered_by_the_worker(
    client: AsyncClient, session_id: uuid.UUID, database: Database
) -> None:
    from app.export.worker import ExportWorker

    created = await client.post(f"/v1/sessions/{session_id}/exports", json={"type": "json"})
    job_id = uuid.UUID(created.json()["id"])

    worker = ExportWorker(database=database)
    async with database.session():
        job = await worker.process(job_id)

    assert job.status == "succeeded"
    assert job.progress == 1.0
    assert job.file_path and job.file_size

    download = await client.get(f"/v1/exports/{job_id}/download")
    assert download.status_code == 200
    payload = download.json()
    assert payload["session"]["id"] == str(session_id)
    assert len(payload["events"]) == len(EVENTS)


async def test_ingest_endpoint_stores_events(client: AsyncClient) -> None:
    transcript = (
        '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1",'
        '"name":"Write","input":{"file_path":"ingest.py","content":"x = 1\\n"}}]}}\n'
    )
    response = await client.post(
        "/v1/ingest/claude-code", json={"raw": transcript, "title": "Ingested"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["appended"] > 0
    assert body["agent"] == "claude-code"

    events = await client.get(f"/v1/sessions/{body['session_id']}/events")
    assert events.status_code == 200
    assert any(event["action"] == "file.create" for event in events.json()["items"])


async def test_ingest_with_an_unknown_agent(client: AsyncClient) -> None:
    response = await client.post("/v1/ingest/nope", json={"raw": "{}"})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "unknown_agent"


async def test_agents_registry(client: AsyncClient) -> None:
    response = await client.get("/v1/agents")
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 8
    assert all(item["capabilities"] for item in items)


async def test_invalid_event_is_rejected(client: AsyncClient) -> None:
    created = await client.post("/v1/sessions", json={"title": "x"})
    response = await client.post(
        f"/v1/sessions/{created.json()['id']}/events",
        json={"events": [{"timestamp": 0, "action": "not.an.action"}]},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_websocket_live_stream(settings: Settings, tmp_path) -> None:
    """The live socket pushes events as they are appended."""
    from starlette.testclient import TestClient

    ws_settings = settings.model_copy(
        update={
            "database_url": f"sqlite+aiosqlite:///{tmp_path / 'ws.db'}",
            "auto_create_tables": True,
        }
    )
    set_settings(ws_settings)
    set_redis_manager(RedisManager(None))
    set_database(Database(ws_settings.database_url))
    app = create_app(ws_settings)
    try:
        with TestClient(app) as client:
            created = client.post("/v1/sessions", json={"title": "ws", "agent": "opencode"})
            assert created.status_code == 201
            session_id = created.json()["id"]

            with client.websocket_connect(f"/v1/sessions/{session_id}/live") as socket:
                stats = socket.receive_json()
                assert stats["type"] == "stats"

                socket.send_json({"type": "ping"})
                assert socket.receive_json()["type"] == "pong"

                appended = client.post(
                    f"/v1/sessions/{session_id}/events",
                    json={
                        "events": [
                            {
                                "timestamp": 10,
                                "action": "narrate",
                                "text": "hello from the recorder",
                                "id": "ws-1",
                            }
                        ]
                    },
                )
                assert appended.status_code == 200
                frame = socket.receive_json()
                assert frame["type"] == "event"
                assert frame["event"]["text"] == "hello from the recorder"

            with client.websocket_connect(f"/v1/sessions/{session_id}/presence") as socket:
                presence = socket.receive_json()
                assert presence["type"] == "presence"
                assert presence["viewers"] >= 1
    finally:
        set_database(None)
        set_settings(None)
