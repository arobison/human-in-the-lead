---
id: HITLD-775
title: The curator updates the design for the executor profile
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---

## Why

A curator pass for the design of the executor profile, as a design pull request for the owner's own yes. The owner decided in a walk-through (HITLD-768 to 774) that tiers are replaced by a general executor profile: an executor is described by capability dimensions (lifetime, interaction, isolation) plus runtime, provider, model, effort and budget; cascade rungs are (runtime, provider, model, effort) entries from a policy catalog, each declaring its data boundary and the guard enforcement it supports; an item's classification limits the rungs it may use and a runtime that cannot enforce what the work needs is refused; blast radius sets a floor on the cascade rung; tiers, `tier_override` and the tier settings are removed outright with a one-time migration. Detached headless processes (HITLD-746) are the detached lifetime in this profile. A working second adapter is later (HITLD-776).

## Done when

- The design part on execution profiles (5.1 and the places that say tier) states the dimensions, the runtime and provider catalog with data boundary and guard enforcement per rung, classification limiting the usable rungs, blast radius as a floor, the profile override, and the removal of tiers with the migration.
- It states the interface a runtime adapter implements and what a runtime declares in the capability table, without requiring a second adapter.
- The change reaches main through a design pull request with the owner's own yes. `hitld work check` and the spelling check pass.
