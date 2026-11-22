---
id: HITLD-931
title: "Independent review is built in: triggers set in policy, review debt shown to the owner, findings filed as proposed items, a review budget, and the false-positive rate tracked"
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-189 c?]
---

## Why

On 2026-11-22 independent model reviews (the Fable reviews) found a reproduced store forgery, branch-authored workflow risks, seven medium defects in a 4,900-line delegated merge nobody had read, and stale or contradicted done items, all of which our own tests and agents had missed. They also made mistakes: two reviewers read a stale checkout, and one finding was outdated when written. Today the reviews are ad hoc, human-triggered and expensive; the owner asked how to build them in (decision HITLD-929).

## Done when

- Policy declares triggers: an independent read before any delegated merge touching guard, rights, store, merge path, release workflows or the plugin copy; an adversarial pass before each release candidate and after a security-relevant change; a plan-against-design and done-item audit at each milestone boundary; a consumer walkthrough before each release candidate.
- The dashboard shows review debt: which risky merges have no independent read and which release trigger is due.
- One command turns a report into proposed items, deduplicated against existing items, with the reviewer's evidence attached; filing needs the owner's yes.
- A review budget: the strongest model is reserved for adversarial and design reviews and cheaper models do routine per-PR reads; reviews queue and run when budget is available.
- The share of findings that turn out false or stale is tracked per brief, and the briefs are tuned from it.
- A test per case. A rights or skill change reaches main only with the owner's own yes.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

The rc.3 part of decision HITLD-929. Reviews do not replace forge enforcement or tests: a review finds a hole, only the forge or a test keeps it shut.
