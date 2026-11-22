---
id: HITLD-718
title: "HITLD-691: rename the quota forecast key before_reset in the dashboard data contract?"
kind: decision
state: planned
created: 2026-11-22
project: HITLD-15
decider: owner
opened_from: [HITLD-691]
---

## Question

The dashboard data contract (HITLD-691) must validate against a schema, but the quota forecast has a key named before_reset, and the repository's schema guard refuses keys that start with before_ (lifecycle-hook keys). How should the contract name it?

The executor built the contract (version 2) and left the item open on this one question. Renaming changes a public name, so it raises the contract version under HITLD-683's rule. The gate's internal name, the digest text and the page text stay as they are.

Rule basis: blast-radius. Reversibility: two-way.

## Options and recommendation

- A. A. Rename to reserve_before_reset, contract version 2: The contract uses reserve_before_reset and is version 2; one map in core/lib/dashboard/contract.mjs does the rename. The item then gets its release note, its close, and a pull request. (cost: Anyone who read before_reset from the report must change.)
- B. B. Rename, keep version 1: Same rename, but the contract stays version 1. (cost: Breaks HITLD-683's rule that a rename raises the version.)
- C. C. Change the guard so a schema can mark a key as data: The name before_reset stays; the security guard gains an exception mechanism. (cost: Changes a security guard: a rule change with wider blast radius.; hard to undo)
- D. D. Drop the field: The field is removed; callers derive it from reserve_at and resets_at. (cost: Callers lose a convenience field.)

Recommended: A. Rename to reserve_before_reset, contract version 2. It is what the branch already does, follows the version rule, and touches no security guard.

If unanswered by 2026-11-23T00:00:00Z: A. Rename to reserve_before_reset, contract version 2.

## Answer

Recorded in the front matter once answered.
