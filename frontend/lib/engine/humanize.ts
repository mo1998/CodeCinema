/**
 * Human-like timing simulation.
 *
 * Recorded events carry *semantic* intent ("these 42 characters were typed at
 * this point in the session"). The playback engine turns that intent into
 * believable wall-clock motion: variable per-character speed, micro-pauses on
 * punctuation, a beat before a function or class body, and a longer settle
 * after a newline.
 *
 * Everything here is deterministic: a seeded PRNG means the same session
 * replays identically for every viewer and after every reload. Non-determinism
 * would make "jump to the same timestamp" show different content twice.
 */

import type { TypingProfile } from './events';

export const DEFAULT_PROFILE: Required<TypingProfile> = {
  cps: 7.5,
  jitter: 0.35,
  punctuationPauseMs: 90,
  newlinePauseMs: 160,
  indentPauseMs: 120,
  keywordPauseMs: 320,
};

/**
 * Keywords that introduce a *block*.
 *
 * These are the places a human hesitates before committing to a structure.
 * Ordinary statements (`const`, `let`, `import`) are excluded on purpose:
 * pausing 320ms before every `const` would make ordinary code look broken.
 */
const KEYWORDS = [
  'def ',
  'class ',
  'function ',
  'async function ',
  'interface ',
  'type ',
  'struct ',
  'impl ',
  'fn ',
  'pub fn ',
  'enum ',
  'trait ',
  'impl ',
];

const BLOCK_OPENERS = new Set(['{', '(', '[']);

/** Small, fast, seedable PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 32-bit string hash, used to derive per-chunk seeds. */
export function hashString(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface HumanizeResult {
  /** Delay in ms *before* revealing each character. Length === text.length. */
  delays: number[];
  /** Sum of all delays. */
  totalMs: number;
}

/**
 * Compute per-character delays for a chunk of text.
 *
 * @param text     the chunk being typed
 * @param profile  typing profile hints (partial profiles are merged with defaults)
 * @param seed     deterministic seed; usually derived from the chunk content
 */
export function humanizeChunk(
  text: string,
  profile?: TypingProfile,
  seed: number = hashString(text),
): HumanizeResult {
  const p = { ...DEFAULT_PROFILE, ...(profile ?? {}) };
  const rng = mulberry32(seed);
  const delays: number[] = new Array(text.length);
  if (text.length === 0) return { delays, totalMs: 0 };

  const base = 1000 / p.cps;
  // Jitter range multiplier: base * (1 - jitter/2 .. 1 + jitter)
  const lo = 1 - p.jitter / 2;
  const hi = 1 + p.jitter;

  // Pre-compute keyword pause positions: the index of the first character of a
  // block keyword that starts a line.
  //
  // The line state is tracked incrementally. Slicing the line prefix for every
  // character would be O(lineLength²) — a 200 KB single-line paste (a
  // minified bundle) would stall the main thread for seconds.
  const keywordPauses = new Map<number, number>();
  let lineStart = 0;
  let lineBlank = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') {
      lineStart = i + 1;
      lineBlank = true;
      continue;
    }
    if (ch === ' ' || ch === '\t') continue;
    if (lineBlank) {
      lineBlank = false;
      for (const kw of KEYWORDS) {
        if (text.startsWith(kw, i)) {
          keywordPauses.set(i, p.keywordPauseMs);
          break;
        }
      }
    }
  }
  void lineStart;

  let inIndent = false;
  let pendingIndent = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    let delay = base * (lo + rng() * (hi - lo));

    // Keyword pause (before the keyword itself).
    const kw = keywordPauses.get(i);
    if (kw !== undefined) delay += kw;

    // Indentation: accumulate a pause after a run of spaces/tabs.
    if (ch === ' ' || ch === '\t') {
      pendingIndent += ch === '\t' ? 2 : 1;
      inIndent = true;
    } else {
      if (inIndent && pendingIndent > 0) {
        delay += p.indentPauseMs * Math.min(4, pendingIndent) * 0.5;
      }
      inIndent = false;
      pendingIndent = 0;
    }

    // Punctuation / structural pauses triggered *after* the character.
    if (ch === ',' || ch === ';') {
      delay += p.punctuationPauseMs;
    } else if (ch === ':') {
      delay += p.punctuationPauseMs * 0.7;
    } else if (ch === '\n') {
      delay += p.newlinePauseMs;
    } else if (BLOCK_OPENERS.has(ch)) {
      delay += p.punctuationPauseMs * 1.4;
    } else if (ch === '.' && text[i + 1] === '.') {
      delay += p.punctuationPauseMs * 1.5;
    }

    delays[i] = Math.round(delay);
  }

  let totalMs = 0;
  for (const d of delays) totalMs += d;
  return { delays, totalMs };
}

/**
 * Compress or stretch a natural typing duration into the window that is
 * actually available before the next recorded event.
 *
 * - If the chunk fits comfortably, we keep human speed and the leftover time
 *   becomes an idle pause (which is what really happened: the agent paused).
 * - If the chunk does not fit, we compress it. A 40-character chunk that the
 *   agent produced in 150ms was a paste, not typing, and should look like one.
 */
export function fitDuration(naturalMs: number, windowMs: number): number {
  if (!Number.isFinite(windowMs)) return naturalMs;
  if (windowMs <= 0) return Math.min(naturalMs, 16);
  if (naturalMs <= windowMs) return naturalMs;
  return Math.max(16, windowMs);
}

/**
 * Uniform per-character delays, used for terminal output where punctuation
 * pauses would look wrong (a compiler dumping 400 lines should not stutter
 * after every semicolon).
 */
export function uniformDelays(
  text: string,
  cps: number,
  jitter: number,
  seed: number = hashString(text),
): number[] {
  const rng = mulberry32(seed);
  const base = 1000 / Math.max(1, cps);
  const lo = 1 - jitter / 2;
  const hi = 1 + jitter;
  const delays: number[] = new Array(text.length);
  for (let i = 0; i < text.length; i++) {
    delays[i] = Math.max(0, Math.round(base * (lo + rng() * (hi - lo))));
  }
  return delays;
}

/**
 * Scale a delay table so that it sums to `targetMs`.
 *
 * The playback engine uses this to fit a chunk's typing into the window the
 * recording actually left for it. Without it, a 400-character chunk recorded
 * in one second would animate for fifty-three seconds and would still be
 * mid-sentence when the next event arrived.
 *
 * Every delay stays at least 1ms so the reveal remains strictly monotonic.
 */
export function scaleDelays(delays: number[], targetMs: number): number[] {
  let total = 0;
  for (const delay of delays) total += delay;
  if (total <= 0 || targetMs <= 0) return delays.slice();

  const ratio = targetMs / total;
  const scaled = new Array<number>(delays.length);
  let accumulated = 0;
  for (let i = 0; i < delays.length; i++) {
    const value = Math.max(1, Math.round(delays[i] * ratio));
    scaled[i] = value;
    accumulated += value;
  }
  // Push any rounding drift onto the longest delay so the total matches.
  const drift = targetMs - accumulated;
  if (drift !== 0 && scaled.length > 0) {
    let longest = 0;
    for (let i = 1; i < scaled.length; i++) {
      if (scaled[i] > scaled[longest]) longest = i;
    }
    scaled[longest] = Math.max(1, scaled[longest] + drift);
  }
  return scaled;
}

/**
 * Streaming reveal curve for a chunk.
 *
 * Given the virtual clock, returns how many characters of the chunk are visible.
 * Uses the per-character delay table so that pauses land on the right
 * characters (the pause after a newline is visible as a real pause).
 */
export function revealedCountAt(
  delays: number[],
  elapsedMs: number,
): number {
  if (delays.length === 0) return 0;
  if (elapsedMs <= 0) return 0;
  let acc = 0;
  for (let i = 0; i < delays.length; i++) {
    acc += delays[i];
    if (elapsedMs < acc) return i;
  }
  return delays.length;
}
