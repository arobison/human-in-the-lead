---
id: HITLD-891
title: Feedback publication re-screens the exact text and classification at approval, and the harness fields are enumerated
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
---

## Why

Feedback publishing checks that a record is in the state `drafted` and nothing more at approval (`core/lib/feedback/publish.mjs`): the screen ran at draft time, the draft's classification is not re-read, and `hitld_version` and `harness` name and version go into the public body as free text from command flags, unscreened. A planted draft, or private text in a harness field, can reach a public issue.

## Done when

- At approval the exact publication text and classification are screened again, with the private term list, and refused if they fail.
- `harness` and its version are enumerated values, not free text.
- A test per case (a planted draft; private text in a harness field).
- A guard, rights, store or workflow change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Finding S5 (medium) of the second Fable security pass (2026-11-22), decision HITLD-885. HITLD-870 covers who approves, not this re-screen.
