---
id: HITLD-707
title: An interactive tier-3 executor session is started with send_message allowed
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---

## Why

A tier-3 interactive executor session is started by the chief of staff through `create_session`, and its brief tells it to send its report to the orchestrator with the harness's message tool at the end of every turn (HITLD-147). `create_session` takes `extra_allowed_tools`, the tools a new session may use without a prompt, and the chief-of-staff skill passes one only for the store attach (HITLD-142). Without the message tool allowed, the executor's report waits on a permission prompt in a session nobody is watching, which is the stall HITLD-147 was meant to end. Found in the review of PR 389.

## Done when

- The chief-of-staff skill says that a tier-3 interactive session is started with the message tool in `extra_allowed_tools` (`mcp__claude-code-remote__send_message`), and that a grant the chief of staff's own session does not hold is dropped, so the first-run setup checks the chief of staff holds it and tells the owner once what to allow when it does not (the same step as HITLD-674).
- The plugin copy of the skill matches.
- A test or eval scenario shows the start instruction for a tier-3 interactive session naming the message tool among the allowed tools, and the setup check reporting a missing grant.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Related: HITLD-147 (the report block), HITLD-144 (the message tool, and the hook test), HITLD-674 (the same dropped-grant cause for the store attach). Skill change: the owner's own yes to merge.
