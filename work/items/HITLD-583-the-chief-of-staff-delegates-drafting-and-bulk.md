---
id: HITLD-583
title: The existing curator also applies changes the owner has decided, and the chief of staff verifies them against the decision records
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
---

## Why

The design already has a curator: a tier-1 agent (design parts 4, 8.5 and 13.3, built in HITLD-132, `skills/curate`) that keeps the knowledge base and the work items true to what was built and decided. It runs after merge batches, reads the open items against recent merges, answered decisions and design changes, fixes wording within an item's facts through a pull request, and changes no decision or plan on its own: anything that changes scope, a plan, a placement or a release becomes a question for the owner.

Across the design walk-throughs of 2026-11-19 and 2026-11-20 the chief of staff session did a different kind of tracker work itself: applying consequences of decisions the owner had already made (filing about thirty items, reconciling 92 open items, writing decision notes into dozens of files, publishing and merging many pull requests). That session is the owner's one point of contact and its context is large (about 500K tokens re-read each turn over about 4.5 days), so every file it touches costs more than in a fresh small session: it had spent about 13 times what the orchestrator session had. The owner asked whether this work should be delegated (HITLD-582) and pointed out that a curator already exists. This item is the second job of that one role, not a new role. The owner decided (HITLD-586) that the fuller curator lands in rc.4.

## What it should do

- **A second job for the curator: apply decided changes.** Given recorded decision IDs, a curator dispatch applies their consequences to the tracker: notes on affected items, rewrites, consequence items filed `proposed` with proposed placements, reconciliation passes, and bulk consistency fixes. Its authority comes from the owner's recorded decisions, not its own judgment, so the existing boundary holds: it changes no decision or plan on its own, and each placement is a proposal the owner moves.
- **Its brief** is the decision IDs and the instruction, not the conversation: the decision records in the tracker are the context. The execution mode and model come from the cascade (HITLD-581) in a fresh small session per job. It opens tracker pull requests.
- **The chief of staff keeps** the conversation with the owner, recording the owner's answers as decisions (the proof is the owner's turn in that session, HITLD-515), verification, and merging tracker-only pull requests under the standing grant (HITLD-576). One-off notes (one decision and one note) stay in the chief of staff session.
- **Verification is against meaning.** Each pull request is checked against the decision records for whether a note says what the owner decided. `hitld work check` and CI catch structure, not meaning (slips seen in this run: a section nearly removed by a wrong slice, a wrong front-matter field, a malformed argument).
- **Trust:** tracker edits by the curator are the same kind as the chief of staff's (the initial grant of HITLD-576). The evidence is that its pull requests are not later reverted or corrected, and the owner's report counts as a miss.
- The chief-of-staff skill and `skills/curate` say when to delegate (bulk work of about ten files or more, analysis, repetitive filing) and when not.

## Done when

- The missing information is obtained first (the shape is settled in HITLD-582 and 586; the brief format and the curator's tools are shaped), then a failing test or eval that reproduces the gap: bulk tracker work runs in the chief of staff session today (design part 14.7).
- `skills/curate` and the chief-of-staff skill cover the second job, in one change the owner approves, and a delegated job is verified against its decision records before merge.
- The design parts on the curator (4, 8.5, 13.3) say it, in the same pull request (HITLD-579, 580).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

The chief of staff began delegating bulk work with read-only subagents on 2026-11-20 as the practice, before this is built. Skill: the owner's own yes to merge. Placed under HITLD-403 c5 (rc.4) by the owner's decision HITLD-586, beside HITLD-220 (the curator role design, which also settles how each kind of sweep finding routes to an action). Related: HITLD-132, HITLD-220, HITLD-139, HITLD-576, HITLD-507.

## Decided on 2026-11-20 (HITLD-587)

- **Three jobs, not two:** the curator's jobs are upkeep after merge batches (as built, HITLD-132), applying decided changes (above), and plan audits. A plan audit is read-only: coverage of milestones and releases, contradictions between items and decisions, duplicates, drift between the docs and the decisions (HITLD-580), and proposed start lists (such as the list of items no open design can change). Its result is a set of claims, each with its evidence (a quote from the item or decision), not a conclusion. The chief of staff verifies the claims before showing them to the owner: the first audit (2026-11-19) needed that filter, because it put an item on a start list that an executor could not do and missed that another carried authors. An audit changes no plan; findings that would are questions for the owner.
- **The dispatcher picks the model and effort, never the curator.** Each job type has its own starting rung in the cost-ordered cascade (HITLD-581, 561) and its own first-pass-yield measure, escalating on a failed verification. Nothing is measured yet, so the first rungs are defaults: a small model at low effort for applying a decided change and for upkeep, whose output is checked against the decision records, and a larger model or higher effort, or a second verifying pass, for audits. Measured yields come from use in rc.4.
