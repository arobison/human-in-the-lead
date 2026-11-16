---
id: HITLD-135
title: "Design walk-throughs as a skill: one question at a time, each answer recorded"
kind: work
state: in-progress
created: 2026-11-15
project: HITLD-15
needs: [HITLD-134]
claimed_by: D-12
---

## Why

Each design (0001's review, 0002, 0003) was decided the same way, by hand: put its open questions to the owner one at a time with the recommendation first, record each answer in the design's questions section, write the decision item, file the milestone and build items, and open a pull request. It is a repeatable procedure. The owner decided it lands before self-hosting.

## Done when

- A `design` skill (or a section of the orchestrate skill) takes a design file with an open questions section and walks the owner through it with the harness's question tool, one question at a time, each recorded with `hitld rights record` (HITLD-134), and the answer written into the design under the question ("Decided by the owner (date): …").
- When every question is answered, it marks the design decided, files the decision item that adopts it, and, if the design names a milestone and build items, files them; then it prepares the tracker and design pull request (HITLD-125).
- A question the owner skips stays open; the skill never answers for the owner.
- An offline scenario runs it over a fixture design with three questions and checks the records and the edited file.
- `npm run check`, the offline eval gate and `hitld work check` pass.
