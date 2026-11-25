---
id: HITLD-823
title: A handover does not leave approved merges with no orchestrator to apply them
kind: work
state: done
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
claimed_by: D-01M87Y66HJQPG4HX
release_note: "`hitld handover` names every pull request the owner approved or was shown that still waits to merge (`merges_pending`, the note's first line, and `branches` on the lease-released ledger event). Until a successor takes the lease, and for at most `run.lease_expiry_seconds` (default 1800) after the release, the session that handed over may still run `hitld merge` limited to those branches (a full merge pass for them, which also records branches sent back and trust events); any other branch, and `--all` beyond them, is refused or narrowed. `hitld run resume` shows them first (`merges_pending`, `first`). `hitld merge` from a session that does not hold the lease is refused before any pull request merges. With `merge.via` pull-request, the lease is checked again just before the pass writes its results, and a pass whose lease was taken while it ran writes no queue state and records no merge, and says what it merged but could not record (`merged_unrecorded` in its result, and a line appended to the hand-over note); this narrows the race but does not close it, since the store has no compare-and-swap. The local queue has no such second check."
---

## Why

Orch-6 handed over at its eighth completion (the owner's rule, HITLD-794) while four approved pull requests were still waiting. After a handover the old orchestrator can record nothing, so `hitld merge` could not be run until the same session resumed the lease on the owner's say, outside the rule. Nothing warned that merges were pending.

## Done when

- `hitld handover` names every approved or presented pull request still waiting and either refuses until a merge pass has run or writes them into the handover note's first lines; a successor's `run resume` shows them first.
- Merge-only passes (no starts) are allowed to the handing-over session for the pull requests named at handover.
- Tests cover a handover with approved merges pending, with none, and a merge-only pass after it. A skill and run change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Filed on 2026-11-22 from the owner's request to propose tickets for the session's mistakes and friction.

As built: the hand-over writes the pending merges into the note's first line rather than refusing. "Merge-only" means the pass is limited to the branches the hand-over named (in pull-request mode the queue sees only those; locally it only applies the owner's recorded approval, and `--all` is narrowed to the named branches); for those branches it is a full pass, which also records branches sent back, trust events and torn-down worktrees. The window closes when a successor takes the lease or `run.lease_expiry_seconds` (default 1800) after the release, whichever comes first; a pass that started inside the window may record what it did after the window closes. In pull-request mode the lease is checked again just before the pass writes its results; that narrows the race with a successor but does not close it (the store has no compare-and-swap, so a later record can still be refused partway). The local queue has no second check.
