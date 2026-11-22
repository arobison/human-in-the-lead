---
id: HITLD-765
title: The execute skill says an executor may push its own branch to open its pull request
kind: work
state: in-progress
created: 2026-11-22
project: HITLD-15
claimed_by: D-01M80WTA5XNBY3DH
---

## Why

The execute skill says executors never push, but opening a pull request needs the branch pushed, and the orchestrator's brief asked executors to open one. The HITLD-740 executor pushed its branch and reported it as a deviation.

## Done when

- The execute skill says an executor may push its own branch (and only that branch) so it can open its pull request, and never pushes main or another branch.
- The orchestrate skill's brief text says the same.
- A skill change reaches main only with the owner's own yes. `hitld work check` and the offline eval gate pass.
