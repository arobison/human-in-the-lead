---
id: HITLD-1065
title: "A run scope's refusals name their true cause: a decision answered outside this run is not called scope-ended, and a token correction is counted once"
kind: work
state: planned
created: 2026-11-25
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- The refusal for a decision whose answer was made outside this run has its own code and message (today `scope-ended`, `core/lib/run/scope.mjs`), distinct from a scope that was ended; a test asserts each wording.
- `spentOf` counts a dispatch's tokens once when `ledger correct-tokens` has corrected them, using the last figure and not the sum of every `reported` event; a test covers a dispatch corrected twice.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Two review notes on HITLD-877: the `scope-ended` code is used for 'answered outside this run' as well as for an ended scope, which sends the reader to the wrong cause; and `spentOf` adds every `reported` event of a dispatch, so a corrected figure is counted on top of the one it replaces and the budget runs out early.

## Notes

rc.3. Follows HITLD-877. Codes are public (the error list in design 16 and `core/lib/cli/errors.mjs`): a new code raises the error table; owner-held if the schema or the table counts as public.
