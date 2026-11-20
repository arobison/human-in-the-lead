---
id: HITLD-473
title: What the authority to merge without asking rests on
kind: decision
state: done
created: 2026-11-18
project: HITLD-15
decider: owner
answer: "A. Risk first, history widens it: Each PR is classified by reversibility and blast radius; one-way doors always wait. Outcome history only widens what counts as low-risk."
answered_at: 2026-11-18T05:22:19.947Z
answered_via: question-tool
answered_by: owner
---

## Question

What should the authority to merge without asking rest on? Today it is a count of approved merges in an area (merge.propose_queue_after, 20).

HITLD-472: the owner is not sold on the count as the trust signal. The count measures how often the owner said yes, not how safe the changes were.

## Options and recommendation

- A. Risk first, history widens it: Each PR is classified by reversibility and blast radius; one-way doors always wait. Outcome history only widens what counts as low-risk.
- B. History only, but better measured: Trust earned by area, counting outcomes (fix-forwards, failing checks on main) over a window with distinct items.
- C. Risk only, no history: A fixed class table decides; nothing is earned or decays.
- D. Keep the 20-merge count: Leave the rule as built.

Recommended: Risk first, history widens it. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
