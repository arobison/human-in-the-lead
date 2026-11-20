---
id: HITLD-472
title: Redesign the trust signal that lets the system merge without asking, so it rests on risk and outcomes, not a count of approvals
kind: work
state: proposed
created: 2026-11-18
project: HITLD-15
---

## Done when

- The owner decides, in a walk-through one question at a time, what lets the system merge a pull request without asking, replacing or reshaping the rule from HITLD-150 and HITLD-158 (`merge.propose_queue_after`: a number of merges in a row in an area, each approved as presented and none reverted, after which the system proposes letting the queue merge that area). The walk-through settles at least: what the authority to merge without asking rests on (the change's risk and reversibility, the area's history, or both); what counts as evidence of a good merge (a revert, a fix-forward item that cites the change, a failing check on main, an owner report, a post-merge audit); whether trust is granted by area, by class of change, or by size; whether it decays or is re-tested (for example an audit sample of unlocked merges the owner reviews afterward); which classes never unlock (one-way doors such as schemas, ledger and store formats, public commands and settings, policy, skills, security and rights paths); and what the proposal to the owner shows so a yes is an informed one.
- The answers are written into the design (part 14 and the decision rights, part 4) and the settings schema, and the items that build them are filed from the walk-through, each placed under a milestone.
- `hitld work check` passes.

## Why

The owner said on 2026-11-18 that they are not sold on 20 clean merges as the trust signal for self-merging and asked for a deeper look. Concerns recorded for the walk-through: a count of approvals measures how often the owner said yes, not how safe the changes were, and the owner's yes is given on a summary, so the signal can inflate as attention fades; an area is far coarser than a change's risk, so twenty small wording edits in one area would unlock a later change to anything in it; a reverted change is a rare and late signal, while defects found in this project's own runs were fixed forward by new items rather than reverted; and twenty clean merges bound the true failure rate only below about 14 percent at 95 percent confidence (the rule of three), so the number is weak evidence of low risk.

## Notes

Design-heavy: stays proposed and is walked through with the owner. Related: HITLD-150 and HITLD-158 (the current rule, done), HITLD-159 (the owner's delegation of tracker-only merges), HITLD-333 (a one-way door is a class that should always wait), HITLD-409 (each answer counts only from the person who gave it). Until it is decided the rule stands as built: only tracker files merge without asking, and nothing else is proposed for unlocking.

## Decided so far (the owner, 2026-11-18, in a walk-through)

- **The basis (HITLD-473):** risk first, history widens it. The count of approvals is dropped as the trust signal.
- **Never unlock (HITLD-474):** data formats; public interface and policy; skills, hooks and agent contracts; security and rights. These always wait for the owner's yes, whatever the history.
- **May become eligible (HITLD-475):** docs, comments and wording; tests and fixtures; code changes; dashboard and report presentation.
- **Evidence against a merged change (HITLD-476):** a revert, a fix-forward item citing it, a failing check on main, or the owner's report.
- **No audit sampling (HITLD-477).** Trust rests on the evidence signals only.
- **The unlock bar (HITLD-478):** a kind of change is proposed for unlocking after 15 merges that have each aged 7 days with no evidence against them, from at least 8 distinct items. Any evidence against resets that kind's count.
- **After a miss (HITLD-479):** an unlocked kind goes back to waiting at once and must meet the bar again from zero; unlocking it again comes to the owner as a decision.
- **Size is not the measure (HITLD-480, HITLD-481).** A fixed limit on changed lines is dropped. The gate is verifiability, not an attention budget (HITLD-482): a change is eligible only when its checks could have caught a wrong version, it is cleanly revertible and it is outside the never-unlock kinds. No review budget or ranking.

## Still to decide (as of 2026-11-18; the section below, dated 2026-11-19, settles most of it)

- How the unlock bar (history, per kind) and the verifiability gate (per change) combine: whether a kind must have earned the bar and each change must also be verifiable, or verifiability alone decides once a kind is unlocked.
- What counts as verifiable, concretely: tests that fail before the change and pass after, evals that cover the behavior, an independent reviewer's agreement, every check green including CodeQL; and who scores it (never the author of the change).
- What the proposal to the owner shows, so a yes is informed.
- How today's settings (`merge.owner_paths`, `merge.owner_areas`, `merge.propose_queue_after`) migrate, and what happens to the per-area trust events.
- Whether any learned parameter remains (for example the aging period or the distinct-items count) and where it lives (HITLD-408).

## One trust engine (2026-11-19)

The owner decided (HITLD-506) that committing to work earns its rungs by the same machinery as merging; the commitment design is in HITLD-291. Build the trust record, the unlock bar and the re-lock rule so both can use them.

## Decided on 2026-11-19 (HITLD-518, 519, 520, 521)

- **What counts as verifiable (HITLD-518):** the gate is mechanical only. A command scores it, never the author and never a model's opinion: a test that fails on the base and passes on the change, or an eval that covers the changed behavior; every check green, including CodeQL; the change cleanly revertible; no never-unlock path touched. Both gates apply: the kind has earned the unlock bar, and the change is verifiable.
- **What an unlock proposal shows (HITLD-519):** the merges with their ages and checks, the evidence signals looked for and not found, five of the changes in full, and what the kind would cover from now on.
- **How a change's kind is decided (HITLD-520):** path rules in policy name each kind and set its ceiling; a change touching several kinds takes the most restrictive. A classifier reads only the diff and can send a change to the owner but never promote one. Today's `merge.owner_paths` become the never-unlock kinds; `merge.propose_queue_after` goes away; past approval counts do not count toward the new bar.
- **The bar's numbers (HITLD-521):** fixed settings in policy (15 merges, 7 days of aging, 8 distinct items). The measuring in HITLD-408 may propose a change from evidence; only the owner changes them.

## What is left

Nothing in the design is open here. `merge.owner_areas` fold into the path rules (an area is a named set of paths), and the per-area trust events stay as history and do not count toward the new bar (HITLD-520). The build waits on the trust engine study (HITLD-507) for the common shape.


## Note on 2026-11-19 (HITLD-527)

Merging registers with the trust engine as a small chain of supervision modes (waits for the owner, eligible to self-merge). The engine's concept is supervision modes with an order, not only a ladder, so a kind may later register a mode such as an independent check.
