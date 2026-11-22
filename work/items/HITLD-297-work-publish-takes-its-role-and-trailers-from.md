---
id: HITLD-297
title: work publish takes its role and trailers from defaults so the command is short and a permission rule can match it
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-191 c2]
---

## Why

`hitld work publish` needs a long command today: a `HITLD_ROLE=` prefix, `--title`, `--body` and two `--trailer` flags. A permission rule matches on the start of the command, so a prefix and changing arguments make a poor rule target, and the auto-mode classifier denied it twice in one session. The owner added a rule for it (the project's `.claude/settings.json`). Defaults would let the role come from configuration and the harness trailers from the environment, so the rule stays short and stable.

Related: HITLD-254 (the owner's approvals reaching the orchestrator without opening its session).

## Done when

- `work publish` takes the role from the session's identity and the harness trailers (co-author, session) from the environment or policy when no flag is given.
- With only `--title` (and `--body`) it produces the same commit and the same checks as today.
- A test covers the defaults.
- `npm run check` and `hitld work check` pass.
