---
id: HITLD-942
title: "Common configuration slips give plain errors: Windows paths in tracker.json, a byte-order mark in policy.json, a missing policy"
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-402 c?]
---

## Why

A `tracker.json` with a Windows path gives a bare regular-expression error; a `policy.json` saved with a byte-order mark gives `Unexpected token`; a missing policy says to create it from `templates/policy.json`, a path the consumer does not have.

## Done when

- Each error says what is wrong in plain words: 'a relative path with forward slashes inside the repository'; the byte-order mark is stripped or named; the missing-policy error says `hitld install --key <KEY>`.
- A test per case.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable consumer-eye walkthrough of 2026-11-22 (C11); decision HITLD-932. rc.3 by the owner's decision.
