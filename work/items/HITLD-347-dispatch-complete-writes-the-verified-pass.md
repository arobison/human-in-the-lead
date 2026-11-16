---
id: HITLD-347
title: dispatch complete writes the verified pass without the dispatch it belongs to
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Done when




- The `verified` ledger entry that `dispatch complete` writes carries the `dispatch` field, so a verification pass or fail is tied to its dispatch directly and a query by dispatch finds it.
- A test covers a pass and a fail; entries already in a ledger stay valid (the field is optional on read).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Found by the executor of D-25 (HITLD-153) and reported as not blocking: `dispatch complete` writes the `verified` pass without a `dispatch` field, so reading the ledger cannot say which dispatch a pass belongs to except by the item. It matters for the release path in HITLD-153, which appends a fail correction by hand.

## Notes

Check `schemas/ledger-entry.schema.json` for whether the field is allowed on `verified` before building. Small, low priority.
