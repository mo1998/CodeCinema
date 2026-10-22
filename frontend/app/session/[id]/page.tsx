import { notFound } from 'next/navigation';
import { loadSessionEvents, loadSessionMeta } from '@/lib/api/server';
import { PlayerShell } from '@/components/player/PlayerShell';
import { createDemoSession } from '@/lib/demo/session';

export const dynamic = 'force-dynamic';

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [events, meta] = await Promise.all([
    loadSessionEvents(id),
    loadSessionMeta(id),
  ]);

  if (!events) {
    // No backend, or no such session — show the demo rather than a dead page.
    const demo = createDemoSession();
    return (
      <PlayerShell
        events={demo}
        title="Building a task-tracking REST API"
        agent="claude-code"
        prompt="Build a small Express + TypeScript task API with validation, bearer auth and tests."
        storageKey={`codecinema:session:${id}`}
      />
    );
  }

  return (
    <PlayerShell
      events={events}
      sessionId={id}
      title={meta?.title}
      agent={meta?.agent}
      prompt={meta?.prompt}
      storageKey={`codecinema:session:${id}`}
    />
  );
}
