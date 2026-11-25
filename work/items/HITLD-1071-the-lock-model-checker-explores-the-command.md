---
id: HITLD-1071
title: The lock model checker explores the command line's default release, per-grant tokens, and boot and other-host holders, and judges liveness by a rule written apart from the code's
kind: work
state: planned
created: 2026-11-25
project: HITLD-15
needs: [HITLD-1052]
constraint_of: [HITLD-405 c?]
---

## Done when

- The model's release by name keeps both forms: forced, and not forced (by `--pid`, including the stale clause); a trace where the default release leaves another live process's hold in place is explored.
- Tokens are per grant, not per actor, so an old handle that could match a later grant by the same actor fails the model; a mutation check shows it.
- Holders on another boot or host are modelled (liveness cannot be checked, so only the expiry applies), and the model's `live()` is written from the rule's wording in design 13, not copied from `staleReason`, so it can disagree with it.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The HITLD-1052 review found that `releaseByName` in the model is always forced, tokens are fixed per actor, boot and other-host cases are absent, and the model's liveness check restates the code line for line, so it checks consistency, not the rule.

## Notes

rc.3. Owner-held (merge-path lock; test helper). Follows HITLD-1052.
