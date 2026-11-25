---
id: HITLD-1059
title: A private term can be marked publish-only, so only the publication check reads it and the commit guard and work check ignore it
kind: work
state: proposed
created: 2026-11-25
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- The private term list can mark a term publish-only; the publication check reads it, and the commit guard and the work check do not; the format change is documented and old lists keep working.
- A project's own files can then name a term that must never be published without a second term store or a wrapper script.
- A test: a publish-only term in a tracked file passes the commit guard and the work check and is refused by `publish check`.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

GitHub issue 665: one private term list feeds the publication check, the commit guard and the work check, so a private repository cannot list names that appear in its own files but must never be published.

## Notes

rc.3, proposed: a design question first (the list's format and where publish-only terms live). Private-term handling is a guard path: owner-held.
