'use client';

/**
 * React bindings for the playback engine.
 *
 * Two subscription channels:
 *  - `useEngineState`  → structural changes (files, tabs, timeline, narration)
 *  - `useEngineDisplay` → per-frame changes (visible text, terminal lines)
 *
 * Keeping them separate is what lets the editor animate at 60fps without
 * re-rendering the timeline, the explorer and the panels on every frame.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  PlaybackEngine,
  type EngineDisplay,
  type EngineState,
  type SessionOverview,
} from './engine';

const PlaybackContext = createContext<PlaybackEngine | null>(null);

/**
 * Default equality for a selected slice of engine state.
 *
 * `Object.is` alone is not enough: a selector that builds a fresh object or
 * array (`s => ({ active: s.active })`) would return a new reference on every
 * call, and `useSyncExternalStore` would then re-render forever. Shallow
 * comparison keeps the snapshot stable when the *contents* are unchanged.
 */
function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!Object.is(a[i], b[i])) return false;
    }
    return true;
  }
  if (
    a !== null &&
    b !== null &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const keysA = Object.keys(a as Record<string, unknown>);
    const keysB = Object.keys(b as Record<string, unknown>);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (
        !Object.is(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        )
      ) {
        return false;
      }
    }
    return true;
  }
  return false;
}

/** Stable identity — a default parameter would create a new function on every
 * render and force `useSyncExternalStore` to re-subscribe. */
const DEFAULT_IS_EQUAL = shallowEqual;

export function PlaybackProvider({
  engine,
  children,
}: {
  engine: PlaybackEngine;
  children: ReactNode;
}) {
  return <PlaybackContext.Provider value={engine}>{children}</PlaybackContext.Provider>;
}

export function useEngine(): PlaybackEngine {
  const engine = useContext(PlaybackContext);
  if (!engine) throw new Error('useEngine must be used inside <PlaybackProvider>');
  return engine;
}

/**
 * Subscribe to a slice of the structural state.
 *
 * `selector` must be stable (module scope or `useCallback`) — it is part of
 * the `getSnapshot` identity used by `useSyncExternalStore`.
 */
export function useEngineState<T>(
  selector: (state: EngineState) => T,
  isEqual: (a: T, b: T) => boolean = DEFAULT_IS_EQUAL,
): T {
  const engine = useEngine();
  const cache = useRef<{ value: T; primed: boolean }>({
    value: undefined as unknown as T,
    primed: false,
  });

  const getSnapshot = useCallback(() => {
    const next = selector(engine.getState());
    if (cache.current.primed && isEqual(cache.current.value, next)) {
      return cache.current.value;
    }
    cache.current = { value: next, primed: true };
    return next;
  }, [engine, selector, isEqual]);

  return useSyncExternalStore(engine.subscribe, getSnapshot, getSnapshot);
}

/**
 * The whole-session overview (timeline, narration, final module list).
 *
 * Returns `null` while the overview is still being folded in the background —
 * which only happens for long sessions, where a synchronous fold would block
 * the first paint.
 */
export function useSessionOverview(): SessionOverview | null {
  const engine = useEngine();
  // Reading the version during render means a session swap re-runs the effect
  // below, which is what stops the panels from showing the previous
  // session's timeline and architecture.
  const version = engine.getSessionVersion();
  const [overview, setOverview] = useState<SessionOverview | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOverview(engine.isOverviewReady() ? engine.getOverview() : null);
    const check = () => {
      if (cancelled) return;
      if (engine.isOverviewReady()) setOverview(engine.getOverview());
    };
    const unsubscribe = engine.subscribe(check);
    check();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [engine, version]);

  return overview;
}

/** Subscribe to the per-frame display channel. */
export function useEngineDisplay<T>(
  selector: (display: EngineDisplay) => T,
  isEqual: (a: T, b: T) => boolean = DEFAULT_IS_EQUAL,
): T {
  const engine = useEngine();
  const cache = useRef<{ value: T; primed: boolean }>({
    value: undefined as unknown as T,
    primed: false,
  });

  const getSnapshot = useCallback(() => {
    const next = selector(engine.getDisplay());
    if (cache.current.primed && isEqual(cache.current.value, next)) {
      return cache.current.value;
    }
    cache.current = { value: next, primed: true };
    return next;
  }, [engine, selector, isEqual]);

  return useSyncExternalStore(engine.subscribeDisplay, getSnapshot, getSnapshot);
}

/** The whole structural state. Use sparingly — it changes on every event. */
export function useFullEngineState(): EngineState {
  const engine = useEngine();
  const getSnapshot = useCallback(() => engine.getState(), [engine]);
  return useSyncExternalStore(engine.subscribe, getSnapshot, getSnapshot);
}

/** The whole display state. Changes every animation frame. */
export function useFullEngineDisplay(): EngineDisplay {
  const engine = useEngine();
  const getSnapshot = useCallback(() => engine.getDisplay(), [engine]);
  return useSyncExternalStore(engine.subscribeDisplay, getSnapshot, getSnapshot);
}

/**
 * Subscribe to the per-frame display channel *without* going through React
 * state. Imperative consumers (Monaco, the terminal) use this so that a
 * 60fps animation never triggers a React re-render.
 */
export function useEngineDisplayEffect(
  effect: (display: EngineDisplay) => void,
): void {
  const engine = useEngine();
  const effectRef = useRef(effect);
  effectRef.current = effect;
  useEffect(() => engine.subscribeDisplay((display) => effectRef.current(display)), [engine]);
}

/** Persist the playback position so a reload resumes where the viewer left off. */
export function usePlaybackPersistence(storageKey: string, enabled = true): void {
  const engine = useEngine();

  const save = useCallback(() => {
    if (!enabled || typeof window === 'undefined') return;
    try {
      const payload = {
        time: engine.getTime(),
        speed: engine.getSpeed(),
        status: engine.getStatus(),
      };
      window.localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      /* storage may be unavailable (private mode); ignore */
    }
  }, [engine, storageKey, enabled]);

  useEffect(() => {
    const interval = setInterval(save, 2000);
    window.addEventListener('beforeunload', save);
    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', save);
      save();
    };
  }, [save]);
}

export interface ResumedPosition {
  time: number;
  speed: number;
  status: string;
}

/** Read a previously persisted playback position. */
export function readPersistedPosition(
  storageKey: string,
): ResumedPosition | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResumedPosition;
    if (typeof parsed?.time !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Convenience hook: the pieces the playback control bar needs. */
export function usePlaybackControls() {
  const engine = useEngine();
  return useMemo(
    () => ({
      play: () => engine.play(),
      pause: () => engine.pause(),
      toggle: () => engine.toggle(),
      seek: (t: number) => engine.seek(t),
      stepForward: () => engine.stepForward(),
      stepBackward: () => engine.stepBackward(),
      setSpeed: (s: number) => engine.setSpeed(s),
      getTime: () => engine.getTime(),
      getDuration: () => engine.getDuration(),
      getSpeed: () => engine.getSpeed(),
      getStatus: () => engine.getStatus(),
    }),
    [engine],
  );
}
