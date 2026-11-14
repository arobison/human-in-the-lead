---
id: HITLD-45
title: "Milestones and releases as entities: needs and serves, independent checks, release records and `hitld release propose`"
kind: work
status: Done
created: 2026-11-14
project: HITLD-15
needs: [HITLD-18]
claimed: claude-executor
---

## Why

Design 3.0 (principles of the model) and 3.2, "Milestones and releases": a milestone becomes its own entity, a setpoint with an outcome, "done when" clauses, constraints (`needs`, each linked to a clause), contributions (`serves`, with value and confidence), an appetite, an optional external deadline and an independent check. A release becomes a record written when the owner makes it, with the interface delta that justified the bump. This replaces the `milestone` key on items and the `milestones` list on projects, so it changes the file format; it should land before the first release (Q33).

## Done when

- Schemas for milestone files (`kind: capability` or `learning`, in `work/milestones/`) and release records (`work/releases/<tag>.md`), with unknown-key rejection. `hitld work check` verifies that every `needs` entry names a clause that exists, every `serves` entry has a value and a confidence, every reference resolves, and no cycle runs through a milestone.
- `hitld work migrate` (from HITLD-18) turns each project's named milestones and each item's `milestone` key into milestone files, with those items as constraints marked for shaping to link to clauses. It is idempotent, and this repository's tracker migrates in one reviewable commit.
- Derived fields are computed, never stored: a milestone's `error`, `check_due`, `scope` (contributions by value per token within the appetite), `tokens_spent` and `cost_of_delay_rate`; an item's `constraint_of`, `contributes_to` and `released_in`. The views show each milestone with its error and scope, and the merged-but-unreleased stock.
- A milestone becomes `Done` only from a recorded passing check run by a role other than its items' authors. With every constraint `Done` and no passing check, it shows `check_due`. A learning milestone is `Done` when its study has a verdict.
- `hitld release propose --json` reports the interface delta since the last tag (schemas, CLI and MCP JSON, the executor contract, the report shape, trailers), the proposed bump and its basis, draft notes from changelog lines, items that changed public surface without a changelog line, and unmet gates (milestones a release item needs).
- Offline evals: an additive schema change proposes minor; a removed CLI JSON field proposes major (minor under 0.y.z, flagged breaking); an internal-only change proposes patch.
- `hitld release make` refuses outside the owner's own turn (the same guard as decision answers), writes the release record and the tag, and never pushes.
- The read API (HITLD-18) returns milestones and releases with `api_version`.

## Plan

docs/design/0001-human-in-the-lead/03-data-model.md#milestones-and-releases; shipping and prioritization in docs/design/0001-human-in-the-lead/02-loops.md (2.7, 2.4).

## Notes

Kept separate from HITLD-18 rather than folded in: HITLD-18 builds the read API, declared fields and `hitld work migrate` for any format change; this item is one such change and uses all three. The milestones named on HITLD-15 and HITLD-28 are the migration's first input. The milestone graph in the views and the report (design 12.1.2) is HITLD-62, kept apart so this item stays the format change.
