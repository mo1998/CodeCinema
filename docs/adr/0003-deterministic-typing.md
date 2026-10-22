# ADR 0003 — Deterministic typing simulation

- **Status:** Accepted
- **Date:** 2026-10-22

## Context

The recorded event log says *what* the agent wrote, not *how fast*. A
`type` event carries a chunk of text; the player has to decide when each
character appears.

Two requirements pull against each other:

1. The typing must look human — variable speed, micro-pauses, a beat before a
   function body.
2. The replay must be reproducible — two viewers at the same millisecond must
   see the same pixels, and reloading the page must not reshuffle the
   animation.

A `Math.random()`-based simulation satisfies (1) and breaks (2). It also
breaks scrubbing: if the timing is random, the set of characters visible at
time *t* depends on the path taken to reach *t*, so "state at *t*" stops being
a pure function of the log — which would break the event-sourcing guarantee
from ADR 0001.

## Decision

Use a seeded pseudo-random generator.

The seed for a chunk is derived from stable facts about the event:

```
seed = hash(sessionSeed, filePath, eventIndex, offset)
```

The generator is mulberry32 — small, fast, and good enough for timing jitter.

The per-character delay is not uniform. It is:

```
base      = 1000 / cps                        # default 7.5 chars/second
delay     = base × (1 - jitter/2 + rand × jitter)
delay    += punctuationPause    after , ;
delay    += newlinePause        after a newline
delay    += indentPause         after a run of indentation
delay    += keywordPause        before a def/class/function block
```

The keyword pause is the detail that sells it. A human hesitates before
committing to a structure — the pause before `def` is longer than the pause
before a variable name. Detecting it is cheap: when a keyword starts a line,
add the pause to the first character of the keyword.

## Consequences

* Reproducibility is free: same log, same seed, same timings.
* Scrubbing is exact: the visible characters at time *t* are a pure function
  of *t*, not of the path to *t*.
* The simulation cannot be "wrong" in a way that matters — it is a
  presentation detail, and the underlying event log is untouched.
* If a chunk does not finish typing before the next event arrives, the
  engine compresses it to fit. That is not a compromise: a 40-character chunk
  produced in 150 ms was a paste, and it should look like one.
* The seed depends on the event index, so reordering events changes the
  animation. That is acceptable and arguably desirable — a different recording
  is a different session.
