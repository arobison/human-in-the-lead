---
id: HITLD-1074
title: "Decide how the owner learns whether the merge gate works: record why green branches are rejected, and reopen HITLD-477 as seeded-fault canaries plus a small blind audit"
kind: work
state: proposed
created: 2026-11-28
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when
- A decision, with the owner: whether the merge gate is measured at all before any kind of change unlocks, and how. Options to put: (a) record the reason for every rejection of a green branch from now, as a first measure only; (b) (a) plus seeded-fault canaries (SIG-7) planted in unlocked-kind changes and a small blind audit by the owner (SIG-6); (c) keep HITLD-477's "no sampling".
- Whatever is chosen, the unlock bar (HITLD-478) is restated in terms of what it can show (15 merges aged 7 days bound the failure rate only below about 18 percent at 95 percent confidence), and design part 6.6 matches the decision (it still lists a random audit sample).
- `npm run check`, the offline eval gate and `hitld work check` pass if files change.

## Why

HITLD-477 chose no audit sampling, and HITLD-478 set the unlock bar at 15 merges aged 7 days from 8 items. "Clean" there means nobody noticed anything in 7 days, in a system built so nobody reads, so the bar cannot separate a good gate from a lucky one. The landscape report's strongest finding for HITLD says the same: a small system sees too few incidents to tell the two apart. Found by the Fable read of the report (`Fable design implications.md`, recommendation 2).

## Notes

rc.3, proposed: needs the owner's choice. Design-rule and policy text is owner-held (the owner's own yes). Recording rejection reasons (option a) costs almost nothing and can start now.
