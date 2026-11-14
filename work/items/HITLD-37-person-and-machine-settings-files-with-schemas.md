---
id: HITLD-37
title: Person and machine settings files with schemas, trusted loading and `hitld config explain`
kind: work
status: Done
created: 2026-11-14
project: HITLD-15
milestone: settings-hold
claimed: D-37
---

## Why

Per design 13.4: personal plans, limits and hardware must never be committed, and caps must hold across projects. The person file (outside any repository) and the machine file (beside the machine-wide registry) are data only, with `schema_version`, and are read with the same trusted loading as `policy.json`. Caps and limits take the strictest layer; a project may be stricter, never looser. The quota keys and `env.port_range`, `env.worktree_root` and `env.secret_provider` move out of `policy.json` as the migration table in 13.4 says.

## Done when

- Schemas for the person and machine files exist; unknown and code-running keys are refused; a file that is not owned by the user, is group- or world-writable, or sits inside a git working tree is refused.
- The effective cap, limits, reserve, thresholds and port range are the strictest across person, machine, project and run, with tests for each.
- `hitld config explain` (and `--json`) prints each effective value, its layer, and any looser value it overrode.
- Moved keys in `policy.json` still load with a warning naming their new home; `hitld migrate` proposes the new files and removes the keys after confirmation.
- `hitld config write` refuses when `HITLD_ROLE=executor` or `HITLD_DISPATCH` is set.
