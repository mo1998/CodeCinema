'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { clsx } from 'clsx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent-hover shadow-[0_1px_2px_rgba(0,0,0,0.4)] disabled:hover:bg-accent',
  secondary:
    'bg-surface-3 text-text hover:bg-[#232833] border border-border hover:border-border-strong',
  ghost:
    'text-muted hover:text-text hover:bg-surface-3 disabled:hover:bg-transparent',
  danger: 'bg-danger-soft text-danger hover:bg-danger/20 border border-danger/30',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-sm',
  md: 'h-8 px-3 text-sm gap-2 rounded-md',
  lg: 'h-10 px-4 text-sm gap-2 rounded-md',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(
        'inline-flex items-center justify-center font-medium whitespace-nowrap',
        'transition-colors duration-100 select-none',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  active?: boolean;
  label?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { variant = 'ghost', active = false, label, className, type = 'button', ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        aria-pressed={active}
        className={clsx(
          'inline-flex h-7 w-7 items-center justify-center rounded-sm',
          'transition-colors duration-100 select-none',
          'disabled:opacity-30 disabled:cursor-not-allowed',
          active
            ? 'bg-accent-soft text-accent'
            : VARIANTS[variant],
          className,
        )}
        {...props}
      />
    );
  },
);
