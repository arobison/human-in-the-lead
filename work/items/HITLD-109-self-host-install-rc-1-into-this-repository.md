---
id: HITLD-109
title: "Self-host: install rc.1 into this repository through its own PR, then run it from the chief of staff"
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
needs: [HITLD-124, HITLD-125, HITLD-130, HITLD-131, HITLD-132, HITLD-133, HITLD-134, HITLD-135, HITLD-136, HITLD-141, HITLD-142, HITLD-144, HITLD-243, HITLD-349]
constraint_of: [HITLD-67 c1]
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

Sequenced after HITLD-243 (landing the Windows pull request) on the owner's instruction of 2026-11-16, "start with the windows PR": the owner's order, and the self-host install then pins a build that includes the Windows fixes. Not a technical dependency; remove the `needs` on HITLD-243 if the order changes. The planner also held a start slot for this item while it was proposed but not started, which kept HITLD-243 from starting (HITLD-153).

## Affected by a decision (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (333,470/492,508): self-host install: store enrollment device, CoS-run, orchestrator dispatch. The decisions since then are the trust engine decisions (HITLD-518 to 529, 547, 548; builds HITLD-552 to 556); the ledger and no-run decisions (HITLD-484 to 490); stay in the harness and answers by proof (HITLD-540, 515); answers, proof and contributors (HITLD-515 to 517). The item stays `planned`; a builder reads those decisions first, and the item is reworded if they change what it builds.
