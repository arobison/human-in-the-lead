---
id: HITLD-583
title: The chief of staff delegates drafting and bulk program-management work to a curator agent and verifies it against the decision records
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
---

## Why

Across the design walk-throughs of 2026-11-19 and 2026-11-20 the chief of staff session did a large amount of program management itself: filing about thirty items, reconciling 92 open items, writing decision notes into dozens of files, and publishing and merging many tracker pull requests. That session is the owner's one point of contact and its context is large (about 500K tokens re-read each turn over about 4.5 days), so every file it touches costs more than it would in a fresh small session: it had spent about 13 times what the orchestrator session had. The owner asked whether this work should be delegated to an agent, relayed, and be part of the trust system, and decided (HITLD-582) to delegate drafting and bulk work to a curator agent.

## What it should do

- **The chief of staff keeps** the conversation with the owner, recording the owner's answers as decisions (the proof is the owner's turn in that session, HITLD-515), verifying delegated work, and merging tracker-only pull requests under the standing grant (HITLD-576). One-off notes (one decision and one note) stay in the chief of staff session.
- **A curator agent**, in a fresh small session per job, drafts the bulk work: consequence items from decision records, reconciliation passes, consistency fixes, analysis such as the audit of open items, and notes across many files. Its brief is decision IDs and the instruction, not the conversation: the decision records in the tracker are the context. It opens tracker pull requests.
- **Verification stays with the chief of staff** and is against meaning: each delegated pull request is checked against the decision records for whether a note says what the owner decided. `hitld work check` and CI catch structure, not meaning (slips seen in this run: a section nearly removed by a wrong slice, a wrong front-matter field, a malformed argument).
- **Trust:** tracker edits by the curator are the same kind as the chief of staff's (the initial grant of HITLD-576); the evidence is that its pull requests are not later reverted or corrected, and the owner's report counts as a miss.
- The chief of staff skill says when to delegate (bulk work of about ten files or more, analysis, repetitive filing) and when not.

## Done when

- The missing information is obtained first (the shape is settled in HITLD-582; the brief format and the curator's tools are shaped), then a failing test or eval that reproduces the gap: bulk tracker work runs in the chief of staff session today (design part 14.7).
- The chief-of-staff skill and the curator brief exist, in one change the owner approves, and a delegated job is verified against its decision records before merge.
- The design part on the curator role (HITLD-220) says it, in the same pull request (HITLD-579, 580).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

The chief of staff began delegating bulk work with read-only subagents on 2026-11-20 as the practice, before this item is built. Skill: the owner's own yes to merge. Placed under HITLD-191 c3 (cleanup and upkeep by command) beside HITLD-220 by the chief of staff, a proposal for the owner to move. Related: HITLD-220 (the curator role design), HITLD-132 (the sweep and curator pass), HITLD-139 (where the tokens go), HITLD-576, HITLD-507.
