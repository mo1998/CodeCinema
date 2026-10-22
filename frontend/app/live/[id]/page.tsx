import { loadSessionMeta } from '@/lib/api/server';
import { PlayerShell } from '@/components/player/PlayerShell';

export const dynamic = 'force-dynamic';

/**
 * Live mode — watch an agent work as it happens.
 *
 * The same playback engine drives this: the server pushes each event over a
 * WebSocket and the engine appends it, so a live tail and a replay are the
 * same code path with a different event source.
 */
export default async function LivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const meta = await loadSessionMeta(id);

  return (
    <PlayerShell
      events={[]}
      sessionId={id}
      live
      title={meta?.title ?? 'Live recording'}
      agent={meta?.agent}
      prompt={meta?.prompt}
    />
  );
}
