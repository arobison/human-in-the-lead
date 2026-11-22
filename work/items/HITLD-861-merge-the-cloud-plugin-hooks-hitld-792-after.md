---
id: HITLD-861
title: Merge the cloud plugin hooks (HITLD-792) after checking they spare non-executors
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Approve after I check it spares non-executors: Merge only if the guard passes the chief of staff and orchestrator sessions through."
answered_at: 2026-11-22T17:33:05.066Z
answered_via: question-tool
answered_by: owner
---

## Question

PR 543 runs the plugin's guard in cloud sessions of this repository via project settings. Approve after I confirm it does not block non-executor sessions?

Hooks run in every cloud session of this repository; HITLD-857 files the gap that an executor can edit its own hook settings.

## Options and recommendation

- A. Approve after I check it spares non-executors: Merge only if the guard passes the chief of staff and orchestrator sessions through.
- B. Approve now: Merge as is.
- C. Hold until HITLD-857 is built: Wait.
- D. Reject it: Close the PR.

Recommended: Approve after I check it spares non-executors. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
