'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  FilePlus2,
  FilePenLine,
  FileX2,
  Hammer,
  Play,
  Sparkles,
  TerminalSquare,
  Wrench,
} from 'lucide-react';
import { useEngine, useEngineDisplay, useSessionOverview } from '@/lib/engine/usePlayback';
import type { TimelineEntry, TimelineKind } from '@/lib/engine/state';
import { VirtualList } from '@/components/ui/VirtualList';
import { formatTime } from '@/lib/format';
import { clsx } from 'clsx';

const ICONS: Record<TimelineKind, typeof FilePlus2> = {
  session: Play,
  think: Sparkles,
  file: FilePlus2,
  edit: FilePenLine,
  terminal: TerminalSquare,
  build: Hammer,
  test: CheckCircle2,
  error: AlertTriangle,
  fix: Wrench,
  narration: Bug,
  dependency: FilePlus2,
};

const KIND_COLOR: Record<TimelineKind, string> = {
  session: 'text-faint',
  think: 'text-faint',
  file: 'text-info',
  edit: 'text-accent',
  terminal: 'text-success',
  build: 'text-warn',
  test: 'text-warn',
  error: 'text-danger',
  fix: 'text-success',
  narration: 'text-muted',
  dependency: 'text-[#C792EA]',
};

export function TimelinePanel() {
  const engine = useEngine();
  const time = useEngineDisplay((display) => display.time);
  const [query, setQuery] = useState('');

  const overview = useSessionOverview();

  const entries = useMemo(() => {
    const timeline = overview?.timeline ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return timeline;
    return timeline.filter(
      (entry) =>
        entry.label.toLowerCase().includes(needle) ||
        (entry.detail ?? '').toLowerCase().includes(needle) ||
        (entry.file ?? '').toLowerCase().includes(needle),
    );
  }, [overview?.timeline, query]);

  // Index of the last event that has happened at the current playback time.
  // The list scrolls to keep it visible, so the panel follows the session
  // instead of staying pinned to the first events.
  const currentIndex = useMemo(() => {
    let low = 0;
    let high = entries.length - 1;
    let result = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (entries[mid].timestamp <= time) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return result;
  }, [entries, time]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border p-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter events…"
          className="h-7 w-full rounded-sm border border-border bg-surface-2 px-2 text-[12px] text-text placeholder:text-faint focus:border-accent-border focus:outline-none"
        />
      </div>

      <VirtualList
        className="min-h-0 flex-1"
        items={entries}
        itemHeight={34}
        getKey={(entry) => String(entry.id)}
        scrollToIndex={currentIndex >= 0 ? currentIndex : null}
        emptyState={
          <div className="px-3 py-6 text-center text-[11px] text-faint">
            {overview
              ? 'No events match this filter.'
              : 'Indexing the session…'}
          </div>
        }
        renderItem={(entry: TimelineEntry) => {
          const Icon = ICONS[entry.kind];
          const isPast = entry.timestamp <= time;
          const isCurrent = Math.abs(entry.timestamp - time) < 400;
          return (
            <button
              onClick={() => engine.seek(entry.timestamp)}
              className={clsx(
                'group flex h-[34px] w-full items-center gap-2 border-l-2 px-2.5 text-left transition-colors',
                isCurrent
                  ? 'border-accent bg-accent-soft/60'
                  : 'border-transparent hover:bg-surface-2',
                isPast ? 'opacity-100' : 'opacity-45',
              )}
            >
              <Icon className={clsx('h-3.5 w-3.5 shrink-0', KIND_COLOR[entry.kind])} />
              <span className="w-11 shrink-0 font-mono text-[10px] tabular-nums text-faint">
                {formatTime(entry.timestamp)}
              </span>
              <span className="shrink-0 text-[12px] text-text">{entry.label}</span>
              <span className="truncate text-[11px] text-faint">
                {entry.detail ?? entry.file ?? ''}
              </span>
            </button>
          );
        }}
      />
    </div>
  );
}
