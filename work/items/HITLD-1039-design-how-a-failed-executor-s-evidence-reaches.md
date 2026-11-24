---
id: HITLD-1039
title: "Design how a failed executor's evidence reaches the orchestrator and the ledger: a classified failure record first, a hash-referenced blob later"
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- A design note says what a failure record is (a class such as budget, guard refusal, test failure, timeout, no-report), which fields the ledger holds, who writes it (the orchestrator on `dispatch complete`), and how the orchestrator reads it without reading raw untrusted text (design rule: the privileged orchestrator does not read raw untrusted text).
- The note settles the second stage: raw evidence (logs, diffs) stored as a blob referenced by hash from the ledger, with its size limit, retention and who may open it.
- The note answers the open ledger-field question that moved here from the earlier failure-evidence discussion: which field carries the class, which the blob reference.
- The owner approves the design in a question box before any code; then separate work items build stage one and stage two.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

On 2026-11-24 the owner chose to build failure evidence in stages, both stages designed here. Today an executor that fails, stalls or is refused leaves only a free-text relay line, so the orchestrator and the ledger cannot count or classify failures, and the owner cannot see which kind recurs. [Likely: the ledger has no failure-class field today.]

## Notes

rc.3. A design item: the question to the owner comes before any code; a ledger schema change is public-schema and needs the owner's own yes at merge.
