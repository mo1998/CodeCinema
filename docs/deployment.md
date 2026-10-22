# Deployment

CodeCinema is three processes plus two datastores:

| Process | Responsibility | Scaling |
| --- | --- | --- |
| `web` | Next.js standalone server | horizontal, stateless |
| `api` | FastAPI (REST + WebSocket) | horizontal, stateless (Redis pub/sub fans out) |
| `worker` | export renderer (Playwright + ffmpeg) | vertical — CPU heavy, one job at a time per worker |
| `postgres` | event log + metadata | vertical, then read replicas |
| `redis` | live fan-out + export queue | single node is fine at this scale |

## Docker Compose (single host)

```bash
cp .env.example .env
# edit .env: set SECRET_KEY and the passwords
docker compose up --build -d
docker compose exec api alembic upgrade head
```

The web app is served on `:3000`, the API on `:8000` (OpenAPI at
`/docs`).

### Behind a reverse proxy

The API serves WebSockets, so the proxy must forward them:

```nginx
server {
  listen 443 ssl http2;
  server_name codecinema.example.com;

  location /api/ {
    proxy_pass http://api:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 3600s;   # live recordings are long-lived
  }

  location / {
    proxy_pass http://web:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

`NEXT_PUBLIC_API_URL` must point at the public API origin so the browser can
reach the WebSocket and the event stream.

## Production checklist

### Configuration

| Variable | Notes |
| --- | --- |
| `SECRET_KEY` | **Required.** Use 32+ random bytes. Rotating it invalidates every API key. |
| `DATABASE_URL` | `postgresql+asyncpg://…` |
| `REDIS_URL` | `redis://…` — used for pub/sub and the export queue |
| `PUBLIC_URL` | Absolute base URL, used to build share links and export targets |
| `CORS_ORIGINS` | Comma-separated list. Do not use `*` in production. |
| `STORAGE_DIR` | Where rendered MP4/GIF files land. Mount a volume. |

### Database

```bash
alembic upgrade head
```

Migrations are plain Alembic revisions; there is no separate "seed" step.

Useful maintenance queries:

```sql
-- Sessions whose event log is unexpectedly large
SELECT s.id, s.title, count(e.id) AS events
FROM sessions s JOIN session_events e ON e.session_id = s.id
GROUP BY s.id ORDER BY events DESC LIMIT 20;

-- Reclaim space from soft-deleted sessions
DELETE FROM session_events
WHERE session_id IN (SELECT id FROM sessions WHERE deleted_at IS NOT NULL);
```

The event log is append-only, so the table grows monotonically. If you need
to prune old sessions, delete the rows (the FK cascades handle the rest) and
`VACUUM ANALYZE`.

### The export worker

The worker needs:

* **Playwright + Chromium** — `playwright install --with-deps chromium`
* **ffmpeg** — for MP4 and GIF conversion
* **Monaco reachable from the browser** — CodeCinema serves Monaco from its
  own origin (`public/monaco/vs`), so the renderer works without egress.

Check the worker is healthy:

```bash
docker compose exec worker python -c "import app.export.worker as w; print('ok')"
```

If ffmpeg is missing, exports fail with a clear error rather than crashing
the worker — the job moves to `failed` with the reason in `exports.error`.

### Resource limits

Video rendering is the only heavy part. A 10-minute session at 1920×1080
needs roughly 2 GB of RAM and one core per worker. Start with a single worker
and scale out if the queue backs up.

```yaml
deploy:
  resources:
    limits:
      cpus: '2'
      memory: 4G
```

Postgres needs the most I/O:

```yaml
command: >
  postgres -c shared_buffers=1GB
           -c effective_cache_size=3GB
           -c work_mem=32MB
           -c max_connections=200
```

### Storage

Rendered exports are written to `STORAGE_DIR`. For more than a few thousand
files, put them behind an object store: the export job stores a path, and
`GET /v1/exports/{id}/download` streams it. Keep the directory on a volume
that survives restarts, or the job will report `succeeded` while the file is
gone.

## Kubernetes

The pieces map cleanly onto Deployments and StatefulSets:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: codecinema-api
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: api
          image: ghcr.io/your-org/codecinema/api:latest
          ports: [{ containerPort: 8000 }]
          envFrom:
            - secretRef: { name: codecinema-secrets }
            - configMapRef: { name: codecinema-config }
          readinessProbe:
            httpGet: { path: /v1/health, port: 8000 }
            initialDelaySeconds: 10
          livenessProbe:
            httpGet: { path: /v1/health, port: 8000 }
            periodSeconds: 20
```

Notes:

* Use a `Service` of type `LoadBalancer` or an Ingress with WebSocket
  support.
* The `worker` is a separate Deployment with `replicas: 1` and
  `Recreate` strategy — two workers on one volume would race on the output
  directory.
* `postgres` and `redis` should be managed services (RDS, ElastiCache,
  Cloudflare, Upstash). If you self-host Postgres, use a StatefulSet with a
  PVC per replica.

## Observability

* The API exposes `/v1/health`, which reports database and Redis reachability.
* Structured logs go to stdout in JSON — ship them with your collector.
* The most useful dashboards: event ingest rate, export queue depth, export
  failure rate, WebSocket connection count.

## Backups

| What | How |
| --- | --- |
| Postgres | `pg_dump` on a schedule. The event log is the only irreplaceable data. |
| Rendered exports | Optional — they can be re-rendered from the log. |
| Redis | Not needed. It holds no durable state. |

## Upgrading

```bash
git pull
docker compose build
docker compose run --rm api alembic upgrade head
docker compose up -d
```

Migrations run before the new containers start. The event schema is
backwards compatible by construction: new actions are added, never removed or
repurposed, and old events keep their original meaning.
