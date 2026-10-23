import { Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Play } from 'lucide-react';
import { api } from '@/lib/api/client';
import { createDemoSession } from '@/lib/demo/session';
import { formatDuration, relativeTime } from '@/lib/format';
import type { SessionEvent } from '@/lib/engine/events';

export const dynamic = 'force-dynamic';

function EventCount({ events }: { events: SessionEvent[] }) {
  return <span>{events.length.toLocaleString()} events</span>;
}

export default async function ExplorePage() {
  let sessions: Awaited<ReturnType<typeof api.listSessions>>['items'] = [];
  let backendReachable = true;
  try {
    sessions = (await api.listSessions({ limit: 40 })).items;
  } catch {
    backendReachable = false;
    sessions = [];
  }

  const demoEvents = createDemoSession();

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
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Recorded sessions
        </h1>
        <p className="mt-1.5 text-[13px] text-muted">
          Every replay is an immutable event log — seekable, scrubbable and
          frame-accurate.
        </p>

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
                <Suspense fallback={<span>…</span>}>
                  <EventCount events={demoEvents} />
                </Suspense>
                <span>{formatDuration(demoEvents[demoEvents.length - 1].timestamp)}</span>
              </div>
            </div>
          </Link>

          {sessions.map((session) => (
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
                </div>
              </div>
            </Link>
          ))}

          {sessions.length === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-surface/50 p-8 text-center">
              {backendReachable ? (
                <>
                  <p className="text-[13px] text-muted">
                    No recorded sessions yet. The backend is reachable.
                  </p>
                  <p className="mt-1 text-[12px] text-faint">
                    Record one with{' '}
                    <code className="rounded bg-surface-3 px-1 py-0.5 font-mono">
                      python -m app.recorder.cli record --repo . --agent manual --output session.ndjson -- your-command
                    </code>
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[13px] text-muted">
                    The backend is not reachable, so only the bundled demo session
                    is listed.
                  </p>
                  <p className="mt-1 text-[12px] text-faint">
                    Start the API with{' '}
                    <code className="rounded bg-surface-3 px-1 py-0.5 font-mono">
                      docker compose up
                    </code>{' '}
                    (or run it locally) to record and browse real sessions.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
