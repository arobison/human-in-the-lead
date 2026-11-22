---
id: HITLD-738
title: Should an orchestrator wait for its executors before ending its turn, or should executors outlive it
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: B
answered_at: 2026-11-22T01:26:39.228Z
answered_via: question-tool
answered_by: owner
---

## Question

When an orchestrator runs in print mode, its background executors die when it ends its turn. Should the orchestrate skill make the orchestrator wait for every executor in flight before it ends its turn, or should the adapter start executors as separate processes that outlive the orchestrator?

## Options and recommendation

Reported as GitHub issue 455: the orchestrator's turn ended, its executors were killed, uncommitted work stayed in the worktrees and the lease stayed held. The watchdog noticed only after its stall threshold, over an hour later (HITLD-737 makes it notice at once).

- A. The skill waits. The orchestrate skill tells a print-mode orchestrator not to end its turn while any executor it started is in flight, and `hitld dispatch` (or the handover command) refuses or warns when a turn would end with executors running. Cheap and needs no new process handling. The cost: the orchestrator's session stays open, and so spends tokens and holds its lease, for as long as the slowest executor runs, and a rule in skill text is one an agent can forget (HITLD-537).
- B. The adapter starts executors as separate processes. The Claude Code adapter starts each print-mode executor detached from the orchestrator, so it survives the orchestrator's turn and reports through the ledger and its branch. The orchestrator can end its turn at once. The cost: a new process lifecycle in the adapter (detaching, output capture, cleanup, a quota pause that must still reach it) and more code to review as security-sensitive, and an executor that nothing waits for must be found by the watchdog and the next session.
- C. Both. A is the rule now; B is built next, and the rule is dropped when it lands.

Recommended: A now, then B. The skill rule closes the loss at once at the cost of a longer-lived orchestrator, and HITLD-737 catches a turn that ends anyway. The detached executor is the right end state, but it is a larger build that should be designed on its own. Choose B directly if the owner would rather not pay for a waiting orchestrator.

## Answer

Open.

## Notes

Related: HITLD-737 (the watchdog marks an executor stalled when its orchestrator exits), HITLD-147 (every executor reports before its turn ends), HITLD-240 (a blocking stop hook).
