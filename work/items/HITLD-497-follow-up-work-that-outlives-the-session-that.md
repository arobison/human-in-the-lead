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
