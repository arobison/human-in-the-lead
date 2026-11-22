---
id: HITLD-125
title: Tracker changes from a cloud session reach main through one command
kind: work
state: done
created: 2026-11-15
project: HITLD-15
constraint_of: [HITLD-67 c2]
claimed_by: D-9
release_note: "`hitld work publish` carries a cloud session's tracker changes to main as one pull request."
---

## Why

A cloud session cannot push to main, so each tracker change (a decision filed, an answer recorded) was committed by hand on a session branch, sometimes without trailers or with a private name in the message, and re-committed by the orchestrator. Every self-hosted session will do this from its first day.

## Done when

- `hitld work publish` gathers the tracker files the session changed, commits them on a new branch from main with the project's trailers, runs `hitld check commit-message` and `hitld publish check` on the message and the pull request text, pushes, and prepares the pull request (opening it through the send gate where the session may; otherwise printing what to open). It never pushes to main and refuses executors.
- The orchestrate and chief-of-staff skills use it after filing or answering decisions.
- Tests cover a session with decisions filed and answered, a private term in a would-be message, and a session with nothing to publish.
- `npm run check`, the offline eval gate and `hitld work check` pass.
