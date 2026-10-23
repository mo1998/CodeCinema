'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PanelLeft, PanelRightClose, PanelRightOpen, Terminal as TerminalIcon } from 'lucide-react';
import { PlaybackEngine, type EngineState } from '@/lib/engine/engine';
import type { SessionEvent } from '@/lib/engine/events';
import {
  PlaybackProvider,
  readPersistedPosition,
  useEngine,
  useEngineDisplay,
  useEngineState,
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
import { useLiveSession, usePresence } from '@/lib/api/live';

const selectPlaybackStatus = (state: EngineState) => state.status;

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
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightWidth, setRightWidth] = useState(384);
  const [terminalHeight, setTerminalHeight] = useState(200);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [overlayDismissed, setOverlayDismissed] = useState(false);
  const [bookmarks, setBookmarks] = useState<number[]>([]);
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

    // `?speed=4` lets a share link (or the export renderer) choose the
    // playback rate.
    if (typeof window !== 'undefined') {
      const speed = new URLSearchParams(window.location.search).get('speed');
      const parsed = speed ? Number(speed) : Number.NaN;
      if (Number.isFinite(parsed) && parsed > 0) engine.setSpeed(parsed);
    }

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

  useEffect(() => {
    const key = `codecinema:bookmarks:${storageKey ?? title ?? 'session'}`;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setBookmarks(JSON.parse(raw) as number[]);
    } catch {
      /* ignore */
    }
  }, [storageKey, title]);

  // Live mode: the clock waits at the edge of the stream for more events.
  useEffect(() => {
    engine.setLiveMode(live);
  }, [engine, live]);

  // Expose the engine for debugging and for the video-export renderer.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as unknown as Record<string, unknown>).__CODECINEMA_ENGINE__ = engine;
  }, [engine]);

  // The video-export renderer waits on these two flags: the first says the
  // replay is loaded, the second that it has played to the end.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const flags = window as unknown as Record<string, unknown>;
    flags.__CODECINEMA_READY__ = true;
    flags.__CODECINEMA_DONE__ = false;
    return () => {
      flags.__CODECINEMA_READY__ = false;
    };
  }, [events]);

  const playbackStatus = useEngineState(selectPlaybackStatus);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (playbackStatus === 'ended') {
      (window as unknown as Record<string, unknown>).__CODECINEMA_DONE__ = true;
    }
  }, [playbackStatus]);

  // Live mode: append events as the agent produces them.
  const liveState = useLiveSession({
    sessionId: sessionId ?? '',
    enabled: live && Boolean(sessionId),
    onEvent: (event) => engine.appendEvents([event]),
  });
  const presenceViewers = usePresence(sessionId ?? '', Boolean(sessionId) && !live);

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
          engine.setSpeed(engine.getSpeed() >= 5 ? 1 : engine.getSpeed() * 2);
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

  const toggleBookmark = useCallback(
    (time: number) => {
      setBookmarks((prev) => {
        const exists = prev.some((value) => Math.abs(value - time) < 500);
        const next = exists
          ? prev.filter((value) => Math.abs(value - time) >= 500)
          : [...prev, time].sort((a, b) => a - b);
        const key = `codecinema:bookmarks:${storageKey ?? title ?? 'session'}`;
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [storageKey, title],
  );

  const removeBookmark = useCallback(
    (time: number) => {
      setBookmarks((prev) => {
        const next = prev.filter((value) => Math.abs(value - time) >= 500);
        const key = `codecinema:bookmarks:${storageKey ?? title ?? 'session'}`;
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [storageKey, title],
  );

  return (
    <div className="flex h-dvh min-h-0 w-full flex-col bg-bg">
      <TopBar
        sessionId={sessionId}
        title={title}
        agent={agent}
        prompt={prompt}
        liveStatus={live ? liveState.status : undefined}
        viewers={live ? liveState.viewers : presenceViewers}
        leftOpen={leftOpen}
        onToggleLeft={() => setLeftOpen((value) => !value)}
        onToggleRight={() => setRightOpen((value) => !value)}
        rightOpen={rightOpen}
        onToggleTerminal={() => setTerminalOpen((value) => !value)}
        terminalOpen={terminalOpen}
      />

      <div className="flex min-h-0 flex-1">
        {/* Left: project explorer */}
        {leftOpen ? (
          <>
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
          </>
        ) : (
          <div className="flex w-8 shrink-0 items-center justify-center border-r border-border">
            <button
              onClick={() => setLeftOpen(true)}
              aria-label="Show explorer"
              className="flex h-7 w-7 items-center justify-center rounded-sm text-faint transition-colors hover:bg-surface-3 hover:text-muted"
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

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
                <RightPanel
                  className="h-full"
                  sessionId={sessionId}
                  bookmarks={bookmarks}
                  onSeekBookmark={(time) => engine.seek(time)}
                  onRemoveBookmark={removeBookmark}
                />
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

      <PlaybackControls
        onShowHelp={() => setHelpOpen(true)}
        onBookmark={toggleBookmark}
      />

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
