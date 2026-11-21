---
id: HITLD-664
title: What should happen to the eight done items on main that the consistency check flags?
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: A
answered_at: 2026-11-21T04:52:11.576Z
answered_via: question-tool
answered_by: owner
---

## Question

The new check on main (HITLD-49) flags eight done items with no commit that names them: six closed in tracker-only commits and two whose code merged with no ID. How should they be handled, and what for items done before the check existed?

Pull request 398. 38 flags before its fixes, eight after, all real cases of the rule. HITLD-470, 472 and 507 were closed as superseded by a design update.

## Options and recommendation

- A. Confirm each, then add a cutoff: Publish a note with a Refs trailer for each real one, mark 470, 472 and 507 dropped, and add a policy cutoff so items done before adoption are not flagged.
- B. A baseline file: List the eight in a baseline the check ignores.
- C. Leave the warnings: They are warnings only.

Recommended: Confirm each, then add a cutoff. It leaves the check meaningful for new work without rewriting history.

## Answer

Open.
