'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useEngine, useEngineDisplay } from '@/lib/engine/usePlayback';
import type { EventAction } from '@/lib/engine/events';
import { clsx } from 'clsx';

const CATEGORY_COLORS: Record<string, string> = {
  edit: '#7C6CFF',
  file: '#58A6FF',
  terminal: '#3FB950',
  build: '#D29922',
  test: '#D29922',
  error: '#F85149',
  fix: '#3FB950',
  think: '#6A7280',
  narration: '#8B949E',
  session: '#8B949E',
  dependency: '#C792EA',
};

function categorize(action: EventAction): string {
  switch (action) {
    case 'file.create':
    case 'file.delete':
    case 'file.rename':
      return 'file';
    case 'type':
    case 'insert':
    case 'delete':
    case 'replace':
      return 'edit';
    case 'terminal':
    case 'terminal.command':
    case 'terminal.write':
    case 'terminal.exit':
    case 'terminal.open':
      return 'terminal';
    case 'build.start':
    case 'build.success':
    case 'build.failure':
      return 'build';
    case 'test.start':
    case 'test.result':
      return 'test';
    case 'error':
      return 'error';
    case 'fix':
      return 'fix';
    case 'think':
    case 'pause':
      return 'think';
    case 'narrate':
      return 'narration';
    case 'dependency.add':
    case 'dependency.remove':
      return 'dependency';
    default:
      return 'session';
  }
}

/**
 * Scrubbable session timeline.
 *
 * Drawn on a canvas rather than with DOM nodes: a 100k-event session would
 * otherwise mean 100k elements in the document, which wrecks layout and
 * memory. The density histogram is rendered once into an offscreen canvas and
 * blitted each frame, so the only per-frame work is moving the playhead.
 */
export function Scrubber({ className }: { className?: string }) {
  const engine = useEngine();
  const time = useEngineDisplay((display) => display.time);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bufferRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);

  const duration = engine.getDuration();
  const events = engine.getEvents();

  const buckets = useMemo(() => {
    const width = 600;
    const counts: number[] = new Array(width).fill(0);
    const colors: (string | null)[] = new Array(width).fill(null);
    const severity: number[] = new Array(width).fill(0);
    if (duration > 0) {
      for (const event of events) {
        const bucket = Math.min(
          width - 1,
          Math.max(0, Math.floor((event.timestamp / duration) * width)),
        );
        counts[bucket] += 1;
        const category = categorize(event.action);
        const weight =
          category === 'error'
            ? 4
            : category === 'fix' || category === 'build'
              ? 3
              : category === 'edit'
                ? 2
                : 1;
        if (weight > severity[bucket]) {
          severity[bucket] = weight;
          colors[bucket] = CATEGORY_COLORS[category] ?? '#6A7280';
        }
      }
    }
    return { counts, colors, severity, width };
  }, [events, duration]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Density histogram.
    const max = Math.max(1, ...buckets.counts);
    const barWidth = width / buckets.width;
    for (let i = 0; i < buckets.width; i++) {
      const count = buckets.counts[i];
      if (count === 0) continue;
      const h = Math.max(2, (count / max) * (height - 4));
      ctx.fillStyle = buckets.colors[i] ?? '#3A3F4B';
      ctx.globalAlpha = 0.35 + Math.min(0.55, (count / max) * 0.6);
      ctx.fillRect(i * barWidth, height - h, Math.max(1, barWidth - 0.4), h);
    }
    ctx.globalAlpha = 1;

    // Progress fill.
    const progress = duration > 0 ? time / duration : 0;
    const x = progress * width;
    ctx.fillStyle = 'rgba(124, 108, 255, 0.16)';
    ctx.fillRect(0, 0, x, height);

    // Playhead.
    ctx.fillStyle = '#7C6CFF';
    ctx.fillRect(x - 1, 0, 2, height);
    ctx.beginPath();
    ctx.arc(x, 5, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }, [buckets, duration, time]);

  useEffect(() => {
    paint();
    const observer = new ResizeObserver(paint);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [paint]);

  useEffect(() => {
    let frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [paint]);

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      engine.seek(ratio * duration);
    },
    [engine, duration],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = true;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    seekFromEvent(event.clientX);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return;
    seekFromEvent(event.clientX);
  };
  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = false;
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={clsx(
        'h-8 w-full cursor-pointer rounded-sm bg-surface-2/60',
        className,
      )}
      aria-label="Session timeline"
      role="slider"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={time}
    />
  );
}
