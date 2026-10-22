import { loadSessionEvents, loadSessionMeta } from '@/lib/api/server';
import { PlayerShell } from '@/components/player/PlayerShell';
import { createDemoSession } from '@/lib/demo/session';

export const dynamic = 'force-dynamic';

export default async function SharePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [events, meta] = await Promise.all([
    loadSessionEvents(slug),
    loadSessionMeta(slug),
  ]);

  if (!events) {
    const demo = createDemoSession();
    return (
      <PlayerShell
        events={demo}
        title="Building a task-tracking REST API"
        agent="claude-code"
        prompt="Build a small Express + TypeScript task API with validation, bearer auth and tests."
        autoplay
      />
    );
  }

  return (
    <PlayerShell
      events={events}
      sessionId={slug}
      title={meta?.title}
      agent={meta?.agent}
      prompt={meta?.prompt}
      autoplay
    />
  );
}
