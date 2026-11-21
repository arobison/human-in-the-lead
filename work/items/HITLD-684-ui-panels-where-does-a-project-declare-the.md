---
id: HITLD-684
title: "UI panels: where does a project declare the panels it adds?"
kind: decision
state: done
created: 2026-11-21
project: HITLD-15
decider: owner
answer: "A. A views file beside tracker.json: A committed views.json validated against the tracker's declared fields; a panel naming an undeclared field is refused."
answered_at: 2026-11-21T16:58:31.781Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-681 question 2 of 7. Where is the declarative panel config kept?

A panel is a named filter over tracker fields, columns, grouping, and a chart from a closed set.

## Options and recommendation

- A. A views file beside tracker.json: A committed views.json validated against the tracker's declared fields; a panel naming an undeclared field is refused.
- B. Inside tracker.json: Panels sit beside the fields they read.
- C. Inside policy.json: One project config, but policy is for decision rights.

Recommended: A views file beside tracker.json. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
