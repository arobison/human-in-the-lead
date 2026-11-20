---
id: HITLD-464
title: "An executor cannot leak a secret by accident: a scrubbed-environment check script, a block on environment dumps, and a scan at completion"
kind: work
state: planned
created: 2026-11-17
project: HITLD-15
---

## Done when

- One script runs the CI-style full check with a scrubbed environment (the variables a CI run must not see removed inside the script), and the executor brief and `skills/execute/SKILL.md` tell an executor to run that script instead of listing or unsetting variables by hand. A test shows the script's run sees none of the `HITLD_*` variables.
- In an executor session, a pre-tool hook refuses the common ways of dumping the environment (`env`, `printenv`, `export -p`, a bare `set`, and reads of `/proc/*/environ`), and says to list variable names only. It is a guard against accidents, not a security boundary, and the contract says so. A test covers each refused form and a form that stays allowed (for example `printenv NAME` for one named variable that holds no secret, if the hook allows it, or none, if it does not).
- `hitld dispatch complete` scans the session record and the report for private-key patterns before recording anything. A match stops the completion, records no secret text anywhere, and tells the chief of staff in the refusal that a secret appeared in a transcript. A test uses a fake key.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

An executor's environment holds secrets, and a listing of it (to check which variables are set) puts them in the session transcript. The brief for the full check told executors to run it with certain variables unset, which invites that listing. These three cheap fixes remove the reason to look, block the accident, and catch what slips through. The owner asked for them on 2026-11-17; the details of the event that prompted the question are held privately, not here.

## Notes

Structural options (executors holding no store key unless they need one, a key per dispatch that is removed on completion, the key in a file with only its path in the environment) go to the HITLD-333 walk-through, not this item. Related: HITLD-333, HITLD-315 (executors run the right tests at the right times). A hook and a skill line and a ledger-adjacent refusal: the owner's own yes to merge.

## Note on 2026-11-19

The owner decided (HITLD-537) that every rule an executor could break by accident is enforced by a hook or a scrubbed environment and every fact comes from an independent source; this item is the first of that, and the general item is HITLD-562.

## Note on 2026-11-20 (reconciliation)

This is the first of the general rule that every rule an executor could break by accident is enforced by a hook or a scrubbed environment (HITLD-537, build HITLD-562). Which key signs answers (HITLD-516) does not change what this item scrubs.
