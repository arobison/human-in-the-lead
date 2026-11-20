---
id: HITLD-500
title: Sizing counts required reading, the brief lists it, and the report says what was read
kind: work
state: proposed
created: 2026-11-18
project: HITLD-15
---

## Done when

- Sizing counts required reading: documents an item or its plan names (a `## Plan` link, a spec named in "Done when", a "normative" reference) add to the estimate, and a document that will not fit the tier's budget raises the tier or splits the item.
- The brief lists required reading with each document's size, and asks for the sections that matter where the plan names them.
- The report says what was read: each required document, read in full or not, with the parts left out; a gap becomes a directed read in the owner's merge presentation, not a line under `deviations`.
- Shaping guidance says that for a large spec an item names the sections it needs, not the whole document.
- Tests cover an item whose plan names a spec larger than its tier's budget. `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Reported in GitHub issue #201. An item's plan made an outside spec normative; the spec is about 251,000 characters (about 60,000 tokens). The sizer called the item tier 1 (about 75,000 tokens) because its plan names files, its "Done when" is executable and it has three touches. The executor read only the first 100,000 characters, wrote conformance tests from them and passed every check; it said so under `deviations`, so the orchestrator caught it and the owner held the merge. Nothing in hitld made the reading part of the work: sizing counts the plan's specificity and touches, the brief lists no required reading, and the report has no field for what was read.

## Notes

Triaged 2026-11-18: proposed. Related: HITLD-493 (the audit includes routing by file count as a proxy for size), HITLD-439 and HITLD-450 (where an estimate came from). Code and skill: the owner's own yes to merge.

## Folded on 2026-11-20 (reconciliation, HITLD-575)

The owner decided that this item describes the old sizing model, which HITLD-561 replaces (an item's tier and cost come from measured history with its plan as the prior, HITLD-533). This item is folded into HITLD-561 and closes when that item lands; it is not built separately.
