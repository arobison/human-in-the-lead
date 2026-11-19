---
id: HITLD-291
title: "An owner mode for starting runs: the chief of staff proposes every next run, and standing approval is earned like the automatic merge queue"
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
needs: [HITLD-353]
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

## Widened on 2026-11-19: committing to work is a trust system

The owner said that committing to work always needs their sign-off today, and that this should be another trust system: eventually they will trust the system enough to work against the budgets on its own, completing goals by committing to the right work. This item is the home of that design. The owner's answers so far (a walk-through, one question at a time):

- **The unit of autonomy (HITLD-503):** a goal under a budget. The owner signs off goals and budgets once (a milestone or release outcome; tokens, time, attention), and the system commits to the items that serve the goal within the budget, in critical-path order, stopping when the goal is met, the budget is spent or the quota gate says stop. It is not an approved list or an open mandate. Only `planned` items can be committed to, so promoting a `proposed` item stays the owner's.
- **Kinds of commitment on a scale of trust (HITLD-504):** none of this is permanent. One-way-door builds, items the owner has held, and an item that is a big share of the budget wait for the owner's yes to start. Patch releases could eventually go out without the owner's ok; a change to a public promise (such as an API change) needs consulting first, though the owner may eventually allow the system to make those changes; the same for big-budget items. An item the owner holds stays held at every rung.
- **The rungs (HITLD-505):** three. 1. Ask first. 2. Tell the owner, then proceed unless they object within a window. 3. Proceed and report afterward. Each kind of commitment earns its own rung.
- **Earning a rung (HITLD-506):** the same machinery as merging (HITLD-472: an unlock bar of aged, varied, clean decisions; a miss re-locks at once and starts again), with commitment evidence: finished within budget, an estimate close to the measured cost, an item later dropped or abandoned as the wrong work, and the owner's report. One trust engine serves merging and commitment.

### Still to decide

- What a goal is in the tracker: a milestone, a release item, or a new kind of record; what a budget holds (tokens, wall-clock, the owner's attention) and who sets it. The burn-rate knob (a target pace in plan-percent per hour, appetite, shape and the owner's review throughput) is explored in HITLD-509.
- The veto window at rung 2, and how the owner is told and objects.
- The first goal and budget to try, and how this meets the weekly quota gate (the gate's reserve stays the owner's).
- The chief of staff's proposals (HITLD-291's original question: who proposes each next run when one ends, and when an idle orchestrator is allowed).
- How the trust records for commitments and for merging share one record, and how the owner sees them (the dashboard).

