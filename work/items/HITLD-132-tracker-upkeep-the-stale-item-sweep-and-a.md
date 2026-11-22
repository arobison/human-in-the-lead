---
id: HITLD-132
title: "Tracker upkeep: the stale-item sweep, and a curator pass over work items"
kind: work
state: done
created: 2026-11-15
project: HITLD-15
constraint_of: [HITLD-67 c2]
claimed_by: D-13
release_note: `hitld work sweep` lists stale tracker items (orphaned claims, old proposed items, resolved blockers, items merged but still open, overlapping release needs, missing release notes); `hitld cadence due` lists the sweep after merges, the digest shows its findings, and the curate skill does the curator's pass over work items
---

## Why

The tracker drifts from what is built and decided: items stay open after their work merges, a release item's needs mix two releases, specs name things since renamed, plans change after later decisions, and items that change the public interface lack release notes. In a long session these were found and fixed by hand. The design has a stale-item sweep (part 13.3, planned) and a gardener for the knowledge base (part 8, renamed curator here), but nothing reads work items against what changed. The owner decided this lands before self-hosting.

## Done when

- **`hitld work sweep`** (deterministic, no model) reports orphaned claims, `proposed` items older than `sweep.proposed_max_age`, blocked items whose blockers are resolved, items whose branch merged but which are still open, release items whose needs include items another release item also needs, and items that change the public interface without a release note. `hitld cadence due` lists it after merge batches; its findings feed the orchestrator's plan and the digest.
- **The curator reads work items** after merge batches (a tier-1 dispatch, through the normal brief and report): open items against recent merges, answered decisions and design changes. It flags specs that name something since renamed or removed, work done in practice but still open, duplicates, plans a later decision changed, and release or milestone placement that no longer fits.
- **Findings are routed by decision rights, never applied silently:** wording fixes inside an item's facts go through a pull request like the knowledge-base curator's; anything that changes scope, a plan, a placement or a release becomes a question for the owner through the attention budget and the digest; the orchestrator re-plans from the rest. The curator changes no decision or plan on its own.
- **The curator's pass also runs `npm run spelling`** and fixes any British spelling it lists through the same kind of wording pull request. The spelling check is not a CI gate (the owner's decision), so this pass is what keeps the repository in American English.
- **The role is renamed from gardener to curator** everywhere (design parts 2, 4, 8, 10, 11, 13, 19 and 21, and any skill, brief or code), with no legacy name: it is not stored data.
- Design parts 4 (the curator's rights over work items), 8 or 13.3 (the pass), and 21 (the sweep is built) say so; an offline scenario runs the sweep over a fixture tracker with each finding kind.
- `npm run check`, the offline eval gate and `hitld work check` pass.
