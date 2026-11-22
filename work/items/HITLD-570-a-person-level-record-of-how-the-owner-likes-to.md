---
id: HITLD-570
title: A person-level record of how the owner likes to work, loaded by the chief of staff in any harness
kind: work
state: proposed
created: 2026-11-19
project: HITLD-15
constraint_of: [HITLD-405 c2]
---

## Why

The owner asked on 2026-11-19 whether harness memory is enough for the chief of staff to remember how the owner likes to work, given that HITLd may run from different harnesses, and gave an example: do not ask the owner what order to answer questions in, just start asking. Across this self-hosted run the owner had to repeat rules such as "ask me one at a time" after context resets, and the chief of staff asked whether to start work while the gate was closed after being told not to. Those rules lived only in the chief of staff's conversation context and its summaries. Harness memory belongs to one harness, cannot be listed or edited in one place, and can change behavior silently, which is what the design refuses for trust (design 4.6).

The owner decided (HITLD-569) that how the owner likes to work is its own record, separate from trust and precedent, and that a preference can never widen what the system may do on its own.

## What it should do

- A person-level record (HITLD-490: aggregates and the person, not a project) of working preferences, carried to cloud sessions by the settings-and-profile work (HITLD-148) and loaded by the chief of staff skill at session start in any harness. Each entry holds the owner's own words, a scope (all projects, or one project), a kind (style or process), when it was last confirmed, and where it came from (the owner's message, with its proof, HITLD-515).
- Written when the owner states a preference. A preference the chief of staff only infers from behavior is proposed in one line and recorded when the owner confirms; it is not applied until then, or is applied with disclosure.
- Style and process preferences only (the order of questions, brevity, when to interrupt, the form of a summary). Anything that would widen what the system may do alone is not a preference: it becomes an unlock proposal in the trust engine (HITLD-507).
- Project-specific preferences stay in that project's store; person-level entries carry no project-confidential content (HITLD-490).
- The owner can list, edit and retire entries, and the chief of staff can cite the entry behind a behavior. Entries are re-confirmed at a low rate, and the loaded set stays small (retrieval, HITLD-55, if it grows).
- A harness's own memory is a cache at most; the record is the source of truth.
- A first set of entries is seeded from the standing rules the chief of staff carried in this run, shown to the owner to confirm once, not applied unconfirmed.

## Done when

- The missing information is obtained first (the shape is settled in HITLD-569; the entry format, the command and where the record lives are shaped with the owner), then a failing test or eval that reproduces the gap: a rule the owner stated is not applied after a restart or in a second harness (design part 14.7).
- A `hitld` command lists, adds, edits and retires entries, and the chief of staff skill loads the active ones at start.
- An entry that would widen authority is refused as a preference and raised as an unlock proposal.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Design-heavy in its details (the entry format, the loading, the seed): stays proposed and is walked through with the owner. Skill, code and schema: the owner's own yes to merge. Placed under HITLD-405 c2 (what the chief of staff tells the owner, one question per call) by the chief of staff, a proposal for the owner to move. Related: HITLD-135 (walk-throughs), HITLD-148 (a cloud session starts with the owner's settings), HITLD-490 and HITLD-507, HITLD-515, HITLD-543 (a pending decision per question).

## Evidence from the first retrospective (2026-11-20, HITLD-589)

- **P1:** seed the record now with the standing rules the owner has stated in this run (ask one question at a time; no asking whether to start while the gate is closed; no asking what order to answer in; no messages about no-op events; look decisions up before claiming), shown to the owner once to confirm. The owner repeated "ask me one at a time" 4 times, 3 of them after a compaction or restart.
- **P3:** the record must also be reloaded after every compaction, not only at session start: 3 of the 4 repeats and 5 of the 7 decision-related corrections came after a reset.
