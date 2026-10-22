'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';

export interface VirtualListProps<T> {
  items: T[];
  /** Fixed row height in pixels. */
  itemHeight: number;
  /** Rendered row height including gap. */
  rowHeight?: number;
  renderItem: (item: T, index: number) => ReactNode;
  getKey: (item: T, index: number) => string;
  className?: string;
  overscan?: number;
  /** Called when the visible range changes (used to drive scroll-into-view). */
  onRangeChange?: (start: number, end: number) => void;
  emptyState?: ReactNode;
}

/**
 * Minimal windowed list.
 *
 * A 100k-event session produces a timeline with tens of thousands of rows;
 * rendering them all would peg the main thread long before the editor could
 * animate. This keeps only the visible window mounted.
 */
export function VirtualList<T>({
  items,
  itemHeight,
  rowHeight,
  renderItem,
  getKey,
  className,
  overscan = 8,
  onRangeChange,
  emptyState,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const stride = rowHeight ?? itemHeight;

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
  }, []);

  useEffect(() => {
    measure();
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const total = items.length;
  const start = Math.max(0, Math.floor(scrollTop / stride) - overscan);
  const visibleCount = Math.ceil(viewportHeight / stride) + overscan * 2;
  const end = Math.min(total, start + visibleCount);

  useEffect(() => {
    onRangeChange?.(start, end);
  }, [start, end, onRangeChange]);

  if (total === 0 && emptyState) {
    return (
      <div ref={containerRef} className={clsx('overflow-y-auto', className)}>
        {emptyState}
      </div>
    );
  }

  const slice = items.slice(start, end);

  return (
    <div ref={containerRef} onScroll={onScroll} className={clsx('overflow-y-auto', className)}>
      <div style={{ height: total * stride, position: 'relative', width: '100%' }}>
        <div
          style={{
            position: 'absolute',
            top: start * stride,
            left: 0,
            right: 0,
          }}
        >
          {slice.map((item, i) => (
            <div
              key={getKey(item, start + i)}
              style={{ height: stride }}
              className="overflow-hidden"
            >
              {renderItem(item, start + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
