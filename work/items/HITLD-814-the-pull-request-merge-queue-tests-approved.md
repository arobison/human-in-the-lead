---
id: HITLD-814
title: The pull-request merge queue tests approved branches together in a batch, so one merge does not restart every other branch's checks
kind: work
state: proposed
created: 2026-11-22
project: HITLD-15
---

## Done when



## Why

The owner asked on 2026-11-22 (and asked for this to be filed) how to save testing time when several approved pull requests wait. In pull-request mode (`core/lib/merge/pull-request.mjs`) the queue handles one branch at a time: a check still running holds the branches after it, and each merge to main brings the next branch up to date and runs its full checks again (about 5 to 10 minutes each). On 2026-11-22 four approved pull requests (HITLD-748, 764, 765, 766) took several passes to land. The local queue (`queue.mjs`) already batches (`merge.batch_max`, default 4): it builds a batch, runs the full suite once, and bisects on failure; pull-request mode does not use it.

GitHub's stacked pull requests (HITLD-76) are not that: a stack is ordered layers of one change, every pull request in it is checked as if against the stack's base, and GitHub's merge queue evaluates the stack's pull requests individually while trying to keep them in one merge group (read in the gh-stack project's FAQ on 2026-11-22; GitHub's own docs pages could not be reached from the session, so the merge and REST API pages are unread). Auto-merge and bypass are not yet available for stacks. GitHub's own merge queue, which tests a merge group once, is a separate option.

## Done when

- The owner decides, in a design walk-through, how pull-request mode batches: (a) the hitld queue merges the approved branches into one batch branch, runs the named checks once on it and merges the batch, bisecting on a failure, as the local queue does; (b) hitld hands the approved pull requests to GitHub's merge queue and its merge groups; or (c) no batching. The decision says what happens to the owner's per-branch approvals, the squash commit sign-offs (one per pull request) and the Closes trailers.
- The chosen way is built and tested with a fixture of three approved branches (one merge, one test run, one failing branch bisected out), and the owner sees fewer check runs for the same pull requests.
- Design part 14.2 says it, through the curator job and a design PR; a queue or policy change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Related: HITLD-76 (stacked pull requests, proposed, rc.3), HITLD-777 (tracker-only moves on main no longer restart queued branches, merged), HITLD-552 and HITLD-553 (the trust engine, rc.2).
