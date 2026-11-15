---
id: HITLD-109
title: "Self-host: install rc.1 into this repository through its own PR, then run it from the chief of staff"
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
needs: [HITLD-124, HITLD-125]
---

## Why

HITLd is built to run itself. Once v0.1.0-rc.1 is tagged, this repository installs it like any consuming project, and the owner directs the work through the chief of staff from a fresh session. The installed plugin stays pinned to a release (or a commit on main to try one fix), never a branch or the working tree, so the tools that manage the work cannot change mid-run. The owner decided this is a step before v0.1.0.

## Done when

- After rc.1 is published, `hitld install --ref v0.1.0-rc.1` runs in this repository through its own PR: the contract block in `AGENTS.md`, `.claude/settings.json` pinned to the tag, and `policy.json` kept. The owner merges it.
- `AGENTS.md` holds a "Project rules" section outside the contract markers, proposed by the `adopt` skill from this repository's conventions (zero runtime dependencies, never hand-editing `plugins/` but running `npm run build`, the gates, the commit trailers and DCO, the writing rules) and accepted by the owner.
- The store remote is set up for this project: a private store repository, `store.remote.url` in `policy.json`, and this cloud environment enrolled as a device through a merged `store-devices.json`.
- From a fresh cloud session, the chief of staff starts an orchestrator, `hitld check contract` and `hitld work check` pass, and one item is dispatched, merged and closed through the installed rc.1.
- The commit and commit-message hooks are installed in each environment's sessions for this repository.
- Moving the pin to a later release is a one-line PR the owner merges; the guide for this repository says so.
