---
id: HITLD-142
title: A cloud orchestrator session can reach the private store, or says exactly why not
kind: work
state: done
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-67 c1, HITLD-190 c1]
claimed_by: D-8
release_note: "A cloud orchestrator session can reach the private store, or says exactly what is missing."
---

## Why

A chief of staff session started with the project repository and the store repository both attached. The orchestrator it started with `create_session` got only the project repository. Its store status read `remote-unreachable` (no credentials for the host) and its device as not enrolled, although the same environment's device was enrolled. The orchestrator's `add_repo` for the store repository was denied by the session's permission classifier. Its ledger, trust record and decisions stayed in a container that is discarded when the session ends.

HITLD-123 (done) takes tracker IDs from a source every session shares. That guarantee needs the store reachable, so this item is the precondition for it in a cloud orchestrator.

## Done when

- The chief-of-staff skill starts an orchestrator with every repository the run needs, the store repository included. Where the harness can attach only one at start, the skill says what to do, and names who must attach the other.
- `hitld run start` in a session whose store remote is unreachable says which cause applies (repository not attached, no credentials, device not enrolled or not yet pulled) and what fixes it, instead of `remote-unreachable` alone.
- The first-run setup in the orchestrate and chief-of-staff skills makes `hitld store status` a check. The run does not go past setup until the store syncs, or the owner says in their own message to go on without it.
- A refused `add_repo` is reported to the chief of staff with the repository named by its role, never by name.
- Tests cover each named cause. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Raised by the owner in the chief of staff session, who asked why spawned sessions do not take both repositories. Check what `create_session` can attach before choosing the fix. HITLD-109 needs this.
