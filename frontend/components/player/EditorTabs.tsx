'use client';

import { X } from 'lucide-react';
import { useEngine, useEngineState } from '@/lib/engine/usePlayback';
import { clsx } from 'clsx';

export function EditorTabs({ className }: { className?: string }) {
  const engine = useEngine();
  const tabs = useEngineState((state) => state.tabs);
  const activeFile = useEngineState((state) => state.activeFile);

  if (tabs.length === 0) return null;

  return (
    <div
      className={clsx(
        'flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-surface',
        className,
      )}
    >
      {tabs.map((path) => {
        const isActive = path === activeFile;
        const name = path.slice(path.lastIndexOf('/') + 1);
        return (
          <button
            key={path}
            onClick={() => engine.seekToFile(path)}
            title={path}
            className={clsx(
              'group relative flex max-w-[220px] shrink-0 items-center gap-1.5 border-r border-border px-3 text-[12.5px] transition-colors',
              isActive
                ? 'bg-[#0D0F13] text-text'
                : 'text-muted hover:bg-surface-2 hover:text-text',
            )}
          >
            {isActive && (
              <span className="absolute inset-x-0 top-0 h-px bg-accent" />
            )}
            <span className="truncate">{name}</span>
            <span className="truncate text-[11px] text-faint">{path.includes('/') ? `/${path.slice(0, path.lastIndexOf('/'))}` : ''}</span>
          </button>
        );
      })}
    </div>
  );
}
