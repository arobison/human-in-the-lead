---
id: HITLD-1033
title: Design how project policy names the shared machine resources each merge check step and each worktree setup step needs, and how hitld holds each only for that step
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- A design note (in the design text, part 16 or the part on the machine profile, owner's choice) says how a policy step (a `fast_checks` or `full_suite` step in the merge queue, a `worktree_setup` step in dispatch) names the shared resources it needs (for example a build lock, a graphics lock), how hitld acquires them for that step only and releases them after, and how that sits on the capacities of HITLD-41 and the weighted heavy steps of HITLD-559.
- The note settles: whether the resource names are free text or declared in the machine profile; whether a lock is shared across projects on one machine (the reports need it); what a step does when it cannot get a resource (wait, time out, fail); and the policy schema change, if any.
- The owner approves the design in a question box before any code. Then a separate work item builds it.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

GitHub issues 635 (merge queue) and 637 (dispatch worktree setup), both v0.1.0-rc.1. A project with machine-wide serial resources (build and graphics hardware) can only wrap the whole merge command, or the whole dispatch command, in its own lock script. Every lock is then held for the entire run: a graphics lock stays held through CPU-only steps, so other projects that need the graphics hardware wait for nothing, and heavy worktree setup (dependency installs, builds) cannot be serialized behind a shared lock on its own. The reporters expect policy to say which resources each step needs, and hitld to acquire them per step; for example a CPU lock for build steps and a graphics lock only for browser tests that render. [Likely: HITLD-41 built the lock mechanism and capacities, so the new part is the per-step declaration and cross-project sharing.]

## Notes

rc.3. A design item, so the question to the owner comes before any code; the schema change and the policy keys need the owner's own yes at merge. Related: HITLD-41 (capacities, done), HITLD-559 (weighted heavy steps, hitld's own), HITLD-1011 (gates run ahead of executors' heavy jobs). Replies are posted on issues 635 and 637.
