'use client';

import { useMemo } from 'react';
import { FilePenLine } from 'lucide-react';
import { useEngine, useEngineState, useSessionOverview } from '@/lib/engine/usePlayback';
import { formatTimePrecise } from '@/lib/format';

export function FileHistoryPanel() {
  const engine = useEngine();
  const activeFile = useEngineState((state) => state.activeFile);
  const overview = useSessionOverview();

  const entries = useMemo(() => {
    if (!overview || !activeFile) return [];
    return overview.timeline.filter((entry) => entry.file === activeFile);
  }, [overview, activeFile]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border p-2 text-[11px] text-faint">
        {activeFile ? activeFile : 'No active file'} · {entries.length} events
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {entries.length === 0 && (
          <p className="text-[12px] text-faint">No history for this file.</p>
        )}
        <ul className="space-y-1">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                onClick={() => engine.seek(entry.timestamp)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left transition-colors hover:bg-surface-2"
              >
                <FilePenLine className="h-3.5 w-3.5 shrink-0 text-faint" />
                <span className="w-14 shrink-0 font-mono text-[10px] tabular-nums text-faint">
                  {formatTimePrecise(entry.timestamp)}
                </span>
                <span className="truncate text-[12px] text-text">{entry.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
