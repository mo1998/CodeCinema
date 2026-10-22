'use client';

import { useMemo } from 'react';
import { Brain, Lightbulb, Quote } from 'lucide-react';
import { useEngineDisplay, useEngineState, useSessionOverview } from '@/lib/engine/usePlayback';
import { formatTime } from '@/lib/format';
import { clsx } from 'clsx';

const CATEGORY_STYLES: Record<string, string> = {
  explanation: 'border-accent-border bg-accent-soft/40 text-accent',
  decision: 'border-[#C792EA]/40 bg-[#C792EA]/10 text-[#C792EA]',
  warning: 'border-warn/40 bg-warn-soft text-warn',
  summary: 'border-border-strong bg-surface-3 text-muted',
  todo: 'border-info/40 bg-info-soft text-info',
};

/**
 * "Educational mode": the agent's reasoning, rendered beside the code so a
 * viewer can learn *why* each change was made, not just that it was made.
 *
 * Adapters emit explicit `narrate` events when the agent explains itself.
 * When an agent is terse, we fall back to deriving explanations from the
 * events themselves (see `deriveNarration`).
 */
export function ReasoningPanel() {
  const thinking = useEngineDisplay((display) => display.thinking);
  const time = useEngineDisplay((display) => display.time);
  const narration = useEngineState((state) => state.narration);

  const overview = useSessionOverview();

  const entries = useMemo(() => {
    if (!overview) return [];
    const explicit = overview.narration;
    if (explicit.length > 0) return explicit;
    return deriveNarration(overview.timeline);
  }, [overview]);

  const visible = entries.filter((entry) => entry.timestamp <= time + 1);
  const latest = visible[visible.length - 1];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="border-b border-border p-3">
        <div
          className={clsx(
            'flex items-center gap-2 rounded-md border px-2.5 py-2 text-[12px] transition-colors',
            thinking
              ? 'border-accent-border bg-accent-soft text-accent'
              : 'border-border bg-surface-2 text-faint',
          )}
        >
          <Brain
            className={clsx('h-4 w-4 shrink-0', thinking && 'animate-pulse')}
          />
          {thinking ? 'Thinking…' : 'Idle'}
          {thinking && (
            <span className="ml-auto flex gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-accent" />
            </span>
          )}
        </div>
      </div>

      {latest && (
        <div className="border-b border-border p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">
            <Lightbulb className="h-3 w-3" />
            Current step
          </div>
          <p className="text-[13px] leading-relaxed text-text">{latest.text}</p>
        </div>
      )}

      <div className="p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">
          <Quote className="h-3 w-3" />
          Reasoning log
        </div>
        {visible.length === 0 ? (
          <p className="text-[12px] text-faint">
            This agent did not narrate its reasoning. Steps below are inferred
            from the recorded actions.
          </p>
        ) : (
          <ol className="relative space-y-2 border-l border-border pl-4">
            {visible.map((entry) => (
              <li key={entry.id} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border border-border-strong bg-surface" />
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[10px] tabular-nums text-faint">
                    {formatTime(entry.timestamp)}
                  </span>
                  {entry.category !== 'explanation' && (
                    <span
                      className={clsx(
                        'rounded-full border px-1.5 text-[9px] uppercase',
                        CATEGORY_STYLES[entry.category] ?? CATEGORY_STYLES.summary,
                      )}
                    >
                      {entry.category}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
                  {entry.text}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

interface DerivedNarration {
  id: number;
  timestamp: number;
  text: string;
  category: 'explanation' | 'decision' | 'warning' | 'summary' | 'todo';
  file?: string;
}

/**
 * Derive explanations from raw timeline entries for agents that do not
 * narrate. Deliberately conservative: it states what happened, not why.
 */
function deriveNarration(
  timeline: { id: number; timestamp: number; action: string; label: string; detail?: string; file?: string }[],
): DerivedNarration[] {
  const out: DerivedNarration[] = [];
  for (const entry of timeline) {
    let text: string | null = null;
    let category: DerivedNarration['category'] = 'explanation';

    switch (entry.action) {
      case 'file.create':
        text = `Creating ${entry.detail ?? 'a new file'} — setting up the module the rest of the change will build on.`;
        break;
      case 'file.rename':
        text = `Renaming ${entry.detail ?? 'a file'} to match the new structure.`;
        break;
      case 'file.delete':
        text = `Removing ${entry.detail ?? 'a file'} that is no longer needed.`;
        break;
      case 'think':
        text = entry.detail ?? 'Working through the approach before editing.';
        category = 'decision';
        break;
      case 'terminal.command':
        text = `Running \`${entry.detail ?? ''}\` to verify the current state of the project.`;
        break;
      case 'build.start':
        text = 'Starting a build to check that the changes compile.';
        break;
      case 'build.success':
        text = 'The build passed — the changes are consistent.';
        break;
      case 'build.failure':
        text = 'The build failed. This is where debugging starts.';
        category = 'warning';
        break;
      case 'test.start':
        text = 'Running the test suite to check for regressions.';
        break;
      case 'test.result':
        text = entry.detail ?? 'Tests finished.';
        break;
      case 'error':
        text = `Hit an error: ${entry.detail ?? ''}`;
        category = 'warning';
        break;
      case 'fix':
        text = `Fixed the problem: ${entry.detail ?? ''}`;
        category = 'summary';
        break;
      case 'dependency.add':
        text = `Adding the \`${entry.detail ?? ''}\` dependency.`;
        break;
      default:
        text = null;
    }
    if (text) {
      out.push({
        id: entry.id,
        timestamp: entry.timestamp,
        text,
        category,
        file: entry.file,
      });
    }
  }
  return out;
}
