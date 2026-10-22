'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';

export interface ResizerProps {
  /**
   * Orientation of the divider *line*.
   *
   * `vertical`   → a vertical line (h-full w-px) between side-by-side panels;
   *                the drag axis is horizontal.
   * `horizontal` → a horizontal line (h-px w-full) between stacked panels;
   *                the drag axis is vertical.
   */
  orientation: 'horizontal' | 'vertical';
  /** Current size of the panel the divider controls, in pixels. */
  size: number;
  onResize: (size: number) => void;
  min?: number;
  max?: number;
  /**
   * Invert the drag direction.
   *
   * Use it when the panel grows *away* from the drag: a divider on the right
   * edge of a right-hand panel, or above a bottom panel.
   */
  invert?: boolean;
  className?: string;
}

/**
 * Drag handle between panels.
 *
 * Uses pointer events (not mouse events) so it keeps working when the pointer
 * leaves the window mid-drag, and supports keyboard adjustment for
 * accessibility.
 */
export function Resizer({
  orientation,
  size,
  onResize,
  min = 120,
  max = 900,
  invert = false,
  className,
}: ResizerProps) {
  const [dragging, setDragging] = useState(false);
  const origin = useRef({ pointer: 0, size: 0 });
  const vertical = orientation === 'vertical';

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
      origin.current = {
        pointer: vertical ? event.clientX : event.clientY,
        size,
      };
      setDragging(true);
    },
    [vertical, size],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const current = vertical ? event.clientX : event.clientY;
      const delta = (current - origin.current.pointer) * (invert ? -1 : 1);
      const next = Math.max(min, Math.min(max, origin.current.size + delta));
      onResize(next);
    },
    [dragging, vertical, invert, min, max, onResize],
  );

  const stop = useCallback(() => setDragging(false), []);

  useEffect(() => {
    if (!dragging) return;
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = vertical ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = '';
    };
  }, [dragging, vertical]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 40 : 12;
      const decrease = vertical ? 'ArrowLeft' : 'ArrowUp';
      const increase = vertical ? 'ArrowRight' : 'ArrowDown';
      if (event.key === decrease) {
        event.preventDefault();
        onResize(Math.max(min, size - step));
      } else if (event.key === increase) {
        event.preventDefault();
        onResize(Math.min(max, size + step));
      }
    },
    [size, min, max, onResize, vertical],
  );

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(size)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
      className={clsx(
        'group relative z-10 shrink-0 outline-none',
        vertical
          ? 'h-full w-px cursor-col-resize'
          : 'h-px w-full cursor-row-resize',
        dragging ? 'bg-accent' : 'hover:bg-accent/50',
        className,
      )}
    >
      <span
        className={clsx(
          'absolute transition-colors',
          vertical ? 'inset-y-0 -left-1 w-2' : 'inset-x-0 -top-1 h-2',
          dragging ? 'bg-accent' : 'bg-transparent group-hover:bg-accent/40',
        )}
      />
    </div>
  );
}
