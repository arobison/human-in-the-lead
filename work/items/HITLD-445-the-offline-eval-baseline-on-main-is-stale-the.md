---
id: HITLD-445
title: "The offline eval baseline on main is stale: the policy hash differs and the scenario set changed"
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-189 c1]
---

## Done when




- The cause is found and written in this item: the committed offline baseline for the eval gate differs from a clean run on main (the policy hash differs, the scenario set changed, and two new scenarios pass), and the gate says so.
- The baseline is accepted again from a clean run on current main with `hitld eval accept` (the owner's decision under design 17.9: executors never run it), and the commit shows the before and after of the scenario set; the owner commits it.
- Whatever makes the baseline go stale without anyone noticing (a policy hash that changes with each policy edit, new scenarios that are not added to the baseline) is either fixed or named in a follow-up item, so the gate does not drift again.
- `npm run check` and the offline eval gate pass.

## Why

Found by the executor of D-33 (HITLD-421) on 2026-11-16, reported as not blocking: the eval gate says the committed baseline looks stale on main (the policy hash differs, the scenario set changed, and two new scenarios pass). Executors cannot accept a baseline, so it stays stale until the owner does.

## Notes

Related: HITLD-100 (accepted eval baselines are committed), HITLD-12 (the eval accept command), HITLD-189 c1 (the gates give the same answer on every run). Proposed placement: HITLD-189 c1.
