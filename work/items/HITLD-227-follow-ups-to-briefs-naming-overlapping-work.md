---
id: HITLD-227
title: "Follow-ups to briefs naming overlapping work: act on release_note_missing, say why a project cannot add the key, update designs 03 and 05"
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-136]
constraint_of: [HITLD-66 c2]
---

## Why

HITLD-136 (PR #168) made briefs name overlapping work and made `dispatch complete` flag a done report whose commit changes a public file when the item has no `release_note`. Its executor found three loose ends, and the owner chose to file them as one item (2026-11-16).

## Done when

- The orchestrate skill tells the orchestrator what to do with the `release_note_missing` flag: ask the executor for a one-line note, or write one itself, before the branch merges.
- When a project's tracker `optional_keys` lacks `release_note`, the flag still shows, and its `next` says the executors cannot add the key and how the project enables it.
- Design 03 (data model: the `touches` row and the ledger's `touches` and `touches_source` fields) and design 05 section 5.2 (brief contents: the overlap and merged-since lines and the merge-main line) say what the code does.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From D-14's digest on HITLD-136. Needs HITLD-136 merged.

## Affected by a decision (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (470/492 (weak)): design 03 data model and 05 brief contents docs; orchestrate skill. The decisions since then are the trust engine decisions (HITLD-518 to 529, 547, 548; builds HITLD-552 to 556); the ledger and no-run decisions (HITLD-484 to 490). The item stays `planned`; a builder reads those decisions first, and the item is reworded if they change what it builds.
