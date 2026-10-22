import 'server-only';
import { fetchEvents } from './client';
import type { SessionEvent } from '@/lib/engine/events';

/**
 * Server-side session loading.
 *
 * The event log is fetched on the server so the first paint already has the
 * full session (no spinner, no partial replay). If the backend is
 * unreachable we return `null` and the caller can fall back to the bundled
 * demo session.
 */
export async function loadSessionEvents(
  sessionId: string,
): Promise<SessionEvent[] | null> {
  try {
    const events = await fetchEvents(sessionId);
    return events as unknown as SessionEvent[];
  } catch {
    return null;
  }
}

export async function loadSessionMeta(sessionId: string) {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ?? 'http://localhost:8000'}/v1/sessions/${sessionId}`,
      { next: { revalidate: 10 } },
    );
    if (!response.ok) return null;
    return (await response.json()) as {
      id: string;
      title: string;
      agent?: string;
      prompt?: string;
      duration_ms?: number;
      event_count?: number;
    };
  } catch {
    return null;
  }
}
