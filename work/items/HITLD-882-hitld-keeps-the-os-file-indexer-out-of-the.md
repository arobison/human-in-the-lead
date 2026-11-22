---
id: HITLD-882
title: "env status names the top processes when the quiet-machine gate holds a job, and the guide says how to keep the indexer out of worktrees"
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
---

## Why

Reported as GitHub issue 548 (https://github.com/arobison/human-in-the-lead/issues/548). The first diagnosis (Spotlight indexing the worktrees) was corrected in the issue's comment: the folders were already excluded, the file indexer was idle, and the sustained load was the run's own work (several executors and gate chains overlapping). What stands: when the quiet-machine gate holds a job, `hitld` shows only a load number, so the cause cannot be seen.

## Done when

- `env status` names the top processes by CPU when the load gate holds a quiet job, so that 'not quiet' points at the cause (for a run, its own executors and gate chains).
- The setup guide says how a macOS user keeps the indexer out of worktrees and large build or store folders (Spotlight's Privacy list), and that indexing settles once folders stop changing. A marker or setting hitld writes itself is out of scope unless a mechanism macOS honors without a privilege is found.
- A test for the status listing. `hitld work check` passes.

## Notes

Re-scoped from the issue's first request (opt the folders out of indexing) after its own correction. Joins Consumer live (HITLD-67) clause c2 on the owner's word of 2026-11-22 (decision HITLD-878); small, and could go to rc.3 if rc.2 needs room.
