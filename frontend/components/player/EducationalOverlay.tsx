'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Lightbulb, X } from 'lucide-react';
import { useEngine, useEngineDisplay, useEngineState } from '@/lib/engine/usePlayback';
import { clsx } from 'clsx';

/**
 * Floating explanation card.
 *
 * Sits above the editor and narrates what the agent is doing right now. It is
 * the "educational mode" surface: a viewer who has never written code can
 * follow the session without reading every line.
 */
export function EducationalOverlay({
  className,
  onDismiss,
}: {
  className?: string;
  onDismiss?: () => void;
}) {
  const engine = useEngine();
  const narration = useEngineState((state) => state.narration);
  const time = useEngineDisplay((display) => display.time);

  const latest = narration[narration.length - 1];
  const visible = latest !== undefined && latest.timestamp <= time + 1;

  if (!visible || !latest) return null;

  return (
    <AnimatePresence>
      <motion.div
        key={latest.id}
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className={clsx(
          'pointer-events-auto absolute top-3 right-3 z-20 flex max-w-[380px] items-start gap-2',
          'rounded-lg border border-accent-border bg-surface-2/95 px-3 py-2 shadow-float backdrop-blur',
          className,
        )}
      >
        <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium tracking-wide text-accent uppercase">
            {latest.category === 'decision'
              ? 'Decision'
              : latest.category === 'warning'
                ? 'Watch out'
                : latest.category === 'summary'
                  ? 'Summary'
                  : 'What is happening'}
          </div>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-text">
            {latest.text}
          </p>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label="Dismiss explanation"
            className="shrink-0 rounded-sm p-0.5 text-faint transition-colors hover:bg-surface-3 hover:text-muted"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
