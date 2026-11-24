---
id: HITLD-857
title: The executor guard refuses an executor's edits to the project hook settings and the cloud plugin copy
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-69 c2]
---

## Done when

- The executor guard refuses an executor's writes to `.claude/settings.json`, `.claude/settings.local.json` and the cloud plugin copy that HITLD-792 makes at session start, through the file tools and through shell commands (redirects, `tee`, `sed -i`, `git checkout`/`restore` of those paths, and moving or deleting them).
- A test covers each refused write, and that the guard still allows an executor's ordinary code edits and its own claim-branch push.
- The plugin copy matches. A guard change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

HITLD-792 runs the plugin's hooks in cloud executor sessions from the project's `.claude/settings.json` and a copy made at session start. Project hooks reach a running session at once, so a cloud executor can switch off its own hooks mid-session by editing those files. The HITLD-792 executor raised this as a question, recommending that the guard refuse those edits; the chief of staff files it as a follow-up. The guard reads command text, so HITLD-856 (rewiring the push remote or remote refs) is a sibling and the two could be built together.

## Notes

Build it after HITLD-792 lands. It is a guard change, so it needs the owner's own yes. The executor's second question (a cloud executor's budget hook has no ledger entry in its store, so only the reconcile pass checks budget) is covered by HITLD-841, which carries the token cap in the claim commit.
