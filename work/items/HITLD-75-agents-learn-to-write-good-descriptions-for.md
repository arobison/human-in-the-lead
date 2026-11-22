---
id: HITLD-75
title: Agents learn to write good descriptions for items, projects, initiatives and milestones
kind: work
state: done
created: 2026-11-14
project: HITLD-28
constraint_of: [HITLD-408 c3]
claimed_by: D-50
---

## Why

Agents write most of the tracker: items from triage, shaping and design review, projects, initiatives and milestones. Every description is read again many times, by executors through their briefs and by people deciding. A thin or vague one costs tokens, questions back and rework; a milestone outcome that cannot be checked cannot be Done. Nothing teaches agents what a good description is or measures it, beyond the brief-quality evals (design 17).

The design's entities are items (work, decision, external), projects, initiatives and milestones; "epic" maps to a project.

## Done when

- A writing guide per entity kind says what each part is for and how to write it: Why, Done when, Plan and Notes for items; summary and outcome for projects and initiatives; outcome, done-when clauses and check for milestones. It has short good and poor examples, neutral, and the skills that create entities point at it.
- A deterministic check flags mechanical problems as warnings, in `hitld work check` or its own command: a missing Why or Done when, a Done-when line with nothing observable to check, time estimates, history of how a decision was made, and words the classification rules forbid.
- An offline eval category for description quality: from fixture signals, a drafted entity is graded against a rubric by a model other than the writer, and seeded poor descriptions are caught.

Clauses 4 and 5 (description signals recorded against the entity and shown in the digest, and the guide's rules checked against outcomes) moved to HITLD-698, on the owner's decision to split this item.

## Plan

Design 2 (shaping and design review produce items), 3.2 (entities), 17 (evals, brief quality), 18 (learning from signals).

