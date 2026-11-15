---
id: HITLD-94
title: Adopt design 0002, hosted tracker backends
kind: decision
state: done
created: 2026-11-15
project: HITLD-95
decider: owner
answer: Adopt design 0002 with the recommended answer to each of Q1 to Q14
answered_at: 2026-11-15T04:50:07Z
answered_by: owner
answered_via: main-session
---

## Question

Adopt design 0002 (`docs/design/0002-hosted-tracker-backends.md`): HITLd's model is the contract and each hosted tracker gets a translating backend; work items are hosted while decisions, milestones, releases and the ledger stay as files; the core syncs through the tracker's API with an injected token into a machine-local read copy, with queued writes; import and switch comes first?

## Options and recommendation

- **Adopt, with the recommended answer to each of the 14 questions (recommended).** Section 17 records each answer.
- Adopt in part, deciding the questions one by one.
- Keep the files backend only.

## Answer

Adopt design 0002. The owner walked through Q1 to Q14 one at a time in the main session and took the recommendation on each; the design merged as decided (#29).
