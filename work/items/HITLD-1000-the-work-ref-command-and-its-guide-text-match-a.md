---
id: HITLD-1000
title: "The work ref command and its guide text match: a main link only when the item is on origin, a title on release records, and the guard refuses near-miss commands"
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-67 c?]
---

## Done when

- `hitld work ref` links an item on main only when `origin/main` has it, not when only the local main does; a test covers a local main ahead of origin.
- A release record prints its tag and a title, not an empty one; a test covers it.
- The chief-of-staff skill says the link goes on the first mention only and that the `lines` output carries it on every line, so a list is trimmed accordingly.
- A guard test asserts `hitld work refresh`, `hitld work refs` and `hitld work ref;rm` are still refused.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The independent review of pull request 592 (HITLD-807) on 2026-11-24 found no blocking defect and these cosmetic and test gaps; the owner said merge and file them. Serves the owner, who is sent the links.

## Notes

rc.2. Also noted by the review, unconfirmed: `work ref` takes its remote from a policy key that `work publish` does not read; a renamed item file can leave a stale path on main; the forge repo match would accept a host like notgithub.com (older code).
