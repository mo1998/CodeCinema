'use client';

import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { clsx } from 'clsx';

/**
 * Lightweight tooltip. Avoids a dependency for something this small, and keeps
 * the tooltip inside the panel overflow instead of portalling it away.
 */
export function Tooltip({
  label,
  children,
  side = 'top',
  delay = 350,
}: {
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}) {
  const [open, setOpen] = useState(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const show = () => {
    timer = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    if (timer) clearTimeout(timer);
    setOpen(false);
  };

  const position = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }[side];

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.12 }}
            className={clsx(
              'pointer-events-none absolute z-50 whitespace-nowrap rounded-sm border border-border-strong',
              'bg-surface-2 px-2 py-1 text-[11px] text-text shadow-float',
              position,
            )}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
