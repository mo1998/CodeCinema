'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PanelRightClose, PanelRightOpen, Terminal as TerminalIcon } from 'lucide-react';
import { PlaybackEngine } from '@/lib/engine/engine';
import type { SessionEvent } from '@/lib/engine/events';
import {
  PlaybackProvider,
  readPersistedPosition,
  useEngine,
  useEngineDisplay,
  usePlaybackPersistence,
} from '@/lib/engine/usePlayback';
import { IconButton } from '@/components/ui/Button';
import { Resizer } from '@/components/ui/Resizer';
import { ProjectExplorer } from './ProjectExplorer';
import { EditorTabs } from './EditorTabs';
import { CodeEditor } from './CodeEditor';
import { TerminalPanel } from './TerminalPanel';
import { RightPanel } from './RightPanel';
import { PlaybackControls } from './PlaybackControls';
import { EducationalOverlay } from './EducationalOverlay';
import { TopBar } from './TopBar';
import { ShortcutHelp } from './ShortcutHelp';
import { clsx } from 'clsx';
import { useLiveSession } from '@/lib/api/live';

export interface PlayerShellProps {
  events: SessionEvent[];
  /** Backend session id — enables share and export actions. */
  sessionId?: string;
  title?: string;
  agent?: string;
  prompt?: string;
  /** Show the educational explanation card. */
  educational?: boolean;
  /** Start playing as soon as the session is ready. */
  autoplay?: boolean;
  /** Called once the player has mounted (used by the export renderer). */
  onReady?: () => void;
  storageKey?: string;
  /**
   * Tail a live recording over WebSocket instead of replaying a stored log.
   * The same engine drives both, so live and replay behave identically.
   */
  live?: boolean;
}

function PlayerShellInner({
  events,
  sessionId,
  title,
  agent,
  prompt,
  educational = true,
  autoplay = false,
  onReady,
  storageKey,
  live = false,
}: PlayerShellProps) {
  const engine = useEngine();
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(384);
  const [terminalHeight, setTerminalHeight] = useState(200);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [overlayDismissed, setOverlayDismissed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const resumedRef = useRef(false);

  const time = useEngineDisplay((display) => display.time);

  // Load the session.
  useEffect(() => {
    engine.setEvents(events);
    engine.primeCheckpoints();

    // An explicit `#t=12345` in the URL wins over the stored position — it
    // is what the viewer asked for. Otherwise resume where they left off.
    const match =
      typeof window !== 'undefined' ? window.location.hash.match(/t=(\d+)/) : null;
    const persisted = storageKey ? readPersistedPosition(storageKey) : null;

    if (match) {
      engine.seek(Number(match[1]));
    } else if (persisted && persisted.time > 0) {
      engine.seek(persisted.time);
      engine.setSpeed(persisted.speed);
      resumedRef.current = true;
    }

    // Only autoplay when the viewer did not ask for a specific moment.
    if (autoplay && !match) {
      engine.play();
    }
    onReady?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, events]);

  usePlaybackPersistence(storageKey ?? 'codecinema:position', Boolean(storageKey));

  // Live mode: the clock waits at the edge of the stream for more events.
  useEffect(() => {
    engine.setLiveMode(live);
  }, [engine, live]);

  // Expose the engine for debugging and for the video-export renderer.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as unknown as Record<string, unknown>).__CODECINEMA_ENGINE__ = engine;
  }, [engine]);

  // Live mode: append events as the agent produces them.
  useLiveSession({
    sessionId: sessionId ?? '',
    enabled: live && Boolean(sessionId),
    onEvent: (event) => engine.appendEvents([event]),
  });

  // Keep the URL hash in sync so the position is shareable.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = `#t=${Math.round(time)}`;
    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', hash);
    }
  }, [time]);

  // Keyboard shortcuts — the muscle memory of a media player.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      switch (event.key) {
        case ' ':
          event.preventDefault();
          engine.toggle();
          break;
        case 'ArrowRight':
          event.preventDefault();
          engine.seek(Math.min(engine.getDuration(), engine.getTime() + 5000));
          break;
        case 'ArrowLeft':
          event.preventDefault();
          engine.seek(Math.max(0, engine.getTime() - 5000));
          break;
        case 'ArrowUp':
          event.preventDefault();
          engine.stepBackward();
          break;
        case 'ArrowDown':
          event.preventDefault();
          engine.stepForward();
          break;
        case 'j':
          engine.seek(Math.min(engine.getDuration(), engine.getTime() - 10000));
          break;
        case 'l':
          engine.seek(Math.min(engine.getDuration(), engine.getTime() + 10000));
          break;
        case 'f':
          engine.setSpeed(engine.getSpeed() >= 10 ? 1 : engine.getSpeed() * 2);
          break;
        case '?':
          setHelpOpen(true);
          break;
        case 'Escape':
          setHelpOpen(false);
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [engine]);

  const handleTimelineSeek = useCallback(() => {}, []);

  return (
    <div className="flex h-dvh min-h-0 w-full flex-col bg-bg">
      <TopBar
        sessionId={sessionId}
        title={title}
        agent={agent}
        prompt={prompt}
        onToggleRight={() => setRightOpen((value) => !value)}
        rightOpen={rightOpen}
        onToggleTerminal={() => setTerminalOpen((value) => !value)}
        terminalOpen={terminalOpen}
      />

      <div className="flex min-h-0 flex-1">
        {/* Left: project explorer */}
        <div
          className="shrink-0 overflow-hidden border-r border-border"
          style={{ width: leftWidth }}
        >
          <ProjectExplorer className="h-full" />
        </div>
        <Resizer
          orientation="vertical"
          size={leftWidth}
          onResize={setLeftWidth}
          min={180}
          max={480}
        />

        {/* Center: editor + terminal */}
        <div className="flex min-w-0 flex-1 flex-col">
          <EditorTabs />
          <div className="relative min-h-0 flex-1">
            <CodeEditor />
            {educational && !overlayDismissed && (
              <EducationalOverlay onDismiss={() => setOverlayDismissed(true)} />
            )}
          </div>

          {terminalOpen ? (
            <>
              <Resizer
                orientation="horizontal"
                size={terminalHeight}
                onResize={setTerminalHeight}
                min={80}
                max={600}
                invert
              />
              <div
                className="shrink-0 overflow-hidden border-t border-border"
                style={{ height: terminalHeight }}
              >
                <TerminalPanel className="h-full" onClose={() => setTerminalOpen(false)} />
              </div>
            </>
          ) : (
            <div className="flex h-8 shrink-0 items-center justify-end border-t border-border px-2">
              <button
                onClick={() => setTerminalOpen(true)}
                className="flex items-center gap-1.5 rounded-sm px-2 py-1 text-[11px] text-faint hover:bg-surface-3 hover:text-muted"
              >
                <TerminalIcon className="h-3 w-3" />
                Show terminal
              </button>
            </div>
          )}
        </div>

        {/* Right: timeline / reasoning / progress / architecture */}
        <AnimatePresence initial={false}>
          {rightOpen && (
            <motion.div
              key="right-panel"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: rightWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="shrink-0 overflow-hidden"
            >
              <div className="h-full w-full border-l border-border">
                <RightPanel className="h-full" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {rightOpen && (
          <Resizer
            orientation="vertical"
            size={rightWidth}
            onResize={setRightWidth}
            min={280}
            max={720}
            invert
          />
        )}
      </div>

      <PlaybackControls onShowHelp={() => setHelpOpen(true)} />

      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

export function PlayerShell(props: PlayerShellProps) {
  const engine = useMemo(
    () => new PlaybackEngine({ seed: props.title ?? 'codecinema' }),
    [props.title],
  );

  return (
    <PlaybackProvider engine={engine}>
      <PlayerShellInner {...props} />
    </PlaybackProvider>
  );
}
