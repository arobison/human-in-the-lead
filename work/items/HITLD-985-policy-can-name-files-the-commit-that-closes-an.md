---
id: HITLD-985
title: "Policy can name files the commit that closes an item must include, such as a changeset: the brief states it, `work close` warns, and the merge queue refuses"
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-404 c?]
---

## Done when

- Policy accepts `close.requires` entries with a glob, an optional `unless_touches_only` list and a `why`; they are data only, and `work check` rejects any command or hook in them; a test covers both.
- The dispatch brief states each requirement with its `why`; a test checks the brief text.
- `hitld work close` warns when the branch's changes include no match, and the merge queue refuses a branch whose closing change lacks one and shows which file satisfied it; a test covers each.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

A project that needs a per-change file, such as a changeset, learns the rule only from its own `AGENTS.md`, and a miss shows up as a CI failure after the branch is up, which costs a fix round. It serves projects with such rules and the executors that follow them.

## Notes

GitHub issue 526. rc.3. A consumer adopting Changesets wants every change to carry a changeset in the closing commit; its own CI stays the authority on whether the file is well formed.
