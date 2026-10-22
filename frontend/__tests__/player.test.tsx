import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { PlaybackEngine } from '@/lib/engine/engine';
import { PlaybackProvider, useEngine, useEngineState } from '@/lib/engine/usePlayback';
import type { EngineState } from '@/lib/engine/engine';
import { createDemoSession } from '@/lib/demo/session';
import type { SessionEvent } from '@/lib/engine/events';

// Monaco needs a real browser; the player must work without it.
vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco-editor" />,
  loader: { config: () => undefined },
}));

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>(
    'framer-motion',
  );
  const react = await import('react');
  return {
    ...actual,
    motion: new Proxy(
      {},
      {
        get: () => (props: Record<string, unknown>) =>
          react.createElement('div', props),
      },
    ),
  };
});

const selectActiveFile = (state: EngineState) => state.activeFile;

function Harness() {
  const engine = useEngine();
  const activeFile = useEngineState(selectActiveFile);
  return (
    <div>
      <button onClick={() => engine.seek(60000)}>seek</button>
      <button onClick={() => engine.toggle()}>toggle</button>
      <span data-testid="active">{activeFile ?? 'none'}</span>
    </div>
  );
}

describe('PlaybackProvider', () => {
  let engine: PlaybackEngine;

  beforeEach(() => {
    engine = new PlaybackEngine({ seed: 'test' });
    engine.setEvents(createDemoSession() as SessionEvent[]);
  });

  it('exposes the engine to consumers', () => {
    render(
      <PlaybackProvider engine={engine}>
        <Harness />
      </PlaybackProvider>,
    );
    expect(screen.getByTestId('active').textContent).toBe('none');
  });

  it('updates consumers when the engine state changes', async () => {
    render(
      <PlaybackProvider engine={engine}>
        <Harness />
      </PlaybackProvider>,
    );

    await act(async () => {
      engine.seek(20000);
    });

    await waitFor(() => {
      expect(screen.getByTestId('active').textContent).not.toBe('none');
    });
  });

  it('notifies display subscribers on every frame', async () => {
    const seen: number[] = [];
    const unsubscribe = engine.subscribeDisplay((display) => seen.push(display.time));

    await act(async () => {
      engine.seek(1000);
    });

    expect(seen.length).toBeGreaterThan(0);
    unsubscribe();
  });
});
