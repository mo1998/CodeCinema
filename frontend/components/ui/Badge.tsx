'use client';

import { clsx } from 'clsx';
import type { ReactNode } from 'react';

type Tone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-muted border-border',
  accent: 'bg-accent-soft text-accent border-accent-border',
  success: 'bg-success-soft text-success border-success/30',
  warn: 'bg-warn-soft text-warn border-warn/30',
  danger: 'bg-danger-soft text-danger border-danger/30',
  info: 'bg-info-soft text-info border-info/30',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  mono = false,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  mono?: boolean;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4 font-medium',
        mono && 'font-mono tracking-tight',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
