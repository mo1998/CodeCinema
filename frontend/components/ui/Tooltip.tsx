'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { clsx } from 'clsx';

/**
 * Lightweight, viewport-aware tooltip.
 *
 * The previous implementation centered the tooltip under the trigger, which
 * clipped it against the window edge for buttons near the right side of the
 * top bar. This version measures the trigger and flips the alignment so the
 * tooltip always stays on screen.
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
  const [align, setAlign] = useState<'center' | 'start' | 'end'>('center');
  const [resolvedSide, setResolvedSide] = useState(side);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setResolvedSide(side);
  }, [side]);

  const show = () => {
    timerRef.current = setTimeout(() => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (rect) {
        const half = label.length * 3.6; // approximate half-width in px
        const spaceLeft = rect.left;
        const spaceRight = window.innerWidth - rect.right;
        if (spaceRight < half) setAlign('end');
        else if (spaceLeft < half) setAlign('start');
        else setAlign('center');

        // Flip vertically when there is not enough room for the tooltip on the
        // requested side (e.g. top-bar buttons hugging the window's top edge).
        if (side === 'top' && rect.top < 40) setResolvedSide('bottom');
        else if (side === 'bottom' && rect.bottom + 40 > window.innerHeight) setResolvedSide('top');
        else setResolvedSide(side);
      }
      setOpen(true);
    }, delay);
  };

  const hide = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setOpen(false);
  };

  // Re-evaluate alignment on open because the timer may have fired after
  // a layout change.
  useEffect(() => {
    if (!open) return;
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const tooltip = wrapperRef.current?.querySelector('[role="tooltip"]') as
      | HTMLElement
      | null;
    const width = tooltip?.offsetWidth ?? 120;
    const height = tooltip?.offsetHeight ?? 24;
    const half = width / 2;
    if (rect.right + half > window.innerWidth) setAlign('end');
    else if (rect.left - half < 0) setAlign('start');
    else setAlign('center');

    if (side === 'top' && rect.top < height + 8) setResolvedSide('bottom');
    else if (side === 'bottom' && rect.bottom + height + 8 > window.innerHeight) setResolvedSide('top');
    else setResolvedSide(side);
  }, [open, side]);

  const verticalAlignClass =
    align === 'end'
      ? 'right-0'
      : align === 'start'
        ? 'left-0'
        : 'left-1/2 -translate-x-1/2';

  const position = {
    top: `bottom-full ${verticalAlignClass} mb-1.5`,
    bottom: `top-full ${verticalAlignClass} mt-1.5`,
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }[resolvedSide];

  return (
    <span
      ref={wrapperRef}
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
