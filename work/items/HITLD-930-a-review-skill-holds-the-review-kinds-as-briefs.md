---
id: HITLD-930
title: A review skill holds the review kinds as briefs with a fixed output schema, and every report names the commit it read
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
---

## Why

On 2026-11-22 independent model reviews (the Fable reviews) found a reproduced store forgery, branch-authored workflow risks, seven medium defects in a 4,900-line delegated merge nobody had read, and stale or contradicted done items, all of which our own tests and agents had missed. They also made mistakes: two reviewers read a stale checkout, and one finding was outdated when written. Today the reviews are ad hoc, human-triggered and expensive; the owner asked how to build them in (decision HITLD-929).

## Done when

- A review skill holds each review kind as a brief with a fixed output schema: adversarial security, independent code read, plan against design, done-item audit, design draft, consumer walkthrough. The briefs say read-only, a fresh checkout of main, no network, no secrets printed, items named with title and link.
- Every report names the commit it read and ranks findings with severity, a confidence tag, file and line evidence and a suggested fix; a report built on a stale checkout is refused.
- The chief of staff verifies each finding it relays and says which it verified.
- A test checks the schema and the stale-checkout refusal. A skill change reaches main only with the owner's own yes.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

The rc.2 slice of decision HITLD-929; the independent reviewer on delegated merges is HITLD-872, which runs this skill's independent-read brief. The briefs used on 2026-11-22 are the starting text.
