---
id: HITLD-884
title: When an item reported as a GitHub issue merges, the issue gets a comment linking the pull request and is closed
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-404 c?]
---

## Why

The owner asked on 2026-11-22 whether GitHub issues are closed and linked to their pull requests when the work merges. They are not. Issues 112, 115 and 119 (the items HITLD-255, 258 and 261) merged the same day and are still open: the triage comment on each says "This issue stays open until that item is done", but no code closes an issue when its item is done or merged, so the promise is never kept and the reporter sees nothing. Issue 519 (HITLD-838) already notes the same gap for release items.

## Done when

- When a pull request merges that closes an item reported as a GitHub issue, the issue gets a comment with the pull request's link and the commit, and is closed as completed. The queue or a single command does it, through the send gate (the text passes the private-term check); it is idempotent and never closes an issue whose item is still open.
- An item dropped or declined closes its issue with a comment giving the reason, as `not planned`.
- The comment follows the rule for comments on GitHub that name the work: the item's title and a link to the item's file, no private material.
- Issues whose items already merged (112, 115, 119 and any earlier ones) are closed once with the same comment, on the owner's yes.
- A test per case above (merge, dropped item, repeat run, item still open). `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Joins Consumer live (HITLD-67) clause c2 on the owner's word of 2026-11-22. A command that posts to GitHub is outward-facing, so it needs the owner's own yes to merge.

Moved from rc.2 to rc.3 by the owner's cut-line decision HITLD-973 (2026-11-23).
