/**
 * The playback engine.
 *
 * Responsibilities:
 *  - Own the virtual clock (ms since session start) and drive it from rAF.
 *  - Fold events into the reducer state, forward *and* backward.
 *  - Produce two separate view channels so that 60fps typing animation does not
 *    re-render the whole React tree:
 *      • structural  — files, tabs, timeline, narration, build status
 *      • display     — the text currently visible in the editor/terminal
 *  - Maintain checkpoints so that seeking into a 100k-event session is instant.
 *
 * The engine is framework agnostic. `usePlayback.ts` glues it to React.
 */

import {
  SessionState,
  type BuildRecord,
  type DependencyRecord,
  type ErrorRecord,
  type FileRecord,
  type FixRecord,
  type NarrationEntry,
  type SessionMeta,
  type StateSnapshot,
  type TerminalLineKind,
  type TimelineEntry,
} from './state';
import type { SessionEvent } from './events';
import {
  fitDuration,
  hashString,
  humanizeChunk,
  revealedCountAt,
  scaleDelays,
  uniformDelays,
} from './humanize';

export type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'ended';

export interface TerminalViewLine {
  id: number;
  kind: TerminalLineKind;
  text: string;
}

export interface DocumentView {
  path: string;
  text: string;
  language: string;
  cursor: number;
  selection: { start: number; length: number } | null;
  scrollTop: number;
  revision: number;
}

export interface EngineState {
  version: number;
  status: PlaybackStatus;
  speed: number;
  activeFile: string | null;
  tabs: string[];
  fileOrder: string[];
  createdFiles: string[];
  languages: Record<string, string>;
  terminalOpen: boolean;
  /**
   * The event timeline lives in `getOverview()` — it is derived from the
   * whole session, not from the applied prefix, and copying it on every
   * revision change would be expensive for long sessions.
   */
  narration: NarrationEntry[];
  build: BuildRecord;
  dependencies: DependencyRecord[];
  errors: ErrorRecord[];
  fixes: FixRecord[];
  totalEvents: number;
  consumedEvents: number;
  durationMs: number;
  title?: string;
  agent?: string;
  prompt?: string;
  model?: string;
}

export interface EngineDisplay {
  version: number;
  time: number;
  document: DocumentView | null;
  terminalLines: TerminalViewLine[];
  thinking: boolean;
  eventIndex: number;
}

interface Checkpoint {
  eventIndex: number;
  snapshot: StateSnapshot;
}

type ContentMask =
  | {
      kind: 'type';
      path: string;
      offset: number;
      length: number;
      content: string;
      delays: number[];
      startedAt: number;
      endsAt: number;
    }
  | {
      kind: 'erase';
      path: string;
      offset: number;
      length: number;
      original: string;
      delays: number[];
      startedAt: number;
      endsAt: number;
    };

interface TerminalMask {
  lineId: number;
  delays: number[];
  startedAt: number;
  endsAt: number;
}

export interface EngineOptions {
  seed?: string;
  /** Maximum number of retained checkpoints. */
  maxCheckpoints?: number;
  /** Called when an unexpected error occurs during a frame. */
  onError?: (error: unknown) => void;
}

export interface SessionOverview {
  timeline: TimelineEntry[];
  narration: NarrationEntry[];
  modules: { path: string; text: string; language: string }[];
  createdFiles: string[];
  touchedFiles: string[];
  dependencies: DependencyRecord[];
  errors: ErrorRecord[];
  fixes: FixRecord[];
  meta: SessionMeta;
}

const DEFAULT_MAX_CHECKPOINTS = 192;
const MUTATING_ACTIONS = new Set(['type', 'insert', 'delete', 'replace', 'file.rename']);

export class PlaybackEngine {
  private events: SessionEvent[] = [];
  private reducer = new SessionState();
  private eventIndex = 0;
  private time = 0;
  private durationMs = 0;
  private status: PlaybackStatus = 'idle';
  private speed = 1;
  private playing = false;
  private rafId: number | null = null;
  private lastWallTime = 0;
  private seed: string;
  private maxCheckpoints: number;
  private onError?: (error: unknown) => void;

  private checkpoints: Checkpoint[] = [];
  /** Approximate total size of the retained checkpoints, in bytes. */
  private checkpointBytes = 0;
  /** Upper bound on checkpoint memory. */
  private maxCheckpointBytes = 64 * 1024 * 1024;
  /** Bumped whenever the event stream is replaced. */
  private generation = 0;
  /** Live mode: the clock waits at the edge for more events. */
  private live = false;
  /** True when the viewer explicitly paused (as opposed to reaching the end). */
  private userPaused = false;
  private sessionVersion = 0;
  private contentMask: ContentMask | null = null;
  private terminalMask: TerminalMask | null = null;
  private thinkingUntil: number | null = null;
  private focusedFileOverride: string | null = null;

  private stateVersion = 0;
  private displayVersion = 0;
  private state!: EngineState;
  private display!: EngineDisplay;

  /** Cached copies of the reducer's collections, rebuilt only when it changes. */
  private cachedRevision = -1;
  private cachedFileOrder: string[] = [];
  private cachedTabs: string[] = [];
  private cachedCreatedFiles: string[] = [];
  private cachedNarration: NarrationEntry[] = [];
  private cachedErrors: ErrorRecord[] = [];
  private cachedFixes: FixRecord[] = [];
  private cachedDependencies: DependencyRecord[] = [];
  private cachedLanguages: Record<string, string> = {};
  /** True when the structural snapshot needs rebuilding. */
  private stateDirty = true;

  private stateListeners = new Set<(state: EngineState) => void>();
  private displayListeners = new Set<(display: EngineDisplay) => void>();
  private rafFactory: (cb: FrameRequestCallback) => number;
  private cafFactory: (handle: number) => void;
  private documentCache = new Map<
    string,
    {
      text: string;
      cursor: number;
      scrollTop: number;
      selectionStart: number;
      selectionLength: number;
      view: DocumentView;
    }
  >();
  private terminalCache: TerminalViewLine[] | null = null;
  private overviewCache: SessionOverview | null = null;
  /** The fully folded session state, computed once and reused. */
  private foldedState: SessionState | null = null;
  private overviewReady = false;

  constructor(options: EngineOptions = {}) {
    this.seed = options.seed ?? 'codecinema';
    this.maxCheckpoints = options.maxCheckpoints ?? DEFAULT_MAX_CHECKPOINTS;
    this.onError = options.onError;
    this.rafFactory =
      typeof requestAnimationFrame === 'function'
        ? (cb) => requestAnimationFrame(cb)
        : (cb) => setTimeout(() => cb(Date.now()), 16) as unknown as number;
    this.cafFactory =
      typeof cancelAnimationFrame === 'function'
        ? (handle) => cancelAnimationFrame(handle)
        : (handle) => clearTimeout(handle as unknown as NodeJS.Timeout);
    this.state = this.buildState();
    this.display = this.buildDisplay();
  }

  // ---------------------------------------------------------------- lifecycle

  /** Replace the event stream. Resets playback to t=0. */
  setEvents(events: SessionEvent[], options: { keepPosition?: boolean } = {}): void {
    const previousTime = this.time;
    const wasPlaying = this.playing;

    this.stopLoop();
    this.playing = false;
    this.status = 'idle';
    this.generation += 1;
    this.sessionVersion += 1;
    this.events = [...events].sort(
      (a, b) => a.timestamp - b.timestamp || (a.seq ?? 0) - (b.seq ?? 0),
    );
    this.durationMs = this.computeDuration();
    this.reducer = new SessionState();
    this.eventIndex = 0;
    this.time = 0;
    this.contentMask = null;
    this.terminalMask = null;
    this.thinkingUntil = null;
    this.focusedFileOverride = null;
    this.checkpoints = [];
    this.checkpointBytes = 0;
    this.documentCache.clear();
    this.terminalCache = null;
    this.overviewCache = null;
    this.foldedState = null;
    this.overviewReady = false;

    // Small sessions fold instantly; long ones are folded in the background.
    if (this.events.length > 0 && this.events.length <= 2000) {
      this.foldAll();
      this.overviewCache = null;
    }

    this.state = this.buildState();
    this.display = this.buildDisplay();
    this.notifyState();
    this.notifyDisplay();

    if (options.keepPosition && previousTime > 0) {
      this.seek(previousTime);
      if (wasPlaying) this.play();
    }
  }

  /** Append events that arrived live (recording mode). */
  appendEvents(newEvents: SessionEvent[]): void {
    if (newEvents.length === 0) return;
    const atLiveEdge =
      this.live ||
      this.eventIndex >= this.events.length ||
      this.time >= this.durationMs - 1;
    // `push(...arr)` overflows the argument stack for very large batches.
    for (const event of newEvents) this.events.push(event);
    this.events.sort((a, b) => a.timestamp - b.timestamp || (a.seq ?? 0) - (b.seq ?? 0));
    this.durationMs = Math.max(this.durationMs, this.computeDuration());
    this.state = this.buildState();
    this.overviewCache = null;
    this.foldedState = null;
    this.overviewReady = false;
    this.notifyState();
    if (atLiveEdge && this.playing) {
      // Follow the live edge instead of ending the session.
      this.advanceTo(this.durationMs);
      this.time = this.durationMs;
      this.stateDirty = true;
      this.flushState();
    }
  }

  getEvents(): readonly SessionEvent[] {
    return this.events;
  }

  /** A counter that changes whenever the event stream is replaced. */
  getSessionVersion(): number {
    return this.sessionVersion;
  }

  destroy(): void {
    this.generation += 1;
    this.stopLoop();
    this.stateListeners.clear();
    this.displayListeners.clear();
  }

  // ------------------------------------------------------------------- clock

  play(): void {
    if (this.playing) return;
    if (this.time >= this.durationMs) this.seek(0);
    this.playing = true;
    this.userPaused = false;
    this.status = this.time >= this.durationMs ? 'ended' : 'playing';
    this.lastWallTime = now();
    this.state = this.buildState();
    this.notifyState();
    this.startLoop();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.userPaused = true;
    this.status = this.time >= this.durationMs ? 'ended' : 'paused';
    this.stopLoop();
    this.state = this.buildState();
    this.notifyState();
    this.notifyDisplay();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /**
   * Live mode.
   *
   * The clock stops at the end of the known events and waits for more,
   * instead of ending the session. A live recording has no end until the
   * agent stops.
   */
  setLiveMode(enabled: boolean): void {
    this.live = enabled;
  }

  isLive(): boolean {
    return this.live;
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0.1, Math.min(64, speed));
    this.state = this.buildState();
    this.notifyState();
  }

  getSpeed(): number {
    return this.speed;
  }

  getStatus(): PlaybackStatus {
    return this.status;
  }

  getTime(): number {
    return this.time;
  }

  getDuration(): number {
    return this.durationMs;
  }

  /** Jump to an absolute timestamp. Works in both directions. */
  seek(timestamp: number): void {
    const target = Math.max(0, Math.min(timestamp, this.durationMs));
    if (target < this.time) {
      this.rewindTo(target);
    } else {
      this.advanceTo(target);
    }
    this.time = target;
    if (this.durationMs > 0 && target >= this.durationMs) {
      this.status = 'ended';
      this.completePending();
    } else if (this.status === 'ended') {
      this.status = 'paused';
    }
    if (this.playing && target >= this.durationMs) {
      this.pause();
    }
    this.state = this.buildState();
    this.notifyState();
    this.notifyDisplay();
  }

  /** Jump to the next significant event (timeline entry). */
  stepForward(): void {
    // The reducer's timeline only knows about the applied prefix; the
    // overview knows about the whole session but costs a full fold to
    // compute. Prefer whichever is already available.
    const timeline = this.overviewReady
      ? this.getOverview().timeline
      : this.reducer.timeline;
    for (const entry of timeline) {
      if (entry.timestamp > this.time + 1) {
        this.seek(entry.timestamp);
        return;
      }
    }
  }

  /** Jump to the previous significant event. */
  stepBackward(): void {
    const timeline = this.overviewReady
      ? this.getOverview().timeline
      : this.reducer.timeline;
    let previous: number | null = null;
    for (const entry of timeline) {
      if (entry.timestamp < this.time - 1) previous = entry.timestamp;
      else break;
    }
    if (previous !== null) this.seek(previous);
  }

  /** Jump to a specific event by index in the raw event array. */
  jumpToEvent(index: number): void {
    const event = this.events[index];
    if (event) this.seek(event.timestamp);
  }

  /**
   * Open a file from the explorer.
   *
   * Seeks to the last moment the session touched that file (so the viewer
   * lands on the relevant code) and pins it as the active document until the
   * session itself switches files again.
   */
  seekToFile(path: string): void {
    const timeline = this.reducer.timeline;
    for (let i = timeline.length - 1; i >= 0; i--) {
      if (timeline[i].file === path) {
        this.seek(timeline[i].timestamp);
        break;
      }
    }
    if (this.reducer.files.has(path)) {
      this.focusedFileOverride = path;
      this.notifyState();
      this.refreshDisplay();
    }
  }

  /** Fold every event once and keep the result. */
  private foldAll(): SessionState {
    if (this.foldedState) return this.foldedState;
    const scratch = new SessionState();
    for (let i = 0; i < this.events.length; i++) {
      scratch.apply(this.events[i], i);
    }
    this.foldedState = scratch;
    this.overviewReady = true;
    return scratch;
  }

  /**
   * Whether the whole-session overview has been computed yet.
   *
   * For long sessions this is built in the background so the first paint is
   * not blocked by a hundred-thousand-event fold.
   */
  isOverviewReady(): boolean {
    return this.overviewReady;
  }

  /**
   * A structural overview of the *whole* session, computed by folding every
   * event once. Used by the timeline, the reasoning panel and the architecture
   * view — which all need to describe the complete session, not just the part
   * that has been played so far.
   */
  getOverview(): SessionOverview {
    if (this.overviewCache) return this.overviewCache;
    const scratch = this.foldAll();
    const modules: { path: string; text: string; language: string }[] = [];
    for (const rec of scratch.files.values()) {
      modules.push({
        path: rec.path,
        text: rec.buffer.toString(),
        language: rec.language,
      });
    }
    this.overviewCache = {
      timeline: scratch.timeline,
      narration: scratch.narration,
      modules,
      createdFiles: [...scratch.createdFiles],
      touchedFiles: [...scratch.touchedFiles],
      dependencies: [...scratch.dependencies],
      errors: [...scratch.errors],
      fixes: [...scratch.fixes],
      meta: { ...scratch.meta },
    };
    return this.overviewCache;
  }

  /** The document the editor should show. */
  getActiveFile(): string | null {
    if (
      this.focusedFileOverride &&
      this.reducer.files.has(this.focusedFileOverride)
    ) {
      return this.focusedFileOverride;
    }
    return this.reducer.activeFile;
  }

  // -------------------------------------------------------------- listeners

  subscribe = (listener: (state: EngineState) => void): (() => void) => {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  };

  subscribeDisplay = (listener: (display: EngineDisplay) => void): (() => void) => {
    this.displayListeners.add(listener);
    return () => this.displayListeners.delete(listener);
  };

  getState = (): EngineState => this.state;

  getDisplay = (): EngineDisplay => this.display;

  // ------------------------------------------------------------------ engine

  private startLoop(): void {
    if (this.rafId !== null) return;
    const tick = (t: number) => {
      this.rafId = null;
      try {
        this.frame(t);
      } catch (error) {
        this.onError?.(error);
        this.playing = false;
        this.status = 'paused';
      }
      if (this.playing) this.startLoop();
    };
    this.rafId = this.rafFactory(tick);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      this.cafFactory(this.rafId);
      this.rafId = null;
    }
  }

  private frame(timestamp: number): void {
    const wall = now();
    // Clamp the delta so a backgrounded tab does not fast-forward the session
    // by minutes when it regains focus.
    const delta = Math.min(100, Math.max(0, wall - this.lastWallTime));
    this.lastWallTime = wall;
    if (this.playing) {
      const target = this.time + delta * this.speed;
      if (target >= this.durationMs) {
        this.advanceTo(this.durationMs);
        this.time = this.durationMs;
        if (this.live) {
          // More events may still arrive — park at the edge and wait.
          this.stateDirty = true;
          this.flushState();
        } else {
          this.completePending();
          this.playing = false;
          this.status = 'ended';
          this.state = this.buildState();
          this.notifyState();
        }
      } else {
        this.advanceTo(target);
        this.time = target;
      }
    }
    this.refreshDisplay();
    this.flushState();
  }

  /**
   * Publish the structural snapshot if the reducer moved.
   *
   * Without this the structural channel would only update on an explicit
   * play/pause/seek — the project explorer and the tab bar would stay empty
   * for the whole of a playback.
   */
  private flushState(): void {
    if (!this.stateDirty) return;
    this.stateDirty = false;
    this.stateVersion += 1;
    this.state = { ...this.buildState(), version: this.stateVersion };
    for (const listener of this.stateListeners) listener(this.state);
  }

  /**
   * Flush any in-flight animation.
   *
   * At the end of a session every edit must be visible in its final state —
   * otherwise the viewer stops one keystroke short of the finished file.
   */
  private completePending(): void {
    this.contentMask = null;
    this.terminalMask = null;
  }

  private advanceTo(target: number): void {
    let applied = false;
    while (this.eventIndex < this.events.length) {
      const event = this.events[this.eventIndex];
      if (event.timestamp > target) break;
      this.applyEvent(this.eventIndex);
      this.eventIndex += 1;
      applied = true;
    }
    if (applied) this.stateDirty = true;
    this.refreshDisplay();
  }

  private rewindTo(target: number): void {
    // Restore the closest checkpoint at or before the target.
    let checkpoint = this.findCheckpoint(target);
    if (checkpoint) {
      this.reducer = SessionState.restore(checkpoint.snapshot);
      this.eventIndex = checkpoint.eventIndex;
    } else {
      this.reducer = new SessionState();
      this.eventIndex = 0;
    }
    this.contentMask = null;
    this.terminalMask = null;
    // `thinkingUntil` is engine state that is not part of the snapshot, so it
    // has to be cleared explicitly or the "Thinking…" badge survives a rewind
    // to before the think event.
    this.thinkingUntil = null;
    this.documentCache.clear();
    this.advanceTo(target);
  }

  private findCheckpoint(target: number): Checkpoint | null {
    let best: Checkpoint | null = null;
    for (const checkpoint of this.checkpoints) {
      // `eventIndex` is the count of events already applied, so the last
      // applied event is at `eventIndex - 1`.
      const event = this.events[checkpoint.eventIndex - 1];
      if (!event) break;
      if (event.timestamp <= target) best = checkpoint;
      else break;
    }
    return best;
  }

  private applyEvent(index: number): void {
    const event = this.events[index];
    const next = this.events[index + 1];

    // Content edits invalidate any in-flight typing mask.
    if (MUTATING_ACTIONS.has(event.action)) {
      this.contentMask = null;
    }
    // The terminal mask only dies when a *new* terminal line is produced.
    // Clearing it on every event would make a command appear instantly
    // whenever something else happened 50ms later.
    const terminalLinesBefore = this.reducer.terminal.lines.length;

    // Capture pre-edit text for erase animations before the reducer mutates it.
    let eraseOriginal: string | undefined;
    let eraseOffset = 0;
    if (event.action === 'delete') {
      const rec = this.reducer.files.get(event.file);
      if (rec) {
        const length = rec.buffer.length;
        eraseOffset = Math.max(
          0,
          Math.min(event.offset ?? Math.max(0, length - event.count), length),
        );
        eraseOriginal = rec.buffer.slice(eraseOffset, event.count);
      }
    }
    let typeOffset = 0;
    let typeContent = '';
    if (event.action === 'type') {
      const rec = this.reducer.files.get(event.file);
      const length = rec ? rec.buffer.length : 0;
      // The reducer clamps the insert to the end of the file; the mask must
      // use the same offset or it will reveal characters twice.
      typeOffset = Math.max(0, Math.min(event.offset ?? length, length));
      typeContent = event.content;
    }

    this.reducer.apply(event, index);
    this.terminalCache = null;
    if (event.action === 'focus') this.focusedFileOverride = null;
    if (this.reducer.terminal.lines.length !== terminalLinesBefore) {
      this.terminalMask = null;
    }

    // Plan the animation for this event.
    const window = next ? next.timestamp - event.timestamp : Infinity;
    if (event.action === 'type') {
      const profile = event.profile;
      const { delays, totalMs } = humanizeChunk(
        typeContent,
        profile,
        hashString(`${this.seed}:${event.file}:${index}:${typeOffset}`),
      );
      const duration = fitDuration(totalMs, window);
      this.contentMask = {
        kind: 'type',
        path: event.file,
        offset: typeOffset,
        length: typeContent.length,
        content: typeContent,
        // The delay table is scaled to the window the recording left, so the
        // chunk is always fully typed before the next event is applied.
        delays: scaleDelays(delays, duration),
        startedAt: event.timestamp,
        endsAt: event.timestamp + duration,
      };
    } else if (event.action === 'delete' && eraseOriginal !== undefined) {
      const { delays, totalMs } = humanizeChunk(
        eraseOriginal,
        { cps: 16 },
        hashString(`${this.seed}:erase:${index}:${event.file}`),
      );
      const duration = fitDuration(totalMs, window);
      this.contentMask = {
        kind: 'erase',
        path: event.file,
        offset: eraseOffset,
        // The animated region is the text that actually existed, not the
        // requested count — a delete beyond the end of the file must not
        // leave phantom characters on screen forever.
        length: eraseOriginal.length,
        original: eraseOriginal,
        delays: scaleDelays(delays, duration),
        startedAt: event.timestamp,
        endsAt: event.timestamp + duration,
      };
    } else if (event.action === 'think') {
      const duration = event.duration ?? Math.min(window, 2500);
      this.thinkingUntil = event.timestamp + duration;
    } else if (
      event.action === 'terminal.command' ||
      event.action === 'terminal' ||
      event.action === 'terminal.write'
    ) {
      const text = event.action === 'terminal.write' ? (event.text ?? '') : (event.command ?? event.text ?? '');
      const line = this.reducer.terminal.lines[this.reducer.terminal.lines.length - 1];
      if (line && text) {
        const cps = line.kind === 'command' ? 42 : 260;
        const delays = uniformDelays(
          text,
          cps,
          0.25,
          hashString(`${this.seed}:term:${index}`),
        );
        let total = 0;
        for (const d of delays) total += d;
        const duration = fitDuration(total, window);
        this.terminalMask = {
          lineId: line.id,
          delays: scaleDelays(delays, duration),
          startedAt: event.timestamp,
          endsAt: event.timestamp + duration,
        };
      }
    }

    if (this.checkpointDue(index)) {
      this.pushCheckpoint(index + 1);
    }
  }

  private checkpointDue(index: number): boolean {
    const interval = this.checkpointInterval();
    return (index + 1) % interval === 0;
  }

  private checkpointInterval(): number {
    return Math.max(200, Math.ceil(this.events.length / this.maxCheckpoints));
  }

  /**
   * Approximate the memory a snapshot occupies.
   *
   * Checkpoints hold the full text of every file, so the *number* of
   * checkpoints is not a sufficient bound — a 2 MB session with 192
   * checkpoints is 384 MB of duplicated text. The budget is measured in bytes.
   */
  private estimateSnapshotBytes(snapshot: StateSnapshot): number {
    let bytes = 0;
    for (const file of snapshot.files) bytes += file.text.length * 2 + 160;
    bytes += snapshot.terminal.lines.length * 96;
    bytes += snapshot.narration.length * 160;
    bytes += snapshot.timeline.length * 160;
    bytes += (snapshot.errors.length + snapshot.fixes.length) * 160;
    bytes += snapshot.dependencies.length * 96;
    return bytes;
  }

  /** Drop every other checkpoint, keeping the first and the last. */
  private thinCheckpoints(): void {
    const kept: Checkpoint[] = [];
    let bytes = 0;
    for (let i = 0; i < this.checkpoints.length; i++) {
      const isKeep = i === 0 || i % 2 === 1 || i === this.checkpoints.length - 1;
      if (!isKeep) continue;
      kept.push(this.checkpoints[i]);
      bytes += this.estimateSnapshotBytes(this.checkpoints[i].snapshot);
    }
    this.checkpoints = kept;
    this.checkpointBytes = bytes;
  }

  private pushCheckpoint(eventIndex: number): void {
    const snapshot = this.reducer.snapshot();
    this.checkpoints.push({ eventIndex, snapshot });
    this.checkpointBytes += this.estimateSnapshotBytes(snapshot);

    if (
      this.checkpoints.length > this.maxCheckpoints + 8 ||
      this.checkpointBytes > this.maxCheckpointBytes
    ) {
      // Drop every other checkpoint, keeping the newest and the empty
      // session-start one, to bound memory.
      this.thinCheckpoints();
    }
  }

  /** Build checkpoints for the whole session in the background so that the
   * first scrub to the end is instant even on a 100k-event session. */
  primeCheckpoints(onDone?: () => void): void {
    if (this.events.length < 400) {
      onDone?.();
      return;
    }
    // Capture the generation and the event array. Reading `this.events` from
    // the background loop while another session is being loaded would fold
    // two sessions into one set of checkpoints.
    const generation = this.generation;
    const events = this.events;
    const interval = this.checkpointInterval();
    const scratch = new SessionState();
    const checkpoints: Checkpoint[] = [{ eventIndex: 0, snapshot: scratch.snapshot() }];
    let bytes = this.estimateSnapshotBytes(checkpoints[0].snapshot);
    let index = 0;

    const chunk = () => {
      if (generation !== this.generation) return; // superseded — abort
      const start = performance.now();
      while (index < events.length && performance.now() - start < 8) {
        scratch.apply(events[index], index);
        index += 1;
        if (index % interval === 0) {
          const snapshot = scratch.snapshot();
          checkpoints.push({ eventIndex: index, snapshot });
          bytes += this.estimateSnapshotBytes(snapshot);
          if (
            checkpoints.length > this.maxCheckpoints + 8 ||
            bytes > this.maxCheckpointBytes
          ) {
            // Thin the list in place, keeping the first and the last.
            const kept: Checkpoint[] = [];
            let keptBytes = 0;
            for (let i = 0; i < checkpoints.length; i++) {
              const isKeep = i === 0 || i % 2 === 1 || i === checkpoints.length - 1;
              if (!isKeep) continue;
              kept.push(checkpoints[i]);
              keptBytes += this.estimateSnapshotBytes(checkpoints[i].snapshot);
            }
            checkpoints.length = 0;
            checkpoints.push(...kept);
            bytes = keptBytes;
          }
        }
      }
      if (index < events.length) {
        setTimeout(chunk, 0);
      } else {
        if (generation !== this.generation) return;
        this.checkpoints = checkpoints;
        this.checkpointBytes = bytes;
        // The overview is derived from the same fold; reuse it so the first
        // "step to next event" is instant.
        this.foldedState = scratch;
        this.overviewReady = true;
        this.overviewCache = null;
        this.notifyState();
        onDone?.();
      }
    };
    setTimeout(chunk, 0);
  }

  // ----------------------------------------------------------------- display

  private refreshDisplay(): void {
    this.displayVersion += 1;
    this.display = { ...this.buildDisplay(), version: this.displayVersion };
    for (const listener of this.displayListeners) listener(this.display);
  }

  private buildDisplay(): EngineDisplay {
    const activeFile = this.getActiveFile();
    let document: DocumentView | null = null;
    if (activeFile) {
      const rec = this.reducer.files.get(activeFile);
      if (rec) document = this.buildDocumentView(rec);
    }
    const terminalLines = this.buildTerminalLines();
    if (this.thinkingUntil !== null && this.time >= this.thinkingUntil) {
      this.thinkingUntil = null;
    }
    const thinking = this.thinkingUntil !== null;
    return {
      version: this.displayVersion,
      time: this.time,
      document,
      terminalLines,
      thinking,
      eventIndex: this.eventIndex,
    };
  }

  private buildDocumentView(rec: FileRecord): DocumentView {
    const text = this.maskText(rec);
    const previous = this.documentCache.get(rec.path);
    if (
      previous &&
      previous.text === text &&
      previous.cursor === rec.cursor &&
      previous.scrollTop === rec.scrollTop &&
      previous.selectionStart === (rec.selection?.start ?? -1) &&
      previous.selectionLength === (rec.selection?.length ?? -1)
    ) {
      return previous.view;
    }
    const view: DocumentView = {
      path: rec.path,
      text,
      language: rec.language,
      cursor: rec.cursor,
      selection: rec.selection,
      scrollTop: rec.scrollTop,
      revision: rec.revision,
    };
    this.documentCache.set(rec.path, {
      text,
      cursor: rec.cursor,
      scrollTop: rec.scrollTop,
      selectionStart: rec.selection?.start ?? -1,
      selectionLength: rec.selection?.length ?? -1,
      view,
    });
    return view;
  }

  /** Apply the in-flight typing/erase mask to a file's semantic content. */
  private maskText(rec: FileRecord): string {
    const mask = this.contentMask;
    if (!mask || mask.path !== rec.path) return rec.buffer.toString();

    const revealed = revealedCountAt(mask.delays, this.time - mask.startedAt);
    if (mask.kind === 'type') {
      if (revealed >= mask.length) return rec.buffer.toString();
      const base = rec.buffer.toString();
      return (
        base.slice(0, mask.offset) +
        mask.content.slice(0, revealed) +
        base.slice(mask.offset + mask.length)
      );
    }
    if (revealed >= mask.length) return rec.buffer.toString();
    const base = rec.buffer.toString();
    const remaining = mask.length - revealed;
    return (
      base.slice(0, mask.offset) +
      mask.original.slice(0, remaining) +
      base.slice(mask.offset)
    );
  }

  private buildTerminalLines(): TerminalViewLine[] {
    const mask = this.terminalMask;
    const lines = this.reducer.terminal.lines;
    const next = lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      text: mask && l.id === mask.lineId
        ? l.text.slice(0, revealedCountAt(mask.delays, this.time - mask.startedAt))
        : l.text,
    }));
    // Keep a stable reference when nothing changed so React can skip the
    // re-render — the terminal only changes while a command is streaming.
    const previous = this.terminalCache;
    if (
      previous &&
      previous.length === next.length &&
      previous.every((line, i) => {
        const other = next[i];
        return (
          line.id === other.id &&
          line.kind === other.kind &&
          line.text === other.text
        );
      })
    ) {
      return previous;
    }
    this.terminalCache = next;
    return next;
  }

  // ------------------------------------------------------------------- state

  private buildState(): EngineState {
    if (this.cachedRevision !== this.reducer.revision) {
      this.cachedRevision = this.reducer.revision;
      this.cachedFileOrder = [...this.reducer.fileOrder];
      this.cachedTabs = [...this.reducer.tabs];
      this.cachedCreatedFiles = [...this.reducer.createdFiles];
      this.cachedNarration = [...this.reducer.narration];
      this.cachedErrors = [...this.reducer.errors];
      this.cachedFixes = [...this.reducer.fixes];
      this.cachedDependencies = [...this.reducer.dependencies];
      this.cachedLanguages = {};
      for (const [path, rec] of this.reducer.files) {
        this.cachedLanguages[path] = rec.language;
      }
    }
    const languages = this.cachedLanguages;
    return {
      version: this.stateVersion,
      status: this.status,
      speed: this.speed,
      activeFile: this.getActiveFile(),
      tabs: this.cachedTabs,
      fileOrder: this.cachedFileOrder,
      createdFiles: this.cachedCreatedFiles,
      languages,
      terminalOpen: this.reducer.terminal.open,
      narration: this.cachedNarration,
      build: this.reducer.build,
      dependencies: this.cachedDependencies,
      errors: this.cachedErrors,
      fixes: this.cachedFixes,
      totalEvents: this.events.length,
      consumedEvents: this.eventIndex,
      durationMs: this.durationMs,
      title: this.reducer.meta.title,
      agent: this.reducer.meta.agent,
      prompt: this.reducer.meta.prompt,
      model: this.reducer.meta.model,
    };
  }

  private notifyDisplay(): void {
    this.displayVersion += 1;
    this.display = { ...this.buildDisplay(), version: this.displayVersion };
    for (const listener of this.displayListeners) listener(this.display);
  }

  private notifyState(): void {
    this.stateDirty = false;
    this.stateVersion += 1;
    this.state = { ...this.buildState(), version: this.stateVersion };
    for (const listener of this.stateListeners) listener(this.state);
  }

  private computeDuration(): number {
    let max = 0;
    for (const event of this.events) {
      if (event.timestamp > max) max = event.timestamp;
    }
    return max;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
