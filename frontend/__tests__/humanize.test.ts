import { describe, expect, it } from 'vitest';
import {
  fitDuration,
  hashString,
  humanizeChunk,
  mulberry32,
  revealedCountAt,
  uniformDelays,
} from '@/lib/engine/humanize';

describe('humanizeChunk', () => {
  it('is deterministic for the same seed', () => {
    const a = humanizeChunk('def hello():', undefined, 42);
    const b = humanizeChunk('def hello():', undefined, 42);
    expect(a.delays).toEqual(b.delays);
  });

  it('produces different timings for different seeds', () => {
    const a = humanizeChunk('def hello():', undefined, 1);
    const b = humanizeChunk('def hello():', undefined, 2);
    expect(a.delays).not.toEqual(b.delays);
  });

  it('returns one delay per character', () => {
    const { delays } = humanizeChunk('const x = 1;');
    expect(delays.length).toBe('const x = 1;'.length);
    expect(delays.every((d) => d >= 0)).toBe(true);
  });

  it('pauses longer before a block keyword', () => {
    const withKeyword = humanizeChunk('\ndef compute(x):\n', undefined, 7);
    const withoutKeyword = humanizeChunk('\nvalue = x\n', undefined, 7);
    expect(withKeyword.totalMs).toBeGreaterThan(withoutKeyword.totalMs);
  });

  it('pauses longer after a newline than mid-line', () => {
    const { delays } = humanizeChunk('ab\ncd', undefined, 3);
    // delay[1] is the delay before 'b' (mid line), delay[3] before 'c' (after \n).
    expect(delays[3]).toBeGreaterThan(delays[1]);
  });

  it('handles empty input', () => {
    const result = humanizeChunk('');
    expect(result.delays).toEqual([]);
    expect(result.totalMs).toBe(0);
  });
});

describe('fitDuration', () => {
  it('keeps natural duration when there is room', () => {
    expect(fitDuration(1000, 5000)).toBe(1000);
  });

  it('compresses when the window is tight', () => {
    expect(fitDuration(1000, 250)).toBe(250);
  });

  it('never returns less than a frame', () => {
    expect(fitDuration(1000, 1)).toBeGreaterThanOrEqual(16);
  });

  it('handles an open-ended window', () => {
    expect(fitDuration(750, Infinity)).toBe(750);
  });
});

describe('revealedCountAt', () => {
  it('reveals nothing at t=0', () => {
    const { delays } = humanizeChunk('abc', { cps: 10, jitter: 0 }, 1);
    expect(revealedCountAt(delays, 0)).toBe(0);
  });

  it('reveals everything after the total duration', () => {
    const { delays, totalMs } = humanizeChunk('abc', { cps: 10, jitter: 0 }, 1);
    expect(revealedCountAt(delays, totalMs + 1000)).toBe(3);
  });

  it('is monotonic', () => {
    const { delays, totalMs } = humanizeChunk('abcdef', undefined, 11);
    let previous = -1;
    for (let t = 0; t <= totalMs + 100; t += 25) {
      const revealed = revealedCountAt(delays, t);
      expect(revealed).toBeGreaterThanOrEqual(previous);
      previous = revealed;
    }
  });
});

describe('uniformDelays', () => {
  it('returns one delay per character', () => {
    expect(uniformDelays('hello', 60, 0.2, 5).length).toBe(5);
  });
});

describe('prng', () => {
  it('mulberry32 is deterministic', () => {
    const a = mulberry32(9);
    const b = mulberry32(9);
    expect(a()).toBe(b());
  });

  it('hashString is stable', () => {
    expect(hashString('codecinema')).toBe(hashString('codecinema'));
    expect(hashString('codecinema')).not.toBe(hashString('codecinemz'));
  });
});
