---
id: HITLD-228
title: work claim and work close commits carry the Agent-Role, Agent-Model and Agent-Effort trailers
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

`hitld work claim` and `hitld work close` write commits with only the `Work-Item` and `Dispatch` trailers (`core/lib/tracker/files/claims.mjs` line 208). The executor contract and the brief ask for `Agent-Role`, `Agent-Model` and `Agent-Effort` on every commit, so an executor following the brief has to amend its own claim and close commits. D-15 did, on unpushed commits. Reproduce: run `work claim` as an executor, then `git log -1 --format=%B`.

## Done when

- The claim and close commits carry `Agent-Role`, `Agent-Model` and `Agent-Effort` whenever the executor's environment names them (`HITLD_ROLE`, and the model and effort the session reports), and say so in their output when they cannot.
- A test runs `work claim` and `work close` as an executor and checks all five trailers.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Found by the executor of HITLD-140 (dispatch D-15) and relayed by orch-1; filed under HITLD-181. Related to HITLD-203 (the model ID in the trailer), which settles what the model value holds.
