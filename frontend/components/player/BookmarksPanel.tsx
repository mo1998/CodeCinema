'use client';

import { Bookmark, Play } from 'lucide-react';
import { formatTimePrecise } from '@/lib/format';
import { clsx } from 'clsx';

export function BookmarksPanel({
  bookmarks,
  onSeek,
  onRemove,
}: {
  bookmarks: number[];
  onSeek: (time: number) => void;
  onRemove: (time: number) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border p-2 text-[11px] text-faint">
        {bookmarks.length} bookmark{bookmarks.length === 1 ? '' : 's'}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {bookmarks.length === 0 ? (
          <p className="text-[12px] text-faint">
            No bookmarks yet. Press the bookmark button while playing to save a
            moment.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {bookmarks.map((time) => (
              <li
                key={time}
                className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5"
              >
                <button
                  onClick={() => onSeek(time)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <Play className="h-3.5 w-3.5 shrink-0 text-accent" />
                  <span className="font-mono text-[12px] tabular-nums text-text">
                    {formatTimePrecise(time)}
                  </span>
                </button>
                <button
                  onClick={() => onRemove(time)}
                  aria-label="Remove bookmark"
                  className="rounded-sm p-1 text-faint transition-colors hover:bg-surface-3 hover:text-danger"
                >
                  <Bookmark className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
