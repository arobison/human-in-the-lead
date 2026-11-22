---
id: HITLD-737
title: The watchdog marks an executor stalled when its orchestrator process exits, and names the claims that hold uncommitted work
kind: work
state: done
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
claimed_by: D-01M80EPF8HN3E4YB
release_note: `hitld dispatch watch` marks a background executor stalled as soon as the orchestrator process that started it has exited, without waiting for its stall time, and lists under `uncommitted` each claim whose worktree holds uncommitted work so it can be recovered.
---

## Why

Reported as GitHub issue 455. In print mode an orchestrator's turn ends when it prints its last message, and its background executors die with it. Their uncommitted work stays in the worktrees, the lease stays held, and the watchdog notices only when the executor's stall threshold passes, which is over an hour. Until then nothing says that the work is lost or where it sits. The watchdog already treats an exited headless process as a stall (core/lib/dispatch/watch.mjs); it does not look at the executor's parent.

How the orchestrator avoids ending its turn early is a separate question for the owner (HITLD-738). Whatever the answer, the watchdog must not wait over an hour to learn that the process that started an executor is gone.

## Done when

- `hitld dispatch watch` marks an executor stalled as soon as the process that started it (its parent, the orchestrator) has exited and the executor has not reported, without waiting for the stall threshold.
- The watchdog's result names, for each such dispatch, the claims whose worktrees hold uncommitted work, so the orchestrator or the chief of staff can recover it before the worktree is removed.
- A dispatch whose parent is still running, and one that has reported, are not marked stalled by this rule.
- A test covers an executor whose parent has exited with uncommitted work, one whose parent is alive, and one that has reported. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Related: HITLD-92 (the watchdog), HITLD-147 (every executor reports up the chain), HITLD-710 (the watchdog and the claim it abandons), HITLD-738 (the decision on how executors survive the orchestrator's turn). Code: the owner's own yes to merge.
