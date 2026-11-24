---
id: HITLD-953
title: hitld check forge reads the live forge settings with a read-only token and reports each as ok, wrong or cannot-read
kind: work
state: in-progress
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
claimed_by: D-01M87R90H4GKNQYQ
release_note: "`hitld check forge` reads the live GitHub settings with a read-only token from `HITLD_FORGE_TOKEN` (or the variable `--token-env` names) and reports each as ok, wrong (found, expected, where to fix it) or cannot-read (status, permission needed), exiting non-zero on any that is not ok."
---

## Why

The settings in HITLD-952 are the owner's to apply and nothing checks them afterwards.

## Done when

- `hitld check forge` takes a read-only token from the caller, prints nothing secret and exits non-zero on any wrong or cannot-read; each line reads ok, wrong (found, expected, UI path) or cannot-read (status, permission needed).
- It checks squash-only and auto-merge off, the rulesets (enforcement active, targets, rules, required contexts equal to `policy.json`, bypass actors exactly as specified), no classic rule in conflict, the release environment, Actions permissions, secrets, deploy keys, collaborators and installations.
- A test per check with a fake forge.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable forge-enforcement spec (2026-11-22) and the owner's walk-through decisions HITLD-944 to 951.
