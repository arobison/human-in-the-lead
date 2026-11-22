---
id: HITLD-732
title: Reword HITLD-693, 694 and 695 to the shared React app design
kind: work
state: in-progress
created: 2026-11-22
project: HITLD-15
claimed_by: D-01M80WXHQHVMC0X0
---

## Why

The owner's shared UI kit decisions (HITLD-721, 724 to 728) replace the static page and regeneration design of HITLD-689 with one React app, installed with HITLD, with data inlined into a committed static bundle. HITLD-693 (evidence panels), HITLD-694 (regeneration on events) and HITLD-695 (the curator's design text) were written for the old design. This is a curator pass, run after the design item HITLD-723 is done. Its need on HITLD-723 is stated here because HITLD-723 was not yet on main when this item was filed.

## Done when

- HITLD-693 describes evidence panels as components of the shared React app (HITLD-729), keeping the owner's decisions HITLD-686 and HITLD-687.
- HITLD-694 describes regeneration as writing the static bundle with the current contract data inlined, keeping the statement of when and where the data was read.
- HITLD-695 describes a design update that records the React app, the installed delivery, the static bundle with inlined data, project panels living in a project's own app, and the committed bundle with its CI check, and states that these revise HITLD-689.
- HITLD-691 and HITLD-692 are unchanged.
- `hitld work check` passes.
