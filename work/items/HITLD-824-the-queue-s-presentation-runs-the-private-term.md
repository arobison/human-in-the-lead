---
id: HITLD-824
title: The queue's presentation runs the private-term check on a pull request's diff and commit messages
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
---


## Why

Executors and the orchestrator run the public-text check without the private term list (`list_found false`) and ask the chief of staff to run it where the store is read. On 2026-11-22 the chief of staff ran it by hand on each of six code pull requests (HITLD-748, 763, 764, 765, 766, 729). The queue already checks a pull request's title and body against the list before opening it; the diff and commits are not covered where the list is read.

## Done when

- Before presenting a pull request the queue runs `hitld publish check` on its diff and commit messages with the private term list read, and refuses to present one that names a term, naming it to the executor.
- The presentation says the check ran with the list (`list_found true`).
- Tests cover a diff with a term, a clean diff, and a list that cannot be read (HITLD-187 rule). A queue change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Filed on 2026-11-22 from the owner's request to propose tickets for the session's mistakes and friction.
