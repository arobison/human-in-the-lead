---
id: HITLD-291
title: "Committing to work is a trust system: a goal under a budget, with rungs the system earns"
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

## Decided on 2026-11-19 (HITLD-522, 523, 524)

The word "run" in this item's first form is gone: there is no run object (HITLD-470, 492). A commitment is a goal under a budget, and it ends when the goal is met, the budget is spent or the quota gate says stop.

- **What a goal is, and where the budget lives (HITLD-522):** a goal is an existing milestone or release item, which already has an outcome and checkable done-when clauses. The budget (tokens, time, the owner's attention) lives in a commitment decision the owner signs with the goal and the rung for each kind of commitment. A new budget is a new decision, and it carries the proof from HITLD-515.
- **The veto window at rung 2 (HITLD-523):** counted in the owner's awake time (quiet hours pause it), set per kind in the signed commitment decision, default 4 hours. The owner objects by any reply or by putting the item on hold, which stays held at every rung. Silence proceeds only after the window.
- **When a commitment ends (HITLD-524):** initially the system stops and the chief of staff confers with the owner, who decides the next goal and budget. Choosing the next goal is itself a kind of commitment on the trust scale, so it earns rungs by the same machinery (HITLD-506): eventually the system may choose how to spend its budget on the next goals, and later propose new goals on its own. Creating a new goal is a separate kind from choosing among existing ones. Each step is the owner's to grant through an unlock proposal, never taken by the system itself (design 4.6).
- **The quota gate:** its reserve always wins over any budget (HITLD-422).
- **The first goal and budget** are chosen when the owner signs the first commitment decision. It is a choice at that time, not a design decision.

## Risk to watch

A goal's quality cannot be scored by a command the way a code change can (HITLD-518), so the evidence for letting the system propose its own goals is weaker. The study (HITLD-507) should say what evidence "a goal turned out to be the wrong one" leaves, and whether that kind may reach rung 3.

## What is left

The one trust record and how the owner sees it (the dashboard) are settled in HITLD-507.
