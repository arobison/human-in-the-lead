---
id: HITLD-670
title: Regenerate the knowledge-base index at merge
kind: work
state: proposed
created: 2026-11-21
project: HITLD-15
needs: [HITLD-55]
---

## Why

A stale knowledge-base note is only a warning, and the index is not regenerated at merge, so two branches that both change notes can leave the index out of date. The owner chose warnings only for now (decision HITLD-666); this follow-up covers the index.

## Done when

- The merge step regenerates the knowledge-base index from the notes on main, so the index always matches the notes.
- Two branches that both change notes do not refuse each other, shown by a test.
- A stale note still only warns.
- Waits for pull request 400 (HITLD-55) to merge.
