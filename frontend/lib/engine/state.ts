/**
 * Semantic session state and the pure event reducer.
 *
 * The reducer is a *pure fold* over the event stream: applying the same events
 * in the same order always produces the same state. It knows nothing about
 * playback speed, animation or the UI — those live in `engine.ts`.
 *
 * Splitting it this way buys three things:
 *  1. Checkpoints are trivial (snapshot the reducer state).
 *  2. Seeking is just "restore the nearest checkpoint, then re-fold".
 *  3. The same reducer can run server-side (Python) to answer
 *     `GET /sessions/{id}/state?at=…` with identical results.
 */

import { PieceTable } from './pieceTable';
import { detectLanguage } from './languages';
import type { EventAction, NarrationCategory, SessionEvent } from './events';

export type TerminalLineKind = 'command' | 'output' | 'error' | 'info' | 'success';

export interface TerminalLineRecord {
  id: number;
  kind: TerminalLineKind;
  text: string;
  timestamp: number;
  /** Streaming lines are revealed progressively by the engine. */
  streamed: boolean;
}

export interface TerminalRecord {
  open: boolean;
  lines: TerminalLineRecord[];
  nextId: number;
  lastExitCode: number | null;
}

export interface FileRecord {
  path: string;
  buffer: PieceTable;
  language: string;
  createdAt: number;
  lastModifiedAt: number;
  cursor: number;
  selection: { start: number; length: number } | null;
  scrollTop: number;
  revision: number;
}

export interface NarrationEntry {
  id: number;
  timestamp: number;
  text: string;
  category: NarrationCategory;
  file?: string;
}

export type TimelineKind =
  | 'session'
  | 'think'
  | 'file'
  | 'edit'
  | 'terminal'
  | 'build'
  | 'test'
  | 'error'
  | 'fix'
  | 'narration'
  | 'dependency';

export interface TimelineEntry {
  id: number;
  /** Index of the source event in the session event array. */
  eventIndex: number;
  timestamp: number;
  action: EventAction;
  kind: TimelineKind;
  label: string;
  detail?: string;
  file?: string;
  /** Grouping key so the UI can collapse consecutive edits to one file. */
  groupKey?: string;
}

export interface BuildRecord {
  status: 'idle' | 'running' | 'success' | 'failed';
  target?: string;
  errors: string[];
  startedAt?: number;
  finishedAt?: number;
}

export interface ErrorRecord {
  id: number;
  timestamp: number;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  resolved: boolean;
}

export interface FixRecord {
  id: number;
  timestamp: number;
  message: string;
  file?: string;
}

export interface DependencyRecord {
  name: string;
  version?: string;
  manager?: string;
  addedAt: number;
}

export interface SessionMeta {
  title?: string;
  agent?: string;
  prompt?: string;
  repo?: string;
  model?: string;
}

export interface FileSnapshot {
  path: string;
  text: string;
  language: string;
  createdAt: number;
  lastModifiedAt: number;
  cursor: number;
  selection: { start: number; length: number } | null;
  scrollTop: number;
  revision: number;
}

export interface StateSnapshot {
  files: FileSnapshot[];
  fileOrder: string[];
  tabs: string[];
  activeFile: string | null;
  terminal: {
    open: boolean;
    lines: TerminalLineRecord[];
    nextId: number;
    lastExitCode: number | null;
  };
  narration: NarrationEntry[];
  timeline: TimelineEntry[];
  dependencies: DependencyRecord[];
  build: BuildRecord;
  errors: ErrorRecord[];
  fixes: FixRecord[];
  meta: SessionMeta;
  consumedEvents: number;
  touchedFiles: string[];
  createdFiles: string[];
}

/** Actions that produce a timeline entry in the UI. */
const TIMELINE_ACTIONS = new Set<EventAction>([
  'session.start',
  'session.end',
  'think',
  'narrate',
  'file.create',
  'file.delete',
  'file.rename',
  'terminal',
  'terminal.open',
  'terminal.command',
  'terminal.write',
  'terminal.exit',
  'build.start',
  'build.success',
  'build.failure',
  'test.start',
  'test.result',
  'error',
  'fix',
  'dependency.add',
  'dependency.remove',
  'pause',
]);

export class SessionState {
  files = new Map<string, FileRecord>();
  fileOrder: string[] = [];
  touchedFiles: string[] = [];
  /** Files the agent created during the session (never pre-existing). */
  createdFiles: string[] = [];
  tabs: string[] = [];
  activeFile: string | null = null;
  terminal: TerminalRecord = { open: false, lines: [], nextId: 0, lastExitCode: null };
  narration: NarrationEntry[] = [];
  timeline: TimelineEntry[] = [];
  dependencies: DependencyRecord[] = [];
  build: BuildRecord = { status: 'idle', errors: [] };
  errors: ErrorRecord[] = [];
  fixes: FixRecord[] = [];
  meta: SessionMeta = {};
  consumedEvents = 0;
  /**
   * Bumped on every applied event.
   *
   * The engine uses it to decide when its cached structural snapshot is
   * stale, so it can avoid copying large arrays on frames where nothing
   * actually changed.
   */
  revision = 0;
  private nextNarrationId = 0;
  private nextErrorId = 0;
  private nextFixId = 0;

  /**
   * Apply one event. The caller (engine) is responsible for capturing any
   * animation metadata *before* calling this.
   */
  apply(event: SessionEvent, eventIndex: number): void {
    this.consumedEvents = eventIndex + 1;
    this.revision += 1;
    const ts = event.timestamp;

    switch (event.action) {
      case 'session.start': {
        this.meta = {
          title: event.title ?? this.meta.title,
          agent: event.agent ?? this.meta.agent,
          prompt: event.prompt ?? this.meta.prompt,
          repo: event.repo ?? this.meta.repo,
          model: event.model ?? this.meta.model,
        };
        break;
      }
      case 'session.end': {
        break;
      }
      case 'think': {
        break;
      }
      case 'narrate': {
        this.narration.push({
          id: this.nextNarrationId++,
          timestamp: ts,
          text: event.text,
          category: event.category ?? 'explanation',
          file: event.file,
        });
        break;
      }
      case 'file.create': {
        const path = event.file;
        if (!this.files.has(path)) {
          this.fileOrder.push(path);
          this.touchedFiles.push(path);
          this.createdFiles.push(path);
        }
        this.files.set(path, {
          path,
          buffer: PieceTable.fromString(''),
          language: event.language ?? detectLanguage(path),
          createdAt: ts,
          lastModifiedAt: ts,
          cursor: 0,
          selection: null,
          scrollTop: 0,
          revision: 0,
        });
        // Creating a file opens it — that is what an IDE does, and it is what
        // the viewer expects to see.
        if (!this.tabs.includes(path)) this.tabs.push(path);
        this.activeFile = path;
        // An explicit content payload creates the file pre-filled.
        const content = typeof event.content === 'string' ? event.content : undefined;
        if (content) {
          const rec = this.files.get(path)!;
          rec.buffer.setText(content);
          rec.revision += 1;
        }
        break;
      }
      case 'file.delete': {
        const path = event.file;
        this.files.delete(path);
        this.fileOrder = this.fileOrder.filter((p) => p !== path);
        this.tabs = this.tabs.filter((t) => t !== path);
        if (this.activeFile === path) {
          this.activeFile = this.tabs[this.tabs.length - 1] ?? null;
        }
        break;
      }
      case 'file.rename': {
        const from = event.file;
        const to = event.to;
        const rec = this.files.get(from);
        if (rec) {
          this.files.delete(from);
          rec.path = to;
          rec.language = detectLanguage(to);
          this.files.set(to, rec);
          this.fileOrder = this.fileOrder.map((p) => (p === from ? to : p));
          this.tabs = this.tabs.map((t) => (t === from ? to : t));
          if (this.activeFile === from) this.activeFile = to;
        }
        break;
      }
      case 'type':
      case 'insert': {
        const rec = this.ensureFile(event.file, ts);
        const offset = event.offset ?? rec.buffer.length;
        rec.buffer.splice(offset, 0, event.content);
        rec.cursor = offset + event.content.length;
        rec.selection = null;
        rec.lastModifiedAt = ts;
        rec.revision += 1;
        break;
      }
      case 'delete': {
        const rec = this.files.get(event.file);
        if (!rec) break;
        const offset = event.offset ?? Math.max(0, rec.buffer.length - event.count);
        rec.buffer.delete(offset, event.count);
        rec.cursor = offset;
        rec.selection = null;
        rec.lastModifiedAt = ts;
        rec.revision += 1;
        break;
      }
      case 'replace': {
        const rec = this.ensureFile(event.file, ts);
        rec.buffer.splice(event.offset, event.count, event.content);
        rec.cursor = event.offset + event.content.length;
        rec.selection = null;
        rec.lastModifiedAt = ts;
        rec.revision += 1;
        break;
      }
      case 'cursor': {
        const rec = this.files.get(event.file);
        if (!rec) break;
        rec.cursor = event.offset;
        rec.selection = null;
        break;
      }
      case 'select': {
        const rec = this.files.get(event.file);
        if (!rec) break;
        rec.cursor = event.offset;
        rec.selection = { start: event.offset, length: event.length };
        break;
      }
      case 'scroll': {
        const rec = this.files.get(event.file);
        if (!rec) break;
        rec.scrollTop = event.top;
        break;
      }
      case 'focus': {
        this.openFile(event.file, ts);
        break;
      }
      case 'close': {
        this.tabs = this.tabs.filter((t) => t !== event.file);
        if (this.activeFile === event.file) {
          this.activeFile = this.tabs[this.tabs.length - 1] ?? null;
        }
        break;
      }
      case 'pause': {
        break;
      }
      case 'terminal':
      case 'terminal.command': {
        const command = event.command ?? event.text ?? '';
        if (command) {
          this.pushTerminalLine('command', command, ts, true);
        }
        this.terminal.open = true;
        break;
      }
      case 'terminal.write': {
        const text = event.text ?? '';
        if (text) {
          const kind: TerminalLineKind = event.kind === 'error' ? 'error' : 'output';
          this.pushTerminalLine(kind, text, ts, true);
        }
        this.terminal.open = true;
        break;
      }
      case 'terminal.open': {
        this.terminal.open = true;
        break;
      }
      case 'terminal.exit': {
        this.terminal.lastExitCode = event.exitCode ?? 0;
        if (this.terminal.lastExitCode !== 0) {
          this.pushTerminalLine(
            'error',
            `Process exited with code ${this.terminal.lastExitCode}`,
            ts,
            false,
          );
        } else {
          this.pushTerminalLine('success', 'Process exited with code 0', ts, false);
        }
        break;
      }
      case 'build.start': {
        this.build = { status: 'running', target: event.target, errors: [], startedAt: ts };
        break;
      }
      case 'build.success': {
        this.build = { ...this.build, status: 'success', finishedAt: ts };
        break;
      }
      case 'build.failure': {
        this.build = {
          ...this.build,
          status: 'failed',
          finishedAt: ts,
          errors: event.errors ?? [],
        };
        break;
      }
      case 'test.start': {
        this.build = { status: 'running', target: event.command, errors: [], startedAt: ts };
        break;
      }
      case 'test.result': {
        this.build = {
          ...this.build,
          status: event.failed > 0 ? 'failed' : 'success',
          finishedAt: ts,
          errors: event.failed > 0 ? [`${event.failed} test(s) failed`] : [],
        };
        break;
      }
      case 'error': {
        this.errors.push({
          id: this.nextErrorId++,
          timestamp: ts,
          message: event.message,
          file: event.file,
          line: event.line,
          column: event.column,
          resolved: false,
        });
        break;
      }
      case 'fix': {
        this.fixes.push({
          id: this.nextFixId++,
          timestamp: ts,
          message: event.message,
          file: event.file,
        });
        // A fix resolves the most recent unresolved error.
        for (let i = this.errors.length - 1; i >= 0; i--) {
          if (!this.errors[i].resolved) {
            this.errors[i].resolved = true;
            break;
          }
        }
        break;
      }
      case 'dependency.add': {
        if (!this.dependencies.some((d) => d.name === event.name)) {
          this.dependencies.push({
            name: event.name,
            version: event.version,
            manager: event.manager,
            addedAt: ts,
          });
        }
        break;
      }
      case 'dependency.remove': {
        this.dependencies = this.dependencies.filter((d) => d.name !== event.name);
        break;
      }
    }

    if (TIMELINE_ACTIONS.has(event.action)) {
      const entry = this.buildTimelineEntry(event, eventIndex);
      if (entry) this.timeline.push(entry);
    }
  }

  private ensureFile(path: string, ts: number): FileRecord {
    let rec = this.files.get(path);
    if (!rec) {
      rec = {
        path,
        buffer: PieceTable.fromString(''),
        language: detectLanguage(path),
        createdAt: ts,
        lastModifiedAt: ts,
        cursor: 0,
        selection: null,
        scrollTop: 0,
        revision: 0,
      };
      this.files.set(path, rec);
      this.fileOrder.push(path);
      this.touchedFiles.push(path);
    }
    return rec;
  }

  private openFile(path: string, ts: number): void {
    if (!this.files.has(path)) {
      this.ensureFile(path, ts);
    }
    if (!this.tabs.includes(path)) this.tabs.push(path);
    this.activeFile = path;
  }

  private pushTerminalLine(
    kind: TerminalLineKind,
    text: string,
    ts: number,
    streamed: boolean,
  ): void {
    this.terminal.lines.push({
      id: this.terminal.nextId++,
      kind,
      text,
      timestamp: ts,
      streamed,
    });
    // Keep the terminal bounded; a runaway `tail -f` should not eat the heap.
    const MAX_LINES = 2000;
    if (this.terminal.lines.length > MAX_LINES) {
      this.terminal.lines.splice(0, this.terminal.lines.length - MAX_LINES);
    }
  }

  private buildTimelineEntry(
    event: SessionEvent,
    eventIndex: number,
  ): TimelineEntry | null {
    const base = {
      id: eventIndex,
      eventIndex,
      timestamp: event.timestamp,
      action: event.action,
    } as const;

    switch (event.action) {
      case 'session.start':
        return {
          ...base,
          kind: 'session',
          label: 'Session started',
          detail: event.agent,
        };
      case 'session.end':
        return { ...base, kind: 'session', label: 'Session finished' };
      case 'think':
        return {
          ...base,
          kind: 'think',
          label: 'Thinking',
          detail: event.thought,
        };
      case 'narrate':
        return {
          ...base,
          kind: 'narration',
          label: event.category === 'decision' ? 'Decision' : 'Note',
          detail: event.text,
        };
      case 'file.create':
        return { ...base, kind: 'file', label: 'Created', detail: event.file, file: event.file };
      case 'file.delete':
        return { ...base, kind: 'file', label: 'Deleted', detail: event.file, file: event.file };
      case 'file.rename':
        return {
          ...base,
          kind: 'file',
          label: 'Renamed',
          detail: `${event.file} → ${event.to}`,
          file: event.to,
        };
      case 'terminal':
      case 'terminal.command':
        return {
          ...base,
          kind: 'terminal',
          label: 'Command',
          detail: event.command ?? event.text,
        };
      case 'terminal.write':
        return { ...base, kind: 'terminal', label: 'Output', detail: event.text };
      case 'terminal.exit':
        return {
          ...base,
          kind: 'terminal',
          label: 'Exit',
          detail: `code ${event.exitCode}`,
        };
      case 'terminal.open':
        return { ...base, kind: 'terminal', label: 'Terminal opened' };
      case 'build.start':
        return { ...base, kind: 'build', label: 'Build started', detail: event.target };
      case 'build.success':
        return { ...base, kind: 'build', label: 'Build succeeded' };
      case 'build.failure':
        return {
          ...base,
          kind: 'build',
          label: 'Build failed',
          detail: event.errors?.join('\n'),
        };
      case 'test.start':
        return { ...base, kind: 'test', label: 'Tests started', detail: event.command };
      case 'test.result':
        return {
          ...base,
          kind: 'test',
          label: 'Tests finished',
          detail: `${event.passed} passed, ${event.failed} failed`,
        };
      case 'error':
        return {
          ...base,
          kind: 'error',
          label: 'Error',
          detail: event.message,
          file: event.file,
        };
      case 'fix':
        return { ...base, kind: 'fix', label: 'Fixed', detail: event.message, file: event.file };
      case 'dependency.add':
        return {
          ...base,
          kind: 'dependency',
          label: 'Added dependency',
          detail: `${event.name}${event.version ? `@${event.version}` : ''}`,
        };
      case 'dependency.remove':
        return { ...base, kind: 'dependency', label: 'Removed dependency', detail: event.name };
      case 'pause':
        return { ...base, kind: 'think', label: 'Paused' };
      default:
        return null;
    }
  }

  snapshot(): StateSnapshot {
    const files: FileSnapshot[] = [];
    for (const rec of this.files.values()) {
      files.push({
        path: rec.path,
        text: rec.buffer.toString(),
        language: rec.language,
        createdAt: rec.createdAt,
        lastModifiedAt: rec.lastModifiedAt,
        cursor: rec.cursor,
        selection: rec.selection,
        scrollTop: rec.scrollTop,
        revision: rec.revision,
      });
    }
    return {
      files,
      fileOrder: [...this.fileOrder],
      tabs: [...this.tabs],
      activeFile: this.activeFile,
      terminal: {
        open: this.terminal.open,
        lines: this.terminal.lines.map((l) => ({ ...l })),
        nextId: this.terminal.nextId,
        lastExitCode: this.terminal.lastExitCode,
      },
      narration: this.narration.map((n) => ({ ...n })),
      timeline: this.timeline.map((t) => ({ ...t })),
      dependencies: this.dependencies.map((d) => ({ ...d })),
      build: { ...this.build },
      errors: this.errors.map((e) => ({ ...e })),
      fixes: this.fixes.map((f) => ({ ...f })),
      meta: { ...this.meta },
      consumedEvents: this.consumedEvents,
      touchedFiles: [...this.touchedFiles],
      createdFiles: [...this.createdFiles],
    };
  }

  static restore(snapshot: StateSnapshot): SessionState {
    const state = new SessionState();
    for (const f of snapshot.files) {
      state.files.set(f.path, {
        path: f.path,
        buffer: PieceTable.fromString(f.text),
        language: f.language,
        createdAt: f.createdAt,
        lastModifiedAt: f.lastModifiedAt,
        cursor: f.cursor,
        selection: f.selection,
        scrollTop: f.scrollTop,
        revision: f.revision,
      });
    }
    state.fileOrder = [...snapshot.fileOrder];
    state.touchedFiles = [...snapshot.touchedFiles];
    state.createdFiles = [...(snapshot.createdFiles ?? [])];
    state.tabs = [...snapshot.tabs];
    state.activeFile = snapshot.activeFile;
    state.terminal = {
      open: snapshot.terminal.open,
      lines: snapshot.terminal.lines.map((l) => ({ ...l })),
      nextId: snapshot.terminal.nextId,
      lastExitCode: snapshot.terminal.lastExitCode,
    };
    state.narration = snapshot.narration.map((n) => ({ ...n }));
    state.timeline = snapshot.timeline.map((t) => ({ ...t }));
    state.dependencies = snapshot.dependencies.map((d) => ({ ...d }));
    state.build = { ...snapshot.build };
    state.errors = snapshot.errors.map((e) => ({ ...e }));
    state.fixes = snapshot.fixes.map((f) => ({ ...f }));
    state.meta = { ...snapshot.meta };
    state.consumedEvents = snapshot.consumedEvents;
    state.nextNarrationId = state.narration.length;
    state.nextErrorId = state.errors.length;
    state.nextFixId = state.fixes.length;
    return state;
  }
}
