---
id: HITLD-141
title: Dispatch does not launch headless tier-3 executors that cannot run the contract's commands
kind: work
state: done
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-67 c2]
claimed_by: D-16
release_note: "A completion whose `permission_denials` show `hitld`, `node`, `npm` or `git` refused is recorded as blocked by permissions (`blocked_by: executor-permissions` in `hitld dispatch complete`), not as a bad report shape; a report that only mentions a refusal gets a `permission_warning` and holds nothing. For the rest of the run, `hitld dispatch plan` runs every tier-3 item in the other mode (`mode`, `modes` on its entry) and holds items with reason `executor-permissions` when no mode can; `dispatch start --mode` refuses a refused mode."
---

## Why

The chief of staff skill and HITLD-86 already define tier-3 work in a cloud harness as an interactive session the chief of staff starts on `start_session`, with headless as the alternative. In the first self-hosted run, an orchestrator in a cloud session launched two tier-3 executors headless. Both were refused `hitld`, `node`, `npm` and `git` by the permission mode they ran in. They claimed and committed nothing. Dispatch had no way to know, and `dispatch complete` flagged only a missing report shape.

## Done when

- `hitld dispatch plan` chooses the interactive mode for a tier-3 item when the harness's headless runs cannot run the commands the contract requires (`hitld`, `node`, `npm`, `git`), and says so. When neither mode can, the item is held with a named reason (for example `executor-permissions`) and nothing is launched.
- A report that shows refused commands is recorded as blocked by permissions, never as a missing report shape, and the item is not re-dispatched into the same refusal.
- The orchestrate skill tells the orchestrator to use `start_session` in a cloud harness unless `dispatch plan` says headless is able to run.
- Tests cover the mode choice, the hold, and a refused-commands report. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

The owner asked that the chief of staff file work for the system and not execute it. Starting a tier-3 session on `start_session` is the chief of staff's role in HITLD-86, not executing. HITLD-109 needs this.
