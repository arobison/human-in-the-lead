---
id: HITLD-1036
title: The store pull says which local files a directory-to-gitlink change deletes, gives a typed error for a checkout where a file arrives, and its warnings reach store push and auto-sync
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- When an incoming head replaces a directory with a gitlink and the merge deletes the local files under it, the pull is a conflict or the warning names each deleted path; a test covers it (HITLD-820 left the deletion with only a 'left out of the merge' warning).
- A gitlink-turned-checkout on disk where an incoming plain file arrives gives a typed store error naming the path, not a raw `EISDIR`; a test covers it.
- The gitlink warnings also reach the `store push` result and the auto-sync line, which drop them today; a test covers each.
- Path names in the gitlink warnings have control and escape characters shown as escapes, so a hostile remote cannot write to a terminal; a test covers it.
- When the merge conflicts after the pre-import commit dropped a gitlink from the head, the message says the head changed, not 'nothing was merged'.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

PR 639 (HITLD-820, the store pull does not stop on a gitlink in the local head) merged on 2026-11-24 after an independent review (approve with nits) found no loss of data in the realistic cases and the points above; the owner chose to merge and file them. [Certain: the points come from the reviewer's report, and the first was reproduced with a probe on a directory with two files.]

## Notes

rc.3 (a proposal for the owner to move). Store area: the owner's own yes at merge.
