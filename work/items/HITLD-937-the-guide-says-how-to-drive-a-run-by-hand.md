---
id: HITLD-937
title: The guide says how to drive a run by hand without Claude Code, or says those commands are for the orchestrator skill only
kind: work
state: done
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
claimed_by: D-01M87PRPC7SKNSWQ
release_note: "`hitld dispatch --help` (and the same for every command group, such as `run` and `work`) lists the group's subcommands instead of answering `unknown command`, and the new-project guide shows how to drive one item by hand without Claude Code."
---

## Why

The guide names `dispatch plan` and `dispatch start --by-hand`, but neither works without `hitld run start --session <id>` (or `HITLD_SESSION`), then `dispatch handle`, `dispatch complete --report-file`, `merge` and `merge --all`; none of these is in the guide, and `hitld dispatch --help` returns `unknown command`.

## Done when

- The guide has a 'by hand' section for driving one item without Claude Code, with those commands in order, or says plainly that they are for the orchestrator skill only.
- `hitld dispatch --help` lists its subcommands.
- `hitld work check` and the spelling check pass.


## Notes

From the Fable consumer-eye walkthrough of 2026-11-22 (C8); decision HITLD-932. Joins Consumer live (HITLD-67) clause c1 as a recorded exception to the freeze: it breaks a first consumer's first hour.
