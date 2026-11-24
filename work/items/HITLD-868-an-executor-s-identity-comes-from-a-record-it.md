---
id: HITLD-868
title: An executor's identity comes from a record it cannot write, not from its checkout
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-69 c2]
---

## Why

The review found that an executor known only by its claim commit sheds the whole guard with one ordinary git command (`git branch -f main HEAD`, `git fetch . HEAD:refs/remotes/zz/main`, `git checkout --detach origin/main`, or amending the claim commit), after which a force-push to main and the orchestrator's commands pass the guard. A second variant: `HITLD_DISPATCH` is skipped when a subagent has a non-executor `agent_type` (`core/harness/claude-code/hooks/input.mjs`, `isExecutor`).

## Done when

- Whether a session is an executor comes from a dispatch-to-session record made at dispatch and kept where the executor cannot write it, not from the checkout's claim commit or refs.
- `HITLD_DISPATCH` is tested whatever the subagent's `agent_type`.
- A test for each shedding route above (branch move, remote-tracking ref, detach, amend, subagent) shows the guard still applies.
- The plugin copy matches. A guard change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Finding T1; it subsumes the symbolic-ref and update-ref half of HITLD-856.
