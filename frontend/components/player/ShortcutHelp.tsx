'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect } from 'react';

const SHORTCUTS: { keys: string[]; description: string }[] = [
  { keys: ['Space'], description: 'Play / pause' },
  { keys: ['→'], description: 'Forward 5 seconds' },
  { keys: ['←'], description: 'Back 5 seconds' },
  { keys: ['↑'], description: 'Previous event' },
  { keys: ['↓'], description: 'Next event' },
  { keys: ['L'], description: 'Forward 10 seconds' },
  { keys: ['J'], description: 'Back 10 seconds' },
  { keys: ['F'], description: 'Double the playback speed' },
  { keys: ['?'], description: 'Show this list' },
  { keys: ['Esc'], description: 'Close' },
];

export function ShortcutHelp({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={(event) => event.stopPropagation()}
            className="cc-float w-full max-w-sm rounded-lg p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] font-medium text-text">Keyboard shortcuts</h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="rounded-sm p-1 text-faint transition-colors hover:bg-surface-3 hover:text-muted"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <ul className="space-y-1.5">
              {SHORTCUTS.map((shortcut) => (
                <li
                  key={shortcut.description}
                  className="flex items-center justify-between gap-4"
                >
                  <span className="text-[12px] text-muted">
                    {shortcut.description}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    {shortcut.keys.map((key) => (
                      <kbd
                        key={key}
                        className="min-w-[20px] rounded border border-border-strong bg-surface-3 px-1.5 py-0.5 text-center font-mono text-[10px] text-text"
                      >
                        {key}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
