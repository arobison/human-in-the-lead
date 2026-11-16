---
id: HITLD-296
title: Unused locals on main that tsc --noUnusedLocals flags (nameList, appendEvent, absorb and in tests)
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

Found by D-21. `npx tsc -p tsconfig.json --noUnusedLocals` flags unused locals on main: `nameList` (env.mjs:169), `appendEvent` (ledger.mjs:7), `absorb` (orchestrator.mjs:30), and some in tests. CI's tsconfig does not enable the flag, so nothing is blocked today.

## Done when

- The unused locals are removed, or the owner decides to leave the flag off.
- `npm run check` and `hitld work check` pass.
