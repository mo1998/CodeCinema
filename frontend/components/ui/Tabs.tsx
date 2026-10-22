'use client';

import { clsx } from 'clsx';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
}

export function Tabs<T extends string>({
  items,
  active,
  onChange,
  className,
  size = 'md',
}: {
  items: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role="tablist"
      className={clsx('flex items-center gap-0.5 overflow-x-auto', className)}
    >
      {items.map((item) => {
        const isActive = item.id === active;
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(item.id)}
            className={clsx(
              'relative flex items-center gap-1 whitespace-nowrap font-medium transition-colors',
              size === 'sm' ? 'h-7 px-1.5 text-[11.5px]' : 'h-8 px-2.5 text-[13px]',
              isActive ? 'text-text' : 'text-faint hover:text-muted',
            )}
          >
            {isActive && (
              <motion.span
                layoutId="tab-underline"
                className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-accent"
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              />
            )}
            {item.icon}
            <span className="truncate">{item.label}</span>
            {item.badge != null && (
              <span className="text-[10px] tabular-nums text-faint">{item.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
