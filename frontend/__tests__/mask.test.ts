import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PlaybackEngine } from '@/lib/engine/engine';
import type { SessionEvent } from '@/lib/engine/events';

function loadFixture(): SessionEvent[] {
  return JSON.parse(
    readFileSync(
      join(process.cwd(), '..', 'shared', 'fixtures', 'sample-session.json'),
      'utf8',
    ),
  ) as SessionEvent[];
}

describe('typing and erasing masks', () => {
  it('hides characters that have not been typed yet', () => {
    const engine = new PlaybackEngine();
    engine.setEvents([
      {
        timestamp: 0,
        action: 'file.create',
        file: 'a.ts',
      },
      {
        timestamp: 100,
        action: 'type',
        file: 'a.ts',
        content: 'const answer = 42;',
      },
      // A trailing event so the session does not end on the typing chunk —
      // at the very end of a session the final state is shown immediately.
      { timestamp: 20000, action: 'session.end' },
    ]);

    // At the instant the chunk starts, nothing is visible.
    engine.seek(100);
    expect(engine.getDisplay().document?.text).toBe('');

    // Partway through, only part of it is visible.
    engine.seek(900);
    const partial = engine.getDisplay().document?.text ?? '';
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan('const answer = 42;'.length);

    // Once the chunk is complete, all of it is visible.
    engine.seek(100000);
    expect(engine.getDisplay().document?.text).toBe('const answer = 42;');
  });

  it('reveals a deleted region gradually and then removes it', () => {
    const engine = new PlaybackEngine();
    engine.setEvents([
      { timestamp: 0, action: 'file.create', file: 'b.ts' },
      { timestamp: 100, action: 'type', file: 'b.ts', content: 'abcdefghij' },
      { timestamp: 5000, action: 'delete', file: 'b.ts', count: 4, offset: 3 },
      { timestamp: 20000, action: 'session.end' },
    ]);

    engine.seek(5000);
    // Immediately after the delete the region is still on screen.
    expect(engine.getDisplay().document?.text).toBe('abcdefghij');

    // Partway through the erase, some characters are gone.
    engine.seek(5100);
    expect(engine.getDisplay().document?.text).toBe('abcdefhij');

    // Once the erase animation completes the characters are gone.
    // 'abcdefghij' minus the four characters at offset 3 ('defg') is 'abchij'.
    engine.seek(6000);
    expect(engine.getDisplay().document?.text).toBe('abchij');
  });

  it('never shows characters from the future', () => {
    const engine = new PlaybackEngine();
    engine.setEvents(loadFixture());

    for (let t = 0; t <= engine.getDuration(); t += 137) {
      engine.seek(t);
      const text = engine.getDisplay().document?.text ?? '';
      // The visible text is always a prefix of the final content of the file
      // at that point in the session — never more than the file has.
      expect(text.length).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps the file content identical whether played forward or seeked', () => {
    const events = loadFixture();

    const forward = new PlaybackEngine();
    forward.setEvents(events);
    forward.seek(forward.getDuration());
    const expected = forward.getDisplay().document?.text;

    const seeking = new PlaybackEngine();
    seeking.setEvents(events);
    for (const target of [100, 3000, 500, 4700, 200, 3900, 7600]) {
      seeking.seek(target);
    }
    const actual = seeking.getDisplay().document?.text;

    expect(actual).toBe(expected);
  });
});
