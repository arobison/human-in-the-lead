---
id: HITLD-1005
title: Raising a bound in policy takes effect in the current run, or the command that restarts the run keeps its report numbers
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- After `.human-in-the-lead/policy.json` `execution.max_executors` changes, `hitld run status` and `hitld config explain` say whether the running run still holds the old cap and the one command that applies the new one.
- Applying it either changes the run scope in place (a ledger event, with nothing in flight), or `run start --replace` continues the ledger report numbering so run reports stay comparable; a test covers a cap raised from 4 to 8 with one completed dispatch, and the report numbers before and after.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

On 2026-11-24 the owner raised the cap to 8. The project policy change merges by pull request, but the run's scope was fixed at `run start` from the policy value at that time, so the cap in force stays 4 until a new run is started. Nothing in `run status` or `config explain` says that, and a new run splits the report numbers. Found by the chief of staff while preparing the change (confidence: likely on the ledger-report effect, not yet run).

## Notes

rc.3. Whether a scope bound may change mid-run is a rule question (design part 11.2): the owner's own yes is needed for any in-place change, so the first part may be the whole fix. Not a ship blocker.
