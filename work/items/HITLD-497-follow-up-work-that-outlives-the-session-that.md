---
id: HITLD-497
title: Follow-up work that outlives the session that dispatched it is reached, or re-briefed from what is durable
kind: work
state: proposed
created: 2026-11-18
project: HITLD-15
---

## Done when

- A dispatch records which session owns its agent (`harness_ref`), and `dispatch follow-up` refuses or says so plainly when that session is not reachable, rather than printing a call that cannot land.
- When the original agent cannot be reached (its session is archived or gone), the follow-up becomes a fresh executor briefed from what is durable: the branch, the report, the merge queue's evidence and the follow-up's reason; the skill's rule against briefing a fresh agent applies only while the original is reachable.
- Archiving a finished session says which dispatches still hold work that might need it, or nothing in the merge path depends on reaching an archived executor: a rejected or dropped queue entry has a way back that does not go through the original agent, with the queue still running every check.
- A branch that carries work from more than one dispatch is modeled: the queue entry, the report and the owner's approval can name more than one.
- Tests cover a follow-up to an unreachable agent, a re-queued branch and a two-dispatch branch. `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Reported in GitHub issue #209 and its comment. An orchestrator tried to send follow-up work to an executor that belonged to another orchestrator session. In the worst case a branch dropped from the merge queue could only get back in through an executor in an archived orchestrator session, whose message failed with "no transcript found"; the way out was to unarchive the old session only to relay the message.

## Notes

Triaged 2026-11-18: proposed, one cause (work that outlives the session or run that dispatched it). The run-and-hand-over parts of the issue change with the owner's decision that there is no run object (HITLD-470, HITLD-492): executors are sessions the chief of staff starts and archives when their pull requests merge (HITLD-167), not subagents of an orchestrator. Related: HITLD-314 (follow-up for interactive dispatches), HITLD-495. Code and skill: the owner's own yes to merge.

## Folded in on 2026-11-20 (HITLD-604)

HITLD-314 (a follow-up refused for an interactive dispatch) is folded into this item. Its substance: `dispatch follow-up` must work for an interactive dispatch by recording the follow-up on the ledger (a new dispatch ID on the same agent) with no worktree or result file, or say plainly which dispatch kinds it supports; its headless-only check must come before any ledger event is written, so a refused follow-up leaves no phantom dispatch holding an executor slot; and a re-opened dispatch must be able to report again, not return the earlier report. A test covers an interactive dispatch.

## Promoted in part on 2026-11-22 (HITLD-736, HITLD-735)

The narrow part, a relayed follow-up to an interactive executor recorded as a dispatch of its own so its branch reaches the merge queue, is promoted to rc.2 as HITLD-739. This item stays proposed for the rest.
