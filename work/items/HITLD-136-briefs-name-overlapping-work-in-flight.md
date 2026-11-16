---
id: HITLD-136
title: Briefs name overlapping work in flight, and executors write their own release notes
kind: work
state: done
created: 2026-11-15
project: HITLD-15
claimed_by: D-14
release_note: "Briefs list the dispatches in flight whose touches overlap the item's, and the merges since it was planned that changed the same paths; when a dispatch in flight overlaps, the brief says to merge main before reporting. An item with no `touches` gets touches derived from its text and the repository; `dispatch plan` shows them with `touches_source: derived`, the ledger's dispatched event records them (`touches`, `touches_source`), and writing `touches` on the item corrects them. The executor contract asks for a `release_note` when a change touches `merge.public_globs`, and `hitld dispatch complete` flags one that is missing (`release_note_missing`)."
---

## Why

Every executor brief in a long session was written by hand to say which other executors were changing which files and to stay out of them, and which merged work to build on. Items rarely carry `touches`, so the dispatch's overlap rule had little to go on. Executors also never wrote a release note; the orchestrator added each one at close. The owner decided this lands before self-hosting.

## Done when

- The brief `hitld dispatch` writes lists the dispatches in flight whose `touches` overlap this item's, with their items and paths, and the merges since the item was planned that touch the same paths.
- When an item has no `touches`, planning derives them from its spec and the repository (paths and modules it names) and records them as derived; the overlap rule and the brief use them, and the owner or orchestrator can correct them.
- The executor contract and the execute skill ask for a `release_note` on the item whenever the change touches the public interface, and the report check flags one that is missing.
- Tests cover an overlapping and a non-overlapping pair, derived touches, and a missing release note.
- `npm run check`, the offline eval gate and `hitld work check` pass.
