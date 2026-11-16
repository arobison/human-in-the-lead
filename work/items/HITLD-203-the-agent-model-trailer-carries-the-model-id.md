---
id: HITLD-203
title: The Agent-Model trailer carries the model ID, not the family name
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

Executor commits carry an `Agent-Model:` trailer. In the first self-hosted run the trailer held the model family name (`opus`), because the sessions' own rules forbid model identifiers in commit messages. The owner decided in the chief of staff session (2026-11-16) that the trailer should carry the model ID, for exact attribution.

## Done when

- The brief template and the executor contract say that `Agent-Model:` holds the model ID the session reports for itself, and `Agent-Effort:` holds the effort level.
- The rule that forbids model IDs in commits is changed where it lives for these sessions (the harness's session instructions, outside this repository), or the item records that it cannot be and the family name stays. Until then executors keep the family name, and the trailer check accepts either.
- The trailer check in `core/lib/dco/check.mjs` or the report check accepts a model ID and flags an empty value.
- A test covers a commit with an ID and one with a family name.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Decided by the owner; raised by the chief of staff after the HITLD-135 digest asked the question. The conflict with the session rule is the first thing to settle, and it is not settled by this repository alone.
