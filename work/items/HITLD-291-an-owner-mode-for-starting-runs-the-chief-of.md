---
id: HITLD-291
title: "An owner mode for starting runs: the chief of staff proposes every next run, and standing approval is earned like the automatic merge queue"
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

An owner mode for runs: the chief of staff proposes each next run when one ends, idle only by stated rules, and standing approval is earned like the merge queue.

Reported as GitHub issue #176 (kind idea, no severity), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: skills/chief-of-staff/SKILL.md:114 when the run ends: delete tasks and tell the owner; no next-run proposal

## Done when

- The owner decides, in a design walk-through (HITLD-135), one question at a time, what an owner mode for runs is: who proposes each next run, when an idle orchestrator is allowed, and how standing approval is earned (like the automatic merge queue); the answers are recorded as decisions before anything is built.
- The chief-of-staff skill and design parts 6.1 and 13 say the chosen answer, in one change the owner approves; build items follow.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `backlog`, area `dispatch`, still present on main, confidence 0.6. A trust-ladder design for runs; shape it, and the owner decides any autonomy it grants.
