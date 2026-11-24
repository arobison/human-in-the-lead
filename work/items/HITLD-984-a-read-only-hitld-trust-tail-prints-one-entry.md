---
id: HITLD-984
title: A read-only `hitld trust tail` prints one entry per recorded answer with latency, whether the recommendation was taken and any reversal, for a board to read
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-566 c?]
---

## Done when

- `hitld trust tail --json [--since <time>] [--decider <id>]` prints one entry per recorded answer: decision ID, option, whether it matched the recommendation, latency, the worth-asking rating, any generalization and its outcome, and any later reversal; a test covers each field.
- The command is read-only, scoped to the project and enabled by a policy setting the owner turns on; a test shows it refuses when the setting is off.
- Free-text notes are left out unless `--notes` is given; a test covers it.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

A board can show whether asking is well calibrated only if it can read the trust record, and today the only way is the JSON printed once when an answer is recorded. It serves consumers who build views and the owner who tunes what gets asked.

## Notes

GitHub issue 438. rc.3. Reading the trust record is the owner's call (HITLD rights who), hence the policy switch.
