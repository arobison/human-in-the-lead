---
id: HITLD-657
title: Where code review and code quality checks fit in the loop, and when they run
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
---

## Why

The owner asked on 2026-11-20 for the code quality work to be integrated into the overall design: when and where the proposed code reviews happen.

What the design says today. Part 4 has a Reviewer role: a background agent, a different model or framing from the author, giving one diverse review pass "where allocated", never blocking alone. Part 6.3 says the review-allocation controller sets a review probability per area and execution profile from past yield (confirmed findings per review token), with a floor. Part 6.2 asks for an independent security review of changes that touch the sensitive-path list. Part 6.6 lists when a human reads code. HITLD-518 decided that the gate for self-merging is mechanical only, with no model opinion in it. HITLD-215 lets a reviewer file items for findings unrelated to the task.

What is missing: no step in the loop is named where a review is scheduled, who schedules it, what it reads, what its findings do, how often it repeats, or how its cost and yield are recorded. "Code quality" beyond bugs (simplicity, reuse, consistency with the design, test quality) is not placed anywhere.

Evidence from 2026-11-20, when independent review was done by hand from the chief of staff's session: of the pull requests reviewed this way, every one with a non-trivial change needed fixes that green checks did not show, and several had a confirmed blocking defect (an owner-gate bypass found by the adversarial loop; a sandbox that did not hold; a settings write that could loosen the store; two ledger consumers that skipped events; a data leak into a generated file; a delete that broke ask-then-answer). Those reviews ran as ad hoc subagents, so their cost and findings are not in the ledger and no sensor sees them.

## Done when

- The owner has answered, one question at a time, the questions listed under Notes, and each answer is a recorded decision.
- The design says in one place which steps of the loop schedule a review, who schedules and runs it, what it is given, what its findings do (block, send back, file an item), when a second review is repeated, and how its cost and yield are recorded; part 4, 6, 2.6 and 11 point to it.
- A plan exists, as items, for building what the decisions call for (a reviewer dispatch, a ledger event for a review and its findings, the allocation controller's sensor), each item small enough for one executor.

## Notes

Questions to walk through with the owner (not asked yet; each becomes a decision when asked):

1. What "code quality" covers: correctness, security, maintainability and simplicity, test quality, agreement with the design, or a subset.
2. When a review runs: before the pull request opens, after it is green and before the owner is asked, as a step of the merge queue, after merge as a sample, or as a periodic sweep of an area (the out-of-band scrub idea).
3. Who runs it: a reviewer dispatched by the orchestrator as an item of its own (recorded in the ledger), or the chief of staff's own helpers (today's way, unrecorded).
4. What a finding can do: advise only (part 6.3 today), or block when it comes with a reproduction (a failing test or an experiment) and not when it is an opinion (which would also agree with HITLD-518).
5. What decides that a change gets a review: every change until the yield falls, or by risk class (sensitive paths, concurrency, data moves, the merge path, schemas, sandboxes) as well as by area.
6. Whether a fix round is reviewed again: always, when the fix is a rewrite, or never.
7. Independence: a different model, no sight of the author's report, and a fixed brief and finding format.
8. What the owner sees: findings and fixes, or the raw diff.
9. How this joins the existing parts: the adversarial loop (6.3), the independent security review (6.2), the human-read triggers (6.6), HITLD-518's mechanical gate, and the review-allocation controller.
