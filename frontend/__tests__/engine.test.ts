import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionState } from '@/lib/engine/state';
import { PlaybackEngine } from '@/lib/engine/engine';
import type { SessionEvent } from '@/lib/engine/events';

const FIXTURE_PATH = join(
  process.cwd(),
  '..',
  'shared',
  'fixtures',
  'sample-session.json',
);

function loadFixture(): SessionEvent[] {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as SessionEvent[];
}

describe('SessionState reducer', () => {
  it('folds the shared fixture into the expected state', () => {
    const state = new SessionState();
    const events = loadFixture();
    events.forEach((event, index) => state.apply(event, index));

    const file = state.files.get('src/health.py');
    expect(file).toBeDefined();
    // The `replace` event overwrites the first 12 characters.
    expect(file!.buffer.toString()).toBe(
      'def health() -> dict[str, str]:\n    return {"status": "ok"}\n',
    );

    expect(state.tabs).toContain('src/health.py');
    expect(state.activeFile).toBe('src/health.py');
    expect(state.createdFiles).toEqual(['src/health.py']);

    expect(state.terminal.lines.map((line) => line.text)).toEqual([
      'pytest -q',
      '1 failed, 4 passed',
      'Process exited with code 1',
      'pytest -q',
      '5 passed',
      'Process exited with code 0',
    ]);

    expect(state.errors).toHaveLength(1);
    expect(state.errors[0].resolved).toBe(true);
    expect(state.fixes).toHaveLength(1);

    expect(state.build.status).toBe('success');
    expect(state.narration).toHaveLength(1);
    expect(state.narration[0].text).toContain('health endpoint');
  });

  it('is a pure fold — the same events always give the same state', () => {
    const events = loadFixture();
    const first = new SessionState();
    const second = new SessionState();
    events.forEach((event, index) => first.apply(event, index));
    // Feed the events in a different order of application but the same order.
    events.forEach((event, index) => second.apply(event, index));
    expect(second.snapshot()).toEqual(first.snapshot());
  });

  it('survives a snapshot/restore round trip', () => {
    const state = new SessionState();
    const events = loadFixture();
    events.forEach((event, index) => state.apply(event, index));
    const restored = SessionState.restore(state.snapshot());
    expect(restored.snapshot()).toEqual(state.snapshot());
  });
});

describe('PlaybackEngine', () => {
  it('starts at t=0 with nothing applied', () => {
    const engine = new PlaybackEngine();
    engine.setEvents(loadFixture());
    expect(engine.getTime()).toBe(0);
    expect(engine.getState().consumedEvents).toBe(0);
    expect(engine.getDuration()).toBe(7600);
  });

  it('seeks forward and applies events', () => {
    const engine = new PlaybackEngine();
    engine.setEvents(loadFixture());
    engine.seek(5000);
    expect(engine.getState().consumedEvents).toBeGreaterThan(5);
    expect(engine.getState().activeFile).toBe('src/health.py');
  });

  it('seeks backward and rolls the state back', () => {
    const engine = new PlaybackEngine();
    engine.setEvents(loadFixture());
    engine.seek(5000);
    const after = engine.getState();
    engine.seek(1000);
    const before = engine.getState();
    expect(before.consumedEvents).toBeLessThan(after.consumedEvents);
    // The file is created at t=900, so before that it must not exist.
    engine.seek(500);
    expect(engine.getState().fileOrder).not.toContain('src/health.py');
  });

  it('reaches the same state whether it plays forward or seeks', () => {
    const events = loadFixture();
    const forward = new PlaybackEngine();
    forward.setEvents(events);
    forward.seek(forward.getDuration());

    const seeking = new PlaybackEngine();
    seeking.setEvents(events);
    for (const target of [5000, 1200, 7300, 200, 7600]) {
      seeking.seek(target);
    }

    expect(seeking.getState().consumedEvents).toBe(forward.getState().consumedEvents);
    expect(seeking.getState().fileOrder).toEqual(forward.getState().fileOrder);
    expect(seeking.getState().timeline.length).toBe(
      forward.getState().timeline.length,
    );
  });

  it('produces an overview of the whole session', () => {
    const engine = new PlaybackEngine();
    engine.setEvents(loadFixture());
    const overview = engine.getOverview();
    expect(overview.timeline.length).toBeGreaterThan(0);
    expect(overview.modules.map((m) => m.path)).toContain('src/health.py');
    expect(overview.createdFiles).toEqual(['src/health.py']);
  });

  it('steps between significant events', () => {
    const engine = new PlaybackEngine();
    engine.setEvents(loadFixture());
    engine.seek(0);
    engine.stepForward();
    const first = engine.getTime();
    expect(first).toBeGreaterThan(0);
    engine.stepForward();
    expect(engine.getTime()).toBeGreaterThan(first);
    engine.stepBackward();
    expect(engine.getTime()).toBe(first);
  });

  it('honours the speed multiplier', () => {
    const engine = new PlaybackEngine();
    engine.setSpeed(10);
    expect(engine.getSpeed()).toBe(10);
    engine.setSpeed(1000);
    expect(engine.getSpeed()).toBe(64);
  });

  it('reveals typed characters progressively rather than all at once', () => {
    const engine = new PlaybackEngine();
    engine.setEvents(loadFixture());
    engine.seek(1100);
    const atStart = engine.getDisplay().document?.text ?? '';
    engine.seek(1600);
    const later = engine.getDisplay().document?.text ?? '';
    expect(later.length).toBeGreaterThan(atStart.length);
  });

  it('publishes structural state while the clock is running', async () => {
    const engine = new PlaybackEngine();
    engine.setEvents(loadFixture());

    const consumed: number[] = [];
    engine.subscribe((state) => consumed.push(state.consumedEvents));

    engine.play();
    await new Promise((resolve) => setTimeout(resolve, 250));
    engine.pause();

    // Regression: the structural channel used to stay frozen at its initial
    // snapshot during playback, so the project explorer and the tab bar
    // stayed empty for the whole session.
    expect(consumed.length).toBeGreaterThan(0);
    expect(Math.max(...consumed)).toBeGreaterThan(0);
    expect(engine.getState().consumedEvents).toBeGreaterThan(0);
  });

  it('ends the session when it reaches the end', () => {
    const engine = new PlaybackEngine();
    engine.setEvents(loadFixture());
    engine.seek(engine.getDuration());
    expect(engine.getStatus()).toBe('ended');
  });
});
