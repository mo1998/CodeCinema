'use client';

import {
  ChevronFirst,
  ChevronLast,
  Pause,
  Play,
  Rewind,
  FastForward,
  Keyboard,
} from 'lucide-react';
import { useEngine, useEngineDisplay, useEngineState } from '@/lib/engine/usePlayback';
import { formatTimePrecise } from '@/lib/format';
import { clsx } from 'clsx';
import { Scrubber } from './Scrubber';

const SPEEDS = [1, 2, 5, 10];

export function PlaybackControls({
  className,
  onShowHelp,
}: {
  className?: string;
  onShowHelp?: () => void;
}) {
  const engine = useEngine();
  const status = useEngineState((state) => state.status);
  const speed = useEngineState((state) => state.speed);
  const time = useEngineDisplay((display) => display.time);
  const duration = engine.getDuration();

  const isPlaying = status === 'playing';

  return (
    <div
      className={clsx(
        'flex h-12 shrink-0 items-center gap-3 border-t border-border bg-surface px-3',
        className,
      )}
    >
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => engine.stepBackward()}
          title="Previous event"
          aria-label="Previous event"
          className="flex h-7 w-7 items-center justify-center rounded-sm text-muted transition-colors hover:bg-surface-3 hover:text-text"
        >
          <ChevronFirst className="h-4 w-4" />
        </button>
        <button
          onClick={() => engine.toggle()}
          title={isPlaying ? 'Pause' : 'Play'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className={clsx(
            'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
            isPlaying
              ? 'bg-accent text-white hover:bg-accent-hover'
              : 'bg-surface-3 text-text hover:bg-[#232833]',
          )}
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="ml-0.5 h-4 w-4" />
          )}
        </button>
        <button
          onClick={() => engine.stepForward()}
          title="Next event"
          aria-label="Next event"
          className="flex h-7 w-7 items-center justify-center rounded-sm text-muted transition-colors hover:bg-surface-3 hover:text-text"
        >
          <ChevronLast className="h-4 w-4" />
        </button>
      </div>

      <div className="hidden items-center gap-1 text-[11px] text-faint sm:flex">
        <Rewind className="h-3 w-3" />
        <FastForward className="h-3 w-3" />
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Scrubber />
      </div>

      <div className="font-mono text-[11px] tabular-nums text-muted">
        <span className="text-text">{formatTimePrecise(time)}</span>
        <span className="text-faint"> / {formatTimePrecise(duration)}</span>
      </div>

      <button
        onClick={() => onShowHelp?.()}
        title="Keyboard shortcuts"
        aria-label="Keyboard shortcuts"
        className="flex h-6 w-6 items-center justify-center rounded-sm text-faint transition-colors hover:bg-surface-3 hover:text-muted"
      >
        <Keyboard className="h-3.5 w-3.5" />
      </button>

      <div className="flex items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5">
        {SPEEDS.map((value) => (
          <button
            key={value}
            onClick={() => engine.setSpeed(value)}
            aria-pressed={speed === value}
            className={clsx(
              'rounded-sm px-1.5 py-0.5 font-mono text-[11px] transition-colors',
              speed === value
                ? 'bg-accent-soft text-accent'
                : 'text-faint hover:text-muted',
            )}
          >
            ×{value}
          </button>
        ))}
      </div>
    </div>
  );
}
