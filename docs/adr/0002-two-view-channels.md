# ADR 0002 — Two view channels instead of one

- **Status:** Accepted
- **Date:** 2026-10-22

## Context

The player animates at 60fps. During a typing animation the visible text
changes on every frame — up to 60 times a second.

The obvious design is a single store: the engine holds state, React subscribes,
every change re-renders. Measured against the actual UI, that is the wrong
shape. The React tree around the editor contains the project explorer (a tree
of every file), the event timeline (potentially tens of thousands of rows),
the architecture graph, the progress panel and the terminal. Re-rendering all
of that 60 times a second to update one Monaco buffer is not merely wasteful
— it drops frames on a mid-range laptop.

## Decision

Split the engine's output into two channels with different cadences.

**Structural channel.** Files, tabs, active file, timeline, narration, build
status, dependencies, progress counters. Changes once per applied event —
tens or hundreds of times over a whole session, not per frame.

**Display channel.** The text currently visible in the editor, the terminal
lines, the cursor position, the "thinking" indicator. Changes up to 60 times
per second.

React binds to the structural channel through `useSyncExternalStore` with a
memoised selector. The two components that need per-frame updates — Monaco
and the terminal — subscribe to the display channel *imperatively* and mutate
the DOM/editor directly, with no React render in the loop.

```
engine ──▶ structural ──▶ React (useSyncExternalStore)
       └─▶ display    ──▶ Monaco (model.applyEdits)
                     └─▶ Terminal (React, but memoised: the array reference
                                      only changes when the text changes)
```

## Consequences

* The editor animates smoothly regardless of how large the rest of the UI is.
* The terminal does not re-render per frame either: the engine caches the
  terminal line array and returns the *same reference* when the text has not
  changed, so React's `useSyncExternalStore` sees no change.
* Two channels mean two places to keep in sync. The engine owns both and
  derives them from the same reducer state, so they cannot diverge.
* Slightly more API surface: `subscribe`/`getState` and
  `subscribeDisplay`/`getDisplay`.
* A component that needs per-frame data must opt in explicitly. That is the
  point — it makes the cost of a frame visible at the call site.
