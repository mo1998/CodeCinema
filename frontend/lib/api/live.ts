'use client';

import { useEffect, useRef, useState } from 'react';
import type { SessionEvent } from '@/lib/engine/events';

export type LiveStatus = 'connecting' | 'live' | 'closed' | 'error';

export interface LiveSessionOptions {
  sessionId: string;
  /** Called for every event the server pushes. */
  onEvent: (event: SessionEvent) => void;
  /** Called when the server reports the recording has finished. */
  onDone?: () => void;
  /** Called on every stats update. */
  onStats?: (stats: Record<string, unknown>) => void;
  enabled?: boolean;
}

/**
 * Subscribe to a live recording.
 *
 * The server pushes each event as it is appended, so a viewer can watch an
 * agent work in real time — the same engine drives live tailing and replay,
 * which means "live" and "replay" are the same code path.
 */
export function useLiveSession({
  sessionId,
  onEvent,
  onDone,
  onStats,
  enabled = true,
}: LiveSessionOptions): { status: LiveStatus; viewers: number } {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [viewers, setViewers] = useState(0);
  const eventHandler = useRef(onEvent);
  const doneHandler = useRef(onDone);
  const statsHandler = useRef(onStats);
  eventHandler.current = onEvent;
  doneHandler.current = onDone;
  statsHandler.current = onStats;

  useEffect(() => {
    if (!enabled || !sessionId) return;

    const base =
      process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ?? 'http://localhost:8000';
    const url = `${base.replace(/^http/, 'ws')}/v1/sessions/${sessionId}/live`;

    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let closed = false;

    const connect = () => {
      if (closed) return;
      setStatus('connecting');
      try {
        socket = new WebSocket(url);
      } catch {
        setStatus('error');
        return;
      }

      socket.onopen = () => {
        attempts = 0;
        setStatus('live');
      };

      socket.onmessage = (message) => {
        try {
          const payload = JSON.parse(message.data as string) as {
            type: string;
            event?: SessionEvent;
            stats?: Record<string, unknown>;
            viewers?: number;
          };
          if (payload.type === 'event' && payload.event) {
            eventHandler.current(payload.event);
          } else if (payload.type === 'stats' && payload.stats) {
            statsHandler.current?.(payload.stats);
            if (typeof payload.viewers === 'number') setViewers(payload.viewers);
          } else if (payload.type === 'done') {
            doneHandler.current?.();
          }
        } catch {
          /* ignore malformed frame */
        }
      };

      socket.onerror = () => setStatus('error');

      socket.onclose = () => {
        if (closed) return;
        setStatus('closed');
        // Exponential backoff, capped at 15s.
        attempts += 1;
        const delay = Math.min(15_000, 500 * 2 ** Math.min(attempts, 5));
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [sessionId, enabled]);

  return { status, viewers };
}
