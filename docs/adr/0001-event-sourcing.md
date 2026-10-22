# ADR 0001 — Event sourcing is the core abstraction

- **Status:** Accepted
- **Date:** 2026-10-22

## Context

CodeCinema's premise is replaying a coding-agent session as if a human were
doing the work. Two implementation strategies were considered.

**A. Render and capture.** Run the agent, record the screen, store a video.
This is what most "AI replay" tools do.

**B. Record the actions, reconstruct the playback.** Store an event log and
fold it into state at render time.

Strategy A has an appealing simplicity: a video file is a complete artifact
and playback is trivial. But it fails the product's own requirements:

* A viewer cannot scrub to the build failure.
* A viewer cannot search for the line the agent rewrote.
* A session recorded with one agent cannot be replayed through another's
  conventions.
* The artifact is opaque: you cannot tell whether the agent deleted a file or
  the screen was cropped.
* Rendering is lossy and expensive to re-do at a different speed.

## Decision

Adopt event sourcing. The session is an append-only log of canonical events.
The player is a deterministic fold over that log.

Everything else follows from this:

* **Seeking** is "restore the nearest checkpoint, replay forward" — not
  "scrub a video".
* **Sharing** points at a log, so a shared session is re-renderable, not a
  frozen artifact.
* **Different playback speeds** are free: the fold is time-parameterised.
* **The architecture view, the statistics and the file tree** are projections
  of the same log, so they cannot disagree with the replay.
* **Debugging** is tractable: if the replay looks wrong, the log says exactly
  what the agent did.

The cost is a more complex player (a virtual clock, checkpoints, a rope data
structure) and a server-side reducer that must mirror the browser's. We accept
that cost: the browser is where 60fps rendering happens, and the server-side
reducer exists only to answer `GET /sessions/{id}/state?at=…`.

## Consequences

* The event schema becomes the most important contract in the system. It is
  versioned, mirrored in TypeScript and Python, and validated in CI.
* Every new agent must produce canonical events. The generic recorder exists
  so that this is never a blocker.
* Storage grows monotonically with the number of events. This is acceptable:
  events are small, and the log is the only irreplaceable data.
* A replay is reproducible. Given the same log, every viewer sees the same
  frames — which is what makes the deterministic typing simulation possible
  (ADR 0003).
