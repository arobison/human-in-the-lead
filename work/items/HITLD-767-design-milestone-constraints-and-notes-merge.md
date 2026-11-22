---
id: HITLD-767
title: "Design: milestone constraints and notes merge cleanly when two tracker pull requests edit the same milestone"
kind: work
state: proposed
created: 2026-11-22
project: HITLD-15
---

## Why

Two tracker pull requests that both add constraints and notes to the same milestone conflict, because a milestone's constraints are one long line in its front matter and notes are appended at the end. Three such conflicts occurred in one session (HITLD-67), each resolved by hand. Options to weigh with the owner: one constraint per line so git merges appends, a union merge attribute for `work/milestones/**`, or a command that adds a constraint to a milestone (HITLD-276 is the related request).

## Done when

- A design, walked through with the owner, picks how two pull requests that add constraints or notes to one milestone merge without a hand resolution, and says what changes in the file format and in `hitld work check`.
- A test shows two branches adding different constraints and notes to one milestone merging cleanly.
- `hitld work check` passes.
