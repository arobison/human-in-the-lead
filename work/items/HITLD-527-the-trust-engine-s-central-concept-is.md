---
id: HITLD-527
title: The trust engine's central concept is supervision modes with an order, not a ladder
kind: decision
state: done
created: 2026-11-19
project: HITLD-15
decider: owner
answer: "A. Supervision modes with an order and unlock edges: Each process registers its own supervision modes, which is tighter than which (a partial order), and the allowed unlock steps; a ladder is the special case of a chain; limits like a budget cap stay in a kind's definition"
answered_at: 2026-11-19T21:34:26.275Z
answered_via: question-tool
answered_by: owner
---

## Question

How general should the trust engine's central concept be, now that a straight ladder of rungs may be too narrow?

HITLD-505 decided three rungs for commitment; HITLD-520 uses 'most restrictive wins' and 'a classifier can only tighten', which need only to know which of two modes is tighter. Processes may need modes that do not form a line, such as an independent check or a second person.

## Options and recommendation

- A. Supervision modes with an order and unlock edges: Each process registers its own supervision modes, which is tighter than which (a partial order), and the allowed unlock steps; a ladder is the special case of a chain; limits like a budget cap stay in a kind's definition
- B. Grants with modes and limits: A grant is a mode plus explicit limits and expiry
- C. Keep the ladder for now: Rungs as decided in HITLD-505

Recommended: Supervision modes with an order and unlock edges. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
