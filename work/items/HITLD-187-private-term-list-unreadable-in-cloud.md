---
id: HITLD-187
title: Verify what the public-text checks do when the private term list cannot be read
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

HITLD-114 keeps the private term list in the private store. A cloud session may lack the store or the key, so the list is unreadable there. If the commit, merge and publish checks then pass with no terms, a private name could reach a public repository from exactly the sessions that publish most. This is unverified: the first step is to find out.

## Done when

- A test reproduces the case (no store, no key, no list) for the commit hook, the merge check, `hitld work check` and `hitld publish check`, and records what each does.
- If any passes silently, it instead refuses or warns by name that the list was not checked, and the run says so.
- The finding is recorded in this item, including when it turns out to be already handled.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Security-relevant. Raised under HITLD-181 from the owner's session review; related to HITLD-114 and HITLD-142.
