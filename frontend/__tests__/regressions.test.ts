import { describe, expect, it } from 'vitest';
import { PlaybackEngine } from '@/lib/engine/engine';
import { SessionState } from '@/lib/engine/state';
import type { SessionEvent } from '@/lib/engine/events';

/**
 * Regression tests.
 *
 * Every case here is a bug that shipped at least once. They are cheap to
 * write and expensive to rediscover.
 */

describe('regression: mask offsets are clamped like the reducer', () => {
  it('does not duplicate characters when the offset is past the end of file', () => {
    const engine = new PlaybackEngine();
    engine.setEvents([
      { timestamp: 0, action: 'file.create', file: 'a.ts' },
      { timestamp: 100, action: 'type', file: 'a.ts', content: 'abc' },
      {
        timestamp: 5000,
        action: 'type',
        file: 'a.ts',
        content: 'XYZ',
        offset: 100, // past the end of the file
      },
      { timestamp: 20000, action: 'session.end' },
    ]);

    engine.seek(5100);
    const text = engine.getDisplay().document?.text ?? '';
    // The chunk must not be revealed twice.
    expect(text).not.toContain('XYZXYZ');
    expect(text.replace(/X/g, '').replace(/Y/g, '').replace(/Z/g, '')).toBe('abc');
  });

  it('does not leave phantom characters when a delete runs past the end', () => {
    const engine = new PlaybackEngine();
    engine.setEvents([
      { timestamp: 0, action: 'file.create', file: 'b.ts' },
      { timestamp: 100, action: 'type', file: 'b.ts', content: 'abc' },
      {
        timestamp: 5000,
        action: 'delete',
        file: 'b.ts',
        count: 10, // more than the file holds
        offset: 0,
      },
      { timestamp: 20000, action: 'session.end' },
    ]);

    engine.seek(8000);
    expect(engine.getDisplay().document?.text).toBe('');
  });
});

describe('regression: a chunk finishes typing before the next event', () => {
  it('reveals every character by the time the next event lands', () => {
    const engine = new PlaybackEngine();
    engine.setEvents([
      { timestamp: 0, action: 'file.create', file: 'c.ts' },
      {
        timestamp: 1000,
        action: 'type',
        file: 'c.ts',
        content: 'x'.repeat(400),
      },
      { timestamp: 1200, action: 'type', file: 'c.ts', content: 'done' },
      { timestamp: 20000, action: 'session.end' },
    ]);

    // At the moment the second chunk starts, the first must be complete —
    // and the second must not have been revealed yet.
    engine.seek(1200);
    const text = engine.getDisplay().document?.text ?? '';
    expect(text).toBe('x'.repeat(400));
  });
});

describe('regression: state converges no matter how you get there', () => {
  const events: SessionEvent[] = [
    { timestamp: 0, action: 'session.start', title: 't' },
    { timestamp: 500, action: 'think', duration: 900, thought: 'hmm' },
    { timestamp: 1000, action: 'file.create', file: 'd.ts' },
    { timestamp: 1200, action: 'type', file: 'd.ts', content: 'hello\n' },
    { timestamp: 2000, action: 'focus', file: 'd.ts' },
    { timestamp: 3000, action: 'session.end' },
  ];

  it('clears the thinking indicator when rewinding before the think event', () => {
    const engine = new PlaybackEngine();
    engine.setEvents(events);

    engine.seek(1000);
    expect(engine.getDisplay().thinking).toBe(true);

    engine.seek(100);
    expect(engine.getDisplay().thinking).toBe(false);
  });

  it('produces the same file content whether played forward or seeked', () => {
    const forward = new PlaybackEngine();
    forward.setEvents(events);
    forward.seek(forward.getDuration());
    const expected = forward.getDisplay().document?.text;

    const seeking = new PlaybackEngine();
    seeking.setEvents(events);
    for (const target of [3000, 100, 2500, 0, 1200, 3000]) {
      seeking.seek(target);
    }
    expect(seeking.getDisplay().document?.text).toBe(expected);
  });
});

describe('regression: checkpoint memory is bounded', () => {
  it('keeps the retained checkpoint bytes under the budget', () => {
    const engine = new PlaybackEngine();
    // A session with a large file, edited many times.
    const big: SessionEvent[] = [
      { timestamp: 0, action: 'file.create', file: 'big.ts' },
      {
        timestamp: 10,
        action: 'type',
        file: 'big.ts',
        content: 'x'.repeat(200_000),
      },
    ];
    for (let i = 1; i <= 3000; i++) {
      big.push({
        timestamp: 100 + i * 10,
        action: 'type',
        file: 'big.ts',
        content: 'y',
      });
    }
    engine.setEvents(big);

    // Force the engine through the whole session so checkpoints accumulate.
    engine.seek(engine.getDuration());

    const checkpoints = (engine as unknown as { checkpoints: unknown[] }).checkpoints;
    const bytes = (
      engine as unknown as { checkpointBytes: number }
    ).checkpointBytes;
    expect(checkpoints.length).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(64 * 1024 * 1024);
  });
});

describe('regression: a session swap cannot mix two sessions', () => {
  it('does not leak the previous session into the new one', async () => {
    const engine = new PlaybackEngine();
    const sessionA: SessionEvent[] = [
      { timestamp: 0, action: 'session.start', title: 'A' },
      { timestamp: 100, action: 'file.create', file: 'a.ts' },
    ];
    const sessionB: SessionEvent[] = [
      { timestamp: 0, action: 'session.start', title: 'B' },
      { timestamp: 100, action: 'file.create', file: 'b.ts' },
    ];

    engine.setEvents(sessionA);
    engine.primeCheckpoints();
    // Swap the session while the background fold is still running.
    engine.setEvents(sessionB);
    engine.primeCheckpoints();

    await new Promise((resolve) => setTimeout(resolve, 50));

    const overview = engine.getOverview();
    expect(overview.modules.map((m) => m.path)).toEqual(['b.ts']);

    engine.seek(engine.getDuration());
    expect(engine.getState().fileOrder).toEqual(['b.ts']);
  });
});

describe('regression: the reducer never loses file content', () => {
  it('keeps the contents when a file is re-created', () => {
    const state = new SessionState();
    state.apply(
      { timestamp: 0, action: 'file.create', file: 'x.ts' },
      0,
    );
    state.apply(
      { timestamp: 100, action: 'type', file: 'x.ts', content: 'keep me' },
      1,
    );
    state.apply(
      { timestamp: 200, action: 'file.create', file: 'x.ts' },
      2,
    );
    expect(state.files.get('x.ts')?.buffer.toString()).toBe('keep me');
  });

  it('does not duplicate tabs when a file is renamed onto an open file', () => {
    const state = new SessionState();
    state.apply({ timestamp: 0, action: 'file.create', file: 'a.ts' }, 0);
    state.apply({ timestamp: 100, action: 'file.create', file: 'b.ts' }, 1);
    state.apply({ timestamp: 200, action: 'focus', file: 'a.ts' }, 2);
    state.apply({ timestamp: 300, action: 'focus', file: 'b.ts' }, 3);
    state.apply({ timestamp: 400, action: 'file.rename', file: 'a.ts', to: 'b.ts' }, 4);
    expect(new Set(state.tabs).size).toBe(state.tabs.length);
  });
});
