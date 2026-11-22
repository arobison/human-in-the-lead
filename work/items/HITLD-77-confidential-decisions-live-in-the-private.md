---
id: HITLD-77
title: Confidential decisions live in the private store, not the public tracker
kind: work
state: proposed
created: 2026-11-15
project: HITLD-15
constraint_of: [HITLD-64 c2]
---

## Why

Some questions to the owner are confidential: an expired accepted security risk (HITLD-63) names an unfixed finding. Since HITLD-72, `rights ask` refuses to write a confidential question into a public files tracker rather than publish it, so such a decision has nowhere to go. The owner decided they live in the private store.

## Done when

- A decision whose classification is above the repository's ceiling is created in the private store, with the same keys and lifecycle as a tracker decision, and the public tracker holds at most a placeholder that names no detail.
- `rights ask`, `rights answer`, the digest and `security accept --decision` work the same for both places, and the read API returns a private decision only to callers allowed to read the private store.
- The commit guard (HITLD-51) and `work check` refuse a confidential decision in the repository.
- Tests cover an expired risk raising a private decision, answering it, and accepting the risk against it.

## Returned to proposed on 2026-11-20 (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (508,409/333): confidential decisions in private store; who can read; where decisions live. The decisions since then are stay in the harness and answers by proof (HITLD-540, 515); answers, proof and contributors (HITLD-515 to 517). The owner decided (HITLD-578) that the items the decisions change most return to `proposed` until reshaped, so the planner does not offer them; the owner promotes the item again once it is reshaped.
