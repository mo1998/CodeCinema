'use client';

import { useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileCode2,
  FilePlus2,
  TerminalSquare,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useEngine, useEngineDisplay, useEngineState, useSessionOverview } from '@/lib/engine/usePlayback';
import { formatCount, formatDuration } from '@/lib/format';
import { clsx } from 'clsx';

export function ProgressPanel() {
  const engine = useEngine();
  const totalEvents = useEngineState((state) => state.totalEvents);
  const consumedEvents = useEngineState((state) => state.consumedEvents);
  const build = useEngineState((state) => state.build);
  const errors = useEngineState((state) => state.errors);
  const fixes = useEngineState((state) => state.fixes);
  const dependencies = useEngineState((state) => state.dependencies);
  const fileOrder = useEngineState((state) => state.fileOrder);
  const createdFiles = useEngineState((state) => state.createdFiles);
  const time = useEngineDisplay((display) => display.time);

  const duration = engine.getDuration();
  const progress = duration > 0 ? time / duration : 0;

  const overview = useSessionOverview();

  const stats = useMemo(() => {
    const timeline = overview?.timeline ?? [];
    let commands = 0;
    let edits = 0;
    for (const entry of timeline) {
      if (entry.action.startsWith('terminal')) commands += 1;
      if (
        entry.action === 'file.create' ||
        entry.action === 'file.delete' ||
        entry.action === 'file.rename'
      ) {
        edits += 1;
      }
    }
    return {
      commands,
      filesCreated: createdFiles.length,
      filesTouched: overview?.touchedFiles.length ?? 0,
      errors: overview?.errors.length ?? 0,
      fixes: overview?.fixes.length ?? 0,
    };
  }, [overview, createdFiles]);

  const rows: {
    label: string;
    value: string | number;
    icon: typeof FileCode2;
    tone?: string;
  }[] = [
    { label: 'Files created', value: stats.filesCreated, icon: FilePlus2, tone: 'text-info' },
    { label: 'Files touched', value: stats.filesTouched, icon: FileCode2, tone: 'text-accent' },
    { label: 'Commands run', value: stats.commands, icon: TerminalSquare, tone: 'text-success' },
    { label: 'Errors hit', value: stats.errors, icon: AlertTriangle, tone: 'text-danger' },
    { label: 'Fixes applied', value: stats.fixes, icon: Wrench, tone: 'text-success' },
    { label: 'Dependencies', value: dependencies.length, icon: FileCode2, tone: 'text-[#C792EA]' },
  ];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-4">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
            Session progress
          </span>
          <span className="font-mono text-[11px] tabular-nums text-text">
            {Math.round(progress * 100)}%
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-150 ease-linear"
            style={{ width: `${Math.min(100, progress * 100)}%` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[10px] tabular-nums text-faint">
          <span>
            {formatCount(consumedEvents)} / {formatCount(totalEvents)} events
          </span>
          <span>{formatDuration(duration)}</span>
        </div>
      </div>

      <div
        className={clsx(
          'mb-4 flex items-center gap-2 rounded-md border px-2.5 py-2 text-[12px]',
          build.status === 'success' && 'border-success/30 bg-success-soft text-success',
          build.status === 'failed' && 'border-danger/30 bg-danger-soft text-danger',
          build.status === 'running' && 'border-warn/30 bg-warn-soft text-warn',
          build.status === 'idle' && 'border-border bg-surface-2 text-faint',
        )}
      >
        {build.status === 'success' && <CheckCircle2 className="h-4 w-4" />}
        {build.status === 'failed' && <XCircle className="h-4 w-4" />}
        {build.status === 'running' && <Wrench className="h-4 w-4 animate-pulse" />}
        {build.status === 'idle' && <Wrench className="h-4 w-4" />}
        <span className="font-medium capitalize">
          {build.status === 'running' ? 'Build in progress' : `Build ${build.status}`}
        </span>
        {build.target && <span className="ml-auto truncate text-[11px] opacity-70">{build.target}</span>}
      </div>

      {build.errors.length > 0 && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger-soft/40 p-2">
          <div className="mb-1 text-[11px] font-medium text-danger">
            {build.errors.length} build error{build.errors.length === 1 ? '' : 's'}
          </div>
          <ul className="space-y-0.5 font-mono text-[11px] text-danger/90">
            {build.errors.slice(0, 6).map((error, index) => (
              <li key={index} className="truncate">
                {error}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-1.5">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <div
              key={row.label}
              className="rounded-md border border-border bg-surface-2 px-2.5 py-2"
            >
              <div className="flex items-center gap-1.5">
                <Icon className={clsx('h-3 w-3', row.tone)} />
                <span className="text-[10.5px] text-faint">{row.label}</span>
              </div>
              <div className="mt-0.5 font-mono text-[15px] tabular-nums text-text">
                {row.value}
              </div>
            </div>
          );
        })}
      </div>

      {errors.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">
            Errors &amp; fixes
          </div>
          <ul className="space-y-1">
            {errors.map((error) => (
              <li
                key={error.id}
                className={clsx(
                  'rounded border px-2 py-1.5 text-[11.5px]',
                  error.resolved
                    ? 'border-success/25 bg-success-soft/30 text-success/90'
                    : 'border-danger/25 bg-danger-soft/30 text-danger/90',
                )}
              >
                <div className="flex items-start gap-1.5">
                  {error.resolved ? (
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  )}
                  <span className="break-words">{error.message}</span>
                </div>
                {error.file && (
                  <div className="mt-0.5 pl-4.5 font-mono text-[10.5px] opacity-70">
                    {error.file}
                    {error.line ? `:${error.line}` : ''}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
