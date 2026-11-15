---
id: HITLD-106
title: "Store sync in the run commands and hooks: start, resume, checkpoint, hand-over, merge"
kind: work
state: done
created: 2026-11-15
project: HITLD-15
claimed_by: D-106
needs: [HITLD-105]
release_note: "`hitld run start` and `run resume` pull the store, and checkpoints, hand-overs, merges and `run retire` push; SessionStart and SessionEnd hooks pull and push. A reachable remote that will not decrypt or merge refuses the start (`store-pull-refused`); `--no-sync` skips it. A lease another machine took and never released counts as held."
---

## Why

Design 0003 section 8: sync runs at fixed points in deterministic code, with harness hooks as a backstop, so no session has to remember it. The run lease is the lock.

## Done when

- `hitld run start` and `run resume` pull; checkpoints, `hitld handover` and merges push; a push failure is reported, never silently dropped.
- `hitld install` adds a session-start hook that pulls and a session-end hook that pushes.
- A run discarded after a checkpoint resumes in a new session with its ledger, trust record and open decisions intact (milestone c1).
- `npm run check`, the offline eval gate and `hitld work check` pass.
