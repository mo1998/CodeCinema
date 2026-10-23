'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Play, Search } from 'lucide-react';
import { api } from '@/lib/api/client';
import { createDemoSession } from '@/lib/demo/session';
import { formatDuration, relativeTime } from '@/lib/format';
import type { SessionEvent } from '@/lib/engine/events';

function EventCount({ events }: { events: SessionEvent[] }) {
  return <span>{events.length.toLocaleString()} events</span>;
}

const AGENTS = [
  'opencode',
  'claude-code',
  'cursor',
  'gemini-cli',
  'aider',
  'cline',
  'roo-code',
];

const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'popular', label: 'Popular' },
  { value: 'duration', label: 'Longest' },
];

export default function ExplorePage() {
  const [q, setQ] = useState('');
  const [agent, setAgent] = useState('');
  const [sort, setSort] = useState('newest');
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.listSessions>>['items']>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [backendReachable, setBackendReachable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const demoEvents = createDemoSession();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (nextCursor?: string | null, append = false) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const result = await api.listSessions({
          limit: 40,
          q: q || undefined,
          agent: agent || undefined,
          sort,
          cursor: nextCursor ?? undefined,
        });
        setItems((prev) => (append ? [...prev, ...result.items] : result.items));
        setCursor(result.next_cursor);
        setBackendReachable(true);
      } catch (err) {
        setBackendReachable(false);
        if (!append) setItems([]);
        setError(err instanceof Error ? err.message : 'Failed to load sessions');
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [q, agent, sort],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setCursor(null);
      void load(null, false);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, agent, sort, load]);

  return (
    <main className="min-h-screen bg-bg">
      <header className="flex h-12 items-center gap-3 border-b border-border bg-surface px-4">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.png" alt="CodeCinema" width={24} height={24} className="h-6 w-6 rounded-md" />
          <span className="text-[13px] font-semibold tracking-tight text-text">
            CodeCinema
          </span>
        </Link>
        <span className="ml-2 text-[12px] text-faint">Explore</span>
        <Link href="/manage" className="ml-auto text-[12px] text-muted hover:text-text">
          Manage
        </Link>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Recorded sessions
        </h1>
        <p className="mt-1.5 text-[13px] text-muted">
          Every replay is an immutable event log — seekable, scrubbable and
          frame-accurate.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search sessions…"
              className="h-9 w-full rounded-md border border-border bg-surface-2 pl-9 pr-3 text-[13px] text-text placeholder:text-faint focus:border-accent-border focus:outline-none"
            />
          </label>
          <select
            value={agent}
            onChange={(event) => setAgent(event.target.value)}
            className="h-9 rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text focus:border-accent-border focus:outline-none"
          >
            <option value="">All agents</option>
            {AGENTS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            className="h-9 rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text focus:border-accent-border focus:outline-none"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-8 space-y-2">
          <Link
            href="/demo"
            className="group flex items-center gap-4 rounded-lg border border-accent-border bg-accent-soft/30 p-4 transition-colors hover:bg-accent-soft/50"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-white">
              <Play className="ml-0.5 h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[14px] font-medium text-text">
                  Building a task-tracking REST API
                </span>
                <span className="rounded-full border border-accent-border bg-accent-soft px-2 py-0.5 font-mono text-[10px] text-accent">
                  demo
                </span>
              </div>
              <p className="mt-0.5 truncate text-[12px] text-muted">
                Express + TypeScript task API with validation, bearer auth, a
                failing build and the fix that makes the tests pass.
              </p>
              <div className="mt-1 flex items-center gap-3 text-[11px] text-faint">
                <span>claude-code</span>
                <EventCount events={demoEvents} />
                <span>{formatDuration(demoEvents[demoEvents.length - 1].timestamp)}</span>
              </div>
            </div>
          </Link>

          {loading && (
            <div className="rounded-lg border border-border bg-surface p-6 text-center text-[13px] text-muted">
              Loading sessions…
            </div>
          )}

          {!loading && items.map((session) => (
            <Link
              key={session.id}
              href={`/session/${session.id}`}
              className="group flex items-center gap-4 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-2"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-3 text-muted">
                <Play className="ml-0.5 h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-text">
                  {session.title}
                </div>
                {session.prompt && (
                  <p className="mt-0.5 truncate text-[12px] text-muted">
                    {session.prompt}
                  </p>
                )}
                <div className="mt-1 flex items-center gap-3 text-[11px] text-faint">
                  {session.agent && <span>{session.agent}</span>}
                  <span>{session.event_count.toLocaleString()} events</span>
                  <span>{formatDuration(session.duration_ms)}</span>
                  <span>{relativeTime(session.created_at)}</span>
                  {typeof session.stars === 'number' && (
                    <span>★ {session.stars}</span>
                  )}
                </div>
              </div>
            </Link>
          ))}

          {!loading && items.length === 0 && backendReachable && (
            <div className="rounded-lg border border-dashed border-border bg-surface/50 p-8 text-center">
              <p className="text-[13px] text-muted">
                No recorded sessions match these filters.
              </p>
            </div>
          )}

          {!backendReachable && !loading && (
            <div className="rounded-lg border border-dashed border-border bg-surface/50 p-8 text-center">
              <p className="text-[13px] text-muted">
                The backend is not reachable, so only the bundled demo session is
                listed.
              </p>
              <p className="mt-1 text-[12px] text-faint">
                Start the API with{' '}
                <code className="rounded bg-surface-3 px-1 py-0.5 font-mono">
                  docker compose up
                </code>{' '}
                (or run it locally) to record and browse real sessions.
              </p>
              {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}
            </div>
          )}

          {cursor && !loading && (
            <button
              onClick={() => void load(cursor, true)}
              disabled={loadingMore}
              className="w-full rounded-lg border border-border bg-surface py-2.5 text-[13px] text-muted transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}