'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useEngineDisplay } from '@/lib/engine/usePlayback';
import { clsx } from 'clsx';

const KIND_STYLES: Record<string, string> = {
  command: 'text-[#7C6CFF]',
  output: 'text-[#C3C8D0]',
  error: 'text-danger',
  info: 'text-info',
  success: 'text-success',
};

/**
 * Terminal simulation.
 *
 * Lines arrive pre-rendered by the engine (the engine owns the streaming
 * reveal so the timing stays in sync with the rest of the replay).
 */
export function TerminalPanel({
  className,
  onClose,
}: {
  className?: string;
  onClose?: () => void;
}) {
  const lines = useEngineDisplay((display) => display.terminalLines);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // Keep the newest line in view unless the viewer has scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  return (
    <div className={clsx('flex min-h-0 flex-col bg-[#0B0D10]', className)}>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
          Terminal
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#3A3F4B]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#3A3F4B]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#3A3F4B]" />
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-sm px-1.5 py-0.5 text-[11px] text-faint hover:bg-surface-3 hover:text-muted"
            >
              Hide
            </button>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-[18px]"
      >
        {lines.length === 0 ? (
          <div className="text-[#4B5261]">No commands were run in this session.</div>
        ) : (
          lines.map((line, index) => (
            <motion.div
              key={line.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
              className="flex gap-2 whitespace-pre-wrap"
            >
              <span className="select-none text-[#4B5261]">
                {line.kind === 'command' ? '$' : ' '}
              </span>
              <span className={clsx('break-words', KIND_STYLES[line.kind] ?? 'text-muted')}>
                {line.text}
                {line.kind === 'command' && <span className="ml-0.5 animate-pulse">▊</span>}
              </span>
            </motion.div>
          ))
        )}
        <div className="h-2" />
      </div>
    </div>
  );
}
