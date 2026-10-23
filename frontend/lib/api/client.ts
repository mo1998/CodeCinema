/**
 * Backend API client.
 *
 * The Next.js app is the presentation layer; the FastAPI service owns
 * sessions, events and exports. Every call degrades gracefully when the
 * backend is unreachable so the player still works in a fully client-side
 * (demo / offline) mode.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ?? 'http://localhost:8000';

export interface SessionSummary {
  id: string;
  title: string;
  prompt?: string;
  agent?: string;
  repo_url?: string;
  visibility: 'private' | 'unlisted' | 'public';
  share_slug?: string | null;
  duration_ms: number;
  event_count: number;
  created_at: string;
  published_at?: string | null;
  tags?: string[];
  stars?: number;
  comments?: number;
}

export interface SessionDetail extends SessionSummary {
  metadata?: Record<string, unknown>;
  stats?: SessionStats;
}

export interface SessionStats {
  files_created: number;
  files_modified: number;
  files_deleted: number;
  lines_added: number;
  lines_deleted: number;
  commands: number;
  errors: number;
  fixes: number;
  builds: number;
  duration_ms: number;
}

export type ExportType = 'json' | 'mp4' | 'gif';

export interface ExportJob {
  id: string;
  session_id: string;
  type: ExportType;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  progress: number;
  file_size?: number | null;
  error?: string | null;
  created_at: string;
  completed_at?: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  init?: RequestInit & { token?: string },
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (init?.token) headers.set('Authorization', `Bearer ${init.token}`);

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    let code: string | undefined;
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as {
        error?: { code?: string; message?: string };
        detail?: string;
      };
      code = body.error?.code;
      message = body.error?.message ?? body.detail ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, response.status, code);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Fetch the full event stream for a session. */
export async function fetchEvents(
  sessionId: string,
  options: { signal?: AbortSignal; token?: string } = {},
): Promise<Record<string, unknown>[]> {
  const response = await fetch(`${API_BASE}/v1/sessions/${sessionId}/events.ndjson`, {
    signal: options.signal,
    headers: options.token ? { Authorization: `Bearer ${options.token}` } : undefined,
  });
  if (!response.ok) {
    throw new ApiError(`Failed to load events (${response.status})`, response.status);
  }
  const body = await response.text();
  const events: Record<string, unknown>[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      /* skip malformed line */
    }
  }
  return events;
}

export const api = {
  health: () => request<{ status: string }>('/v1/health'),

  listSessions: (params: Record<string, string | number | undefined> = {}) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') search.set(key, String(value));
    }
    const query = search.toString();
    return request<{ items: SessionSummary[]; next_cursor: string | null }>(
      `/v1/sessions${query ? `?${query}` : ''}`,
    );
  },

  getSession: (id: string) => request<SessionDetail>(`/v1/sessions/${id}`),

  updateSession: (id: string, body: { title?: string; visibility?: string; tags?: string[]; metadata?: Record<string, unknown> }) =>
    request<SessionDetail>(`/v1/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteSession: (id: string) =>
    request<void>(`/v1/sessions/${id}`, { method: 'DELETE' }),

  createSession: (body: {
    title: string;
    prompt?: string;
    agent?: string;
    visibility?: string;
  }) =>
    request<SessionDetail>('/v1/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  publishSession: (id: string) =>
    request<{ id: string; share_slug: string; share_url?: string }>(
      `/v1/sessions/${id}/publish`,
      { method: 'POST' },
    ),

  createExport: (id: string, type: ExportType) =>
    request<ExportJob>(`/v1/sessions/${id}/exports`, {
      method: 'POST',
      body: JSON.stringify({ type }),
    }),

  getExport: (exportId: string) => request<ExportJob>(`/v1/exports/${exportId}`),

  listExports: (sessionId: string) =>
    request<ExportJob[]>(`/v1/sessions/${sessionId}/exports`),

  listAgents: () =>
    request<
      {
        name: string;
        display_name: string;
        capabilities: string[];
        description?: string;
      }[]
    >('/v1/agents'),

  comments: (id: string) =>
    request<
      { id: string; body: string; created_at: string; author?: { display_name?: string } }[]
    >(`/v1/sessions/${id}/comments`),

  addComment: (id: string, body: string, token?: string) =>
    request<{ id: string }>(`/v1/sessions/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
      token,
    }),

  deleteComment: (sessionId: string, commentId: string, token?: string) =>
    request<void>(`/v1/sessions/${sessionId}/comments/${commentId}`, {
      method: 'DELETE',
      token,
    }),

  getStars: (id: string) =>
    request<{ session_id: string; stars: number; starred: boolean }>(
      `/v1/sessions/${id}/stars`,
    ),

  starSession: (id: string, token?: string) =>
    request<{ session_id: string; stars: number; starred: boolean }>(
      `/v1/sessions/${id}/star`,
      { method: 'POST', token },
    ),

  unstarSession: (id: string, token?: string) =>
    request<{ session_id: string; stars: number; starred: boolean }>(
      `/v1/sessions/${id}/star`,
      { method: 'DELETE', token },
    ),
};
