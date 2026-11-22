---
id: HITLD-717
title: The curator updates the design for the private-list refusals
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-403 c5]
---

## Why

The owner decided two things about the private term list in the review of PR 404 (HITLD-187; the decision HITLD-660 and the owner's answers recorded on HITLD-187): `hitld merge` refuses when the list is not there if the opt-in policy flag `merge.require_private_list` is on, and `hitld feedback publish` refuses, not only warns, when the list was not checked. The code does both and the design text still says the earlier thing. The owner's rule: docs/ changes only through a curator job and a design pull request for the owner's yes.

## Done when

- A curator job drafts the design changes: in part 10.3, the "Where it is checked" merge row names `merge.require_private_list` (off by default; on, the merge refuses with `private-list-invalid` when the list is missing, and main does not move), and the paragraph after the table says `feedback publish` refuses, not warns, when the list was not checked.
- In part 16.2 the description of `private-list-invalid` is widened to cover a list that is missing, empty or cannot be read, and its copy in `core/lib/cli/errors.mjs`, which a test checks word for word, changes in the same pull request. The owner may instead choose a new code, `private-list-missing`, in that pull request, and then both refusals switch to it.
- The design pull request is the owner's to merge, with the changes listed for the owner's yes.
- `hitld work check` passes.

## Notes

Source: the owner's answers recorded on HITLD-187, where these design changes are listed as "still to make in docs/", and HITLD-660. Related: HITLD-695 (a curator job of the same kind).
