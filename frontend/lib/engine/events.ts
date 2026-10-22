/**
 * CodeCinema canonical event model.
 *
 * This file is the TypeScript projection of `shared/schemas/event.schema.json`.
 * The Python projection lives in `backend/app/adapters/base.py`. Both are validated
 * against shared fixtures so the two can never drift.
 *
 * Design rules for every action:
 *  - `timestamp` is milliseconds since `session.start` (t = 0), monotonic non-decreasing.
 *  - Events are the *only* source of truth. Playback state is a pure fold over them.
 *  - Unknown extra properties are preserved (they may carry adapter-specific detail).
 */

export const EVENT_ACTIONS = [
  'session.start',
  'session.end',
  'think',
  'narrate',
  'file.create',
  'file.delete',
  'file.rename',
  'type',
  'insert',
  'delete',
  'replace',
  'cursor',
  'select',
  'scroll',
  'focus',
  'close',
  'pause',
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
] as const;

export type EventAction = (typeof EVENT_ACTIONS)[number];

export type Actor = 'agent' | 'human' | 'system' | 'tool';

export type NarrationCategory =
  | 'explanation'
  | 'decision'
  | 'warning'
  | 'summary'
  | 'todo';

export type DependencyManager =
  | 'npm'
  | 'pnpm'
  | 'yarn'
  | 'pip'
  | 'poetry'
  | 'cargo'
  | 'go'
  | 'maven'
  | 'gradle'
  | 'gem'
  | 'composer';

export interface TypingProfile {
  /** Base characters per second. Default 7.5 (roughly a human typist). */
  cps?: number;
  /** Per-character timing variance in [0,1]. Default 0.35. */
  jitter?: number;
  /** Extra pause after punctuation. Default 90ms. */
  punctuationPauseMs?: number;
  /** Extra pause after a newline. Default 160ms. */
  newlinePauseMs?: number;
  /** Extra pause after a run of indentation. Default 120ms. */
  indentPauseMs?: number;
  /** Extra pause before a def/class/function block. Default 320ms. */
  keywordPauseMs?: number;
}

export interface BaseEvent<A extends EventAction = EventAction> {
  timestamp: number;
  action: A;
  /** Server-assigned monotonic sequence number. */
  seq?: number;
  actor?: Actor;
  /** Idempotency key for re-ingestion safety. */
  id?: string;
}

/**
 * Action-specific payload map. `BaseEvent` intersected with the matching entry
 * produces the fully typed variant.
 */
export interface EventPayloadMap {
  'session.start': {
    title?: string;
    agent?: string;
    prompt?: string;
    repo?: string;
    model?: string;
  };
  'session.end': { durationMs?: number; summary?: string };
  think: { duration?: number; thought?: string };
  narrate: { text: string; category?: NarrationCategory; file?: string };
  'file.create': { file: string; language?: string };
  'file.delete': { file: string };
  'file.rename': { file: string; to: string };
  /** Progressive reveal of `content`. Offset defaults to end-of-file. */
  type: { file: string; content: string; offset?: number; profile?: TypingProfile };
  /** Atomic insertion of `content` at `offset`. */
  insert: { file: string; content: string; offset: number };
  /** Removal of `count` characters. */
  delete: { file: string; count: number; offset?: number };
  /** Atomic replacement of `count` characters with `content`. */
  replace: { file: string; count: number; content: string; offset: number };
  cursor: { file: string; offset: number };
  select: { file: string; offset: number; length: number };
  scroll: { file: string; top: number };
  focus: { file: string };
  close: { file: string };
  pause: { duration?: number };
  /** Catch-all terminal event: carries `command`, `text` and/or `exitCode`. */
  terminal: { command?: string; text?: string; exitCode?: number };
  'terminal.open': Record<string, never> extends never ? never : { [key: string]: unknown };
  'terminal.command': { command: string; text?: string };
  'terminal.write': { text: string; kind?: 'output' | 'error' };
  'terminal.exit': { exitCode: number };
  'build.start': { target?: string };
  'build.success': { durationMs?: number };
  'build.failure': { errors?: string[]; durationMs?: number };
  'test.start': { command?: string };
  'test.result': { passed: number; failed: number; durationMs?: number };
  error: { message: string; file?: string; line?: number; column?: number };
  fix: { message: string; file?: string };
  'dependency.add': { name: string; version?: string; manager?: DependencyManager };
  'dependency.remove': { name: string; manager?: DependencyManager };
}

/**
 * The canonical event union.
 *
 * Each member pins its `action` to a literal so that TypeScript can narrow a
 * `SessionEvent` with `event.action === 'delete'`. The extra index signature
 * keeps adapter-specific fields addressable without weakening the narrowing.
 */
export type SessionEvent = {
  [K in EventAction]: BaseEvent<K> &
    EventPayloadMap[K] & {
      [key: string]: unknown;
    };
}[EventAction];

/** An event whose action is not known ahead of time (e.g. straight from JSON). */
export interface RawEvent {
  timestamp: number;
  action: string;
  [key: string]: unknown;
}

/** Narrow a generic event to a specific action variant. */
export function isAction<K extends EventAction>(
  event: BaseEvent | RawEvent,
  action: K,
): event is BaseEvent<K> & EventPayloadMap[K] {
  return event.action === action;
}

export const NARration_CATEGORIES: NarrationCategory[] = [
  'explanation',
  'decision',
  'warning',
  'summary',
  'todo',
];
