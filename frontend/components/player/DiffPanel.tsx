'use client';

import { useMemo, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { useSessionOverview } from '@/lib/engine/usePlayback';
import { useEngineState } from '@/lib/engine/usePlayback';

export function DiffPanel() {
  const overview = useSessionOverview();
  const languages = useEngineState((state) => state.languages);
  const files = overview?.modules ?? [];
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');

  const leftFile = files.find((file) => file.path === left);
  const rightFile = files.find((file) => file.path === right);

  const language = languages[right || left] ?? 'plaintext';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-2 border-b border-border p-2">
        <select
          value={left}
          onChange={(event) => setLeft(event.target.value)}
          className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-surface-2 px-2 text-[11px] text-text focus:border-accent-border focus:outline-none"
          aria-label="Left file"
        >
          <option value="">Left file…</option>
          {files.map((file) => (
            <option key={file.path} value={file.path}>
              {file.path}
            </option>
          ))}
        </select>
        <select
          value={right}
          onChange={(event) => setRight(event.target.value)}
          className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-surface-2 px-2 text-[11px] text-text focus:border-accent-border focus:outline-none"
          aria-label="Right file"
        >
          <option value="">Right file…</option>
          {files.map((file) => (
            <option key={file.path} value={file.path}>
              {file.path}
            </option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1">
        <DiffEditor
          original={leftFile?.text ?? ''}
          modified={rightFile?.text ?? ''}
          language={language}
          theme="vs-dark"
          options={{
            readOnly: true,
            renderSideBySide: true,
            minimap: { enabled: false },
          }}
        />
      </div>
    </div>
  );
}
