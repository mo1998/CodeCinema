'use client';

import { useMemo, useState } from 'react';
import { FileCode2, Search } from 'lucide-react';
import { useEngine } from '@/lib/engine/usePlayback';
import { useSessionOverview } from '@/lib/engine/usePlayback';
import { clsx } from 'clsx';

export function ContentSearchPanel() {
  const engine = useEngine();
  const overview = useSessionOverview();
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || !overview) return [];
    const out: { path: string; line: number; text: string }[] = [];
    for (const file of overview.modules) {
      const lines = file.text.split('\n');
      lines.forEach((line, index) => {
        if (line.toLowerCase().includes(needle)) {
          out.push({ path: file.path, line: index + 1, text: line.trim() });
        }
      });
    }
    return out.slice(0, 200);
  }, [overview, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border p-2">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search code…"
            className="h-7 w-full rounded-sm border border-border bg-surface-2 pl-7 pr-2 text-[12px] text-text placeholder:text-faint focus:border-accent-border focus:outline-none"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {query && results.length === 0 && (
          <p className="text-[12px] text-faint">No matches.</p>
        )}
        {!query && (
          <p className="text-[12px] text-faint">Type to search across the current file contents.</p>
        )}
        <ul className="space-y-1">
          {results.map((result, index) => (
            <li key={`${result.path}:${result.line}:${index}`}>
              <button
                onClick={() => engine.seekToFile(result.path)}
                className="flex w-full items-start gap-2 rounded-sm px-2 py-1 text-left transition-colors hover:bg-surface-2"
              >
                <FileCode2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
                <div className="min-w-0">
                  <div className="truncate font-mono text-[11px] text-accent">
                    {result.path}:{result.line}
                  </div>
                  <div className="truncate text-[11.5px] text-muted">{result.text}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
