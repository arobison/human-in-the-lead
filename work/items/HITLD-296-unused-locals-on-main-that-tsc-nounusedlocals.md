---
id: HITLD-296
title: Unused locals on main that tsc --noUnusedLocals flags (nameList, appendEvent, absorb and in tests)
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-189 c1]
---

## Why

Found by D-21. `npx tsc -p tsconfig.json --noUnusedLocals` flags unused locals on main: `nameList` (env.mjs:169), `appendEvent` (ledger.mjs:7), `absorb` (orchestrator.mjs:30), and some in tests. CI's tsconfig does not enable the flag, so nothing is blocked today.

## Done when

- The unused locals are removed, or the owner decides to leave the flag off.
- `npm run check` and `hitld work check` pass.

## Decided

The owner decided on 2026-11-16 (decision HITLD-383): remove the unused locals (`nameList`, `appendEvent`, `absorb`, and those in tests); `npm run check` and `hitld work check` pass. A code change: the owner merges.
