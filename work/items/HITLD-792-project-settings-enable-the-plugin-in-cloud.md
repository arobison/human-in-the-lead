---
id: HITLD-792
title: Project settings enable the plugin in cloud executor sessions, and a fresh cloud session proves the guard runs
kind: work
state: in-progress
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
claimed_by: D-01M8157D3BBKPMS2
---

## Why

Found by the HITLD-781 executor on 2026-11-22: the plugin's hooks, including the executor guard, do not run in cloud executor sessions, so `git push origin HEAD` was allowed in one. Every executor session started in the cloud so far has been unguarded and unmetered. The owner decided (HITLD-790) to enable the plugin in those sessions and to verify it. HITLD-781 made the guard recognize an executor by its checkout; this item makes the guard run at all.

## Done when

- The repository's project settings enable the plugin from this repository's marketplace so that a cloud session started on the repository loads its hooks; how this is done is found out first (the documentation for cloud sessions and project settings) and recorded in the item.
- A fresh cloud session on a claim branch is started and a command the executor guard denies (for example `git push origin main`) is attempted in it: the denial is the proof the guard runs, and the result is recorded in the item without printing the environment.
- The same session shows the budget hook of HITLD-782 can run there, or the item records what is missing.
- A settings or guard change reaches main only with the owner's own yes. `hitld work check` passes.
