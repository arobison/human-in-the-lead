---
id: HITLD-907
title: Pull-request merges regenerate the committed views, and work check flags stale views
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-192 c?]
---

## Why

The committed `work/views/` were last regenerated on 2026-11-15; there is no `milestones.md` and `initiatives.md` is retired in the code. Only the local queue regenerates views; nothing on the pull-request merge path does, and `work check` promises 'view freshness on main' but no code does it. A consumer on `merge.via: pull-request` hits this on day one.

## Done when

- A pull-request merge regenerates the committed views (or the queue says it does not and the guide says why).
- `hitld work check` flags stale views on main.
- A test per case.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the plan review P5 and the audit finding 4 of the Fable reviews (2026-11-22); decision HITLD-897. rc.3 by the owner's decision.
