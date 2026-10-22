'use client';

import { useEffect, useMemo, useState } from 'react';
import { PlayerShell } from '@/components/player/PlayerShell';
import { createDemoSession } from '@/lib/demo/session';
import type { SessionEvent } from '@/lib/engine/events';

export default function DemoPage() {
  const [events, setEvents] = useState<SessionEvent[] | null>(null);

  useEffect(() => {
    // Built on the client so the timestamps are generated relative to "now"
    // and the page can be opened straight from the file system.
    setEvents(createDemoSession() as SessionEvent[]);
  }, []);

  const title = useMemo(
    () => 'Building a task-tracking REST API',
    [],
  );

  if (!events) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg text-sm text-faint">
        Preparing demo session…
      </div>
    );
  }

  return (
    <PlayerShell
      events={events}
      title={title}
      agent="claude-code"
      prompt="Build a small Express + TypeScript task API with validation, bearer auth and tests."
      autoplay
      storageKey="codecinema:demo"
    />
  );
}
