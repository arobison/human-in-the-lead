---
id: HITLD-1067
title: The owner's answer to a run-scope question is signed, so the store is no longer the only boundary against a hand-written ask record
kind: work
state: proposed
created: 2026-11-25
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- A design note and a decision: answers that open a run scope carry a signature the store checks (HITLD-405's trust model), so a hand-written ask record, ledger line and question marker no longer pass as the owner's yes.
- The run-scope check reads the signed answer; an unsigned or mis-signed one is refused with its own code; tests cover a forged record.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

HITLD-877 opens a scope only on the owner's recorded yes to a question the command wrote; its known limit is that someone who writes the ask record, the ledger line and the marker exactly as the commands would cannot be told apart. The store is the boundary today.

## Notes

rc.3, proposed: needs the owner's decision (what signs, and with which key). Credential and store surface: owner-held. Related: HITLD-405, HITLD-877.
